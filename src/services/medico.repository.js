// ──────────────────────────────────────────────
//  Medico Repository
//  The ONLY place in this codebase allowed to query medico's tables.
//  Reads are unrestricted; the ONE sanctioned write is
//  createCaregiver() for Buddy self-signup — it only ever INSERTs a
//  brand-new `caregivers` row (same shape medico's own admin panel
//  creates), never updates or deletes an existing medico row. Every
//  other write Buddy/Connect need goes in this backend's own tables
//  (caregiver_profiles, caregiver_uploads, ayuxa_service_visits, ...).
// ──────────────────────────────────────────────

const crypto = require('crypto');
const medico = require('../config/medicoDatabase');

// Deleting a medico User is a soft delete: status flips to 'DELETED' and
// phone is mangled to `deleted_<uuid>_<original phone>` (to free up the
// unique constraint for reuse) — the row itself is never removed. Every
// patient-facing lookup below must exclude DELETED rows, or a phone
// number recycled by a new signup can resolve back to the old deleted
// account (either because the mangled phone still matches a last-10-digit
// suffix search, or because id/uniqueUserId lookups never touch phone at
// all and so never even see the mangling).

/**
 * Look up a medico patient (User) by phone. Tries an exact match first,
 * then falls back to a last-10-digit suffix match so +91/leading-zero/
 * spacing differences between what was typed and how medico stored the
 * number don't block lookups. Both branches exclude soft-deleted users.
 */
const findUserByPhone = async (phone) => {
    const exact = await medico.users.findFirst({ where: { phone, status: { not: 'DELETED' } } });
    if (exact) return exact;

    const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
    if (last10.length !== 10) return null;
    return medico.users.findFirst({
        where: { phone: { endsWith: last10 }, status: { not: 'DELETED' } },
        orderBy: { createdAt: 'desc' },
    });
};

/** Look up a medico patient (User) by id, excluding soft-deleted accounts. */
const findUserById = (id) => medico.users.findFirst({ where: { id, status: { not: 'DELETED' } } });

/** Same as findUserById but includes soft-deleted accounts — admin support views only. */
const findUserByIdIncludingDeleted = (id) => medico.users.findUnique({ where: { id } });

/**
 * Look up a medico patient (User) by their public "Ayuxa ID"
 * (medico's uniqueUserId, e.g. MED-BLR-00001) — used by Ayuxa Connect's
 * family-linking flows. Excludes soft-deleted accounts — uniqueUserId
 * isn't mangled on delete, so a deleted patient would otherwise still
 * resolve here.
 */
const findUserByUniqueUserId = (uniqueUserId) =>
    medico.users.findFirst({ where: { uniqueUserId, status: { not: 'DELETED' } } });

/**
 * True if `phone` is a registered emergency contact for the given patient
 * (a patient can have multiple emergency contacts) — used by Ayuxa
 * Connect's "Emergency Contact" login mode.
 */
const isEmergencyContactForUser = async (userId, phone) => {
    const match = await medico.emergency_contacts.findFirst({ where: { userId, phone } });
    return !!match;
};

/**
 * Look up a medico caregiver by phone — used for Buddy login. Tries an
 * exact match first (fast path), then falls back to a last-10-digit
 * suffix match so +91/leading-zero/spacing differences between what the
 * caregiver typed and how medico stored the number don't block login.
 */
const findCaregiverByPhone = async (phone) => {
    const exact = await medico.caregivers.findUnique({ where: { phone } });
    if (exact) return exact;

    const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
    if (last10.length !== 10) return null;
    return medico.caregivers.findFirst({ where: { phone: { endsWith: last10 } } });
};

/** Look up a medico caregiver by email — used for Buddy email-OTP login. */
const findCaregiverByEmail = (email) => medico.caregivers.findFirst({ where: { email } });

/** Look up a medico caregiver by id. */
const findCaregiverById = (id) => medico.caregivers.findUnique({ where: { id }, include: { cities: { select: { name: true } } } });

