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

/** Look up a medico patient (User) by phone — used for Connect family login lookups. */
const findUserByPhone = (phone) => medico.users.findUnique({ where: { phone } });

/** Look up a medico patient (User) by id. */
const findUserById = (id) => medico.users.findUnique({ where: { id } });

/** Look up a medico caregiver by phone — used for Buddy login. */
const findCaregiverByPhone = (phone) => medico.caregivers.findUnique({ where: { phone } });

/** Look up a medico caregiver by email — used for Buddy email-OTP login. */
const findCaregiverByEmail = (email) => medico.caregivers.findFirst({ where: { email } });

/** Look up a medico caregiver by id. */
const findCaregiverById = (id) => medico.caregivers.findUnique({ where: { id } });

/** A patient's medico-side health reports (for display alongside Ayuxa's own records). */
const listHealthReportsForUser = (userId) =>
    medico.health_reports.findMany({ where: { userId }, orderBy: { reportDate: 'desc' } });

/** A patient's medico-side emergency contacts. */
const listEmergencyContactsForUser = (userId) =>
    medico.emergency_contacts.findMany({ where: { userId } });

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

module.exports = {
    findUserByPhone,
    findUserById,
    findCaregiverByPhone,
    findCaregiverByEmail,
    findCaregiverById,
    listHealthReportsForUser,
    listEmergencyContactsForUser,
    listBookingsForCaregiver,
    findBookingById,
    listEnabledCities,
    createCaregiver,
    updateCaregiverProfile,
};