/** A patient's medico-side health reports (for display alongside Ayuxa's own records). */
const listHealthReportsForUser = (userId) =>
    medico.health_reports.findMany({ where: { userId }, orderBy: { reportDate: 'desc' } });

/** A patient's medico-side emergency contacts. */
const listEmergencyContactsForUser = (userId) =>
    medico.emergency_contacts.findMany({ where: { userId } });

/**
 * A patient's active/most-recent subscriptions with plan details — read
 * only (see connect.controller.js: family accounts can't authenticate as
 * the patient in medico, so real payment actions aren't proxied here).
 */
const listSubscriptionsForUser = (userId) =>
    medico.subscriptions.findMany({
        where: { userId },
        include: { plans_subscriptions_planIdToplans: true },
        orderBy: { createdAt: 'desc' },
    });


/** Visible plans of one planType (CARE | HOMEMAKER) with benefits + billing cycles, like medico's /plans/by-category (COMPANION inherits Lifeline benefits). */
const listPlansByType = async (planType) => {
    const include = { plan_benefits: { orderBy: { displayOrder: 'asc' } }, plan_billing_cycles: true };
    const plans = await medico.plans.findMany({ where: { planType: planType.toUpperCase(), isVisible: true }, orderBy: { sortOrder: 'asc' }, include });
    const isCompanion = (p) => (p.name || '').toUpperCase().includes('COMPANION') || p.metadata?.code === 'COMPANION';
    const lifeline = plans.some(isCompanion)
        ? await medico.plans.findFirst({ where: { OR: [{ name: { contains: 'Lifeline', mode: 'insensitive' } }, { name: { contains: 'Care Plan', mode: 'insensitive' } }] }, include })
        : null;
    return plans.map((p) => {
        const inherited = isCompanion(p) && lifeline ? lifeline.plan_benefits.map((b) => ({ ...b, id: `inherited-${b.id}`, planId: p.id })) : [];
        const { plan_benefits, plan_billing_cycles, ...rest } = p;
        return { ...rest, planBenefits: [...inherited, ...plan_benefits], billingCycles: plan_billing_cycles };
    });
};

/** A patient's memberships grouped by planType, like medico's /subscriptions/me/memberships. */
const getMembershipsForUser = async (userId) => {
    const include = { plans_subscriptions_planIdToplans: true, plans_subscriptions_scheduledPlanIdToplans: true };
    const toItem = (sub, o = {}) => {
        const plan = sub.plans_subscriptions_planIdToplans;
        return {
            id: sub.id, planId: sub.planId, planName: plan.name, planType: plan.planType,
            maxConcurrent: plan.maxConcurrent, tierLevel: plan.tierLevel, status: sub.status,
            billingCycle: sub.billingCycle, startDate: sub.startDate, expiryDate: sub.expiryDate,
            daysRemaining: Math.max(0, Math.floor((new Date(sub.expiryDate) - new Date()) / 86400000)),
            amount: sub.amount, autoRenew: sub.autoRenew,
            scheduledDowngrade: sub.plans_subscriptions_scheduledPlanIdToplans
                ? { planId: sub.scheduledPlanId, planName: sub.plans_subscriptions_scheduledPlanIdToplans.name, activatesOn: sub.scheduledChangeDate } : null,
            ...o,
        };
    };
    const live = await medico.subscriptions.findMany({
        where: { userId, status: { in: ['ACTIVE', 'SCHEDULED_DOWNGRADE', 'EXPIRING'] }, expiryDate: { gte: new Date() } },
        include, orderBy: { createdAt: 'desc' },
    });
    const grouped = {};
    for (const sub of live) (grouped[sub.plans_subscriptions_planIdToplans.planType || 'CARE'] ||= []).push(toItem(sub));
    for (const cat of ['CARE', 'HOMEMAKER']) {
        if (grouped[cat]?.length) continue;
        const last = await medico.subscriptions.findFirst({ where: { userId, plans_subscriptions_planIdToplans: { planType: cat } }, include, orderBy: { expiryDate: 'desc' } });
        if (last) grouped[cat] = [toItem(last, { status: last.status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED', daysRemaining: 0, scheduledDowngrade: null })];
    }
    return { memberships: grouped, categories: Object.keys(grouped) };
};

/** A patient's payment history — read only, same reasoning as above. */
const listPaymentsForUser = (userId) =>
    medico.payments.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

/** A caregiver's medico-side bookings — used to seed Buddy check-in screens. */
const listBookingsForCaregiver = (caregiverId) =>
    medico.bookings.findMany({
        where: { caregiverId },
        orderBy: { scheduledDate: 'desc' },
        include: { users: { select: { id: true, name: true, phone: true } } },
    });

const findBookingById = (id) => medico.bookings.findUnique({ where: { id } });

/** Cities a new caregiver can be assigned to (defaults new signups to the first enabled city). */
const listEnabledCities = () =>
    medico.cities.findMany({ where: { isEnabled: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } });

/** Paginated/searchable medico patients (Users) — admin panel's Connect patient lookup. */
const listUsers = ({ skip, take, search }) => {
    const where = search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { uniqueUserId: { contains: search, mode: 'insensitive' } }] }
        : {};
    return medico.users.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
};

const countUsers = (search) => {
    const where = search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { uniqueUserId: { contains: search, mode: 'insensitive' } }] }
        : {};
    return medico.users.count({ where });
};

/**
 * The one sanctioned write into medico's schema: creates a brand-new
 * `caregivers` row for Buddy self-signup, identical in shape to what
 * medico's own admin panel writes (see medico/backend/src/controllers/
 * caregiver.controller.js `createCaregiver`). Never updates or deletes
 * an existing medico row.
 */
const createCaregiver = ({ name, phone, email, cityId }) =>
    medico.caregivers.create({
        data: {
            id: crypto.randomUUID(),
            name,
            phone,
            email,
            cityId,
            updatedAt: new Date(),
        },
    });

/** Updates name/email/specialization on an existing medico caregiver row (never touches other fields). */
const updateCaregiverProfile = (id, { name, email, specialization }) =>
    medico.caregivers.update({
        where: { id },
        data: {
            ...(name !== undefined && { name }),
            ...(email !== undefined && { email }),
            ...(specialization !== undefined && { specialization }),
            updatedAt: new Date(),
        },
    });

/**
 * Updates name+phone on an existing emergency_contacts row for a patient —
 * emergency_contact_card.dart's edit action. `id` has no compound unique
 * with `userId` in medico's schema, so ownership is verified with a fetch
 * first — the caller (connect.controller.js) must never skip this check,
 * since it's what stops a family account from editing a contact on a
 * patient it isn't linked to.
 */
const updateEmergencyContact = async (userId, contactId, { name, phone }) => {
    const existing = await medico.emergency_contacts.findUnique({ where: { id: contactId } });
    if (!existing || existing.userId !== userId) return null;

    return medico.emergency_contacts.update({
        where: { id: contactId },
        data: {
            ...(name !== undefined && { name }),
            ...(phone !== undefined && { phone }),
            updatedAt: new Date(),
        },
    });
};

module.exports = {
    findUserByPhone,
    findUserById,
    findUserByIdIncludingDeleted,
    findUserByUniqueUserId,
    isEmergencyContactForUser,
    findCaregiverByPhone,
    findCaregiverByEmail,
    findCaregiverById,
    listHealthReportsForUser,
    listEmergencyContactsForUser,
    listSubscriptionsForUser,
    listPaymentsForUser,
    listPlansByType,
    getMembershipsForUser,
    listBookingsForCaregiver,
    findBookingById,
    listEnabledCities,
    listUsers,
    countUsers,
    createCaregiver,
    updateCaregiverProfile,
    updateEmergencyContact,
};
