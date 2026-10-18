// ──────────────────────────────────────────────
//  Connect Controller — Ayuxa Connect (patient & family app)
//  The logged-in actor is a FamilyAccount (req.familyAccount); patient
//  identity/medical data comes from medico's `users`/`health_reports`/
//  `subscriptions`/`payments` tables via medicoRepo, joined with
//  Ayuxa-owned care_team_members / ayuxa_service_visits / connect_uploads
//  / connect_notifications.
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');
const otpService = require('../services/otp.service');
const billing = require('../services/medicoBilling.service');
const { isValidName, isValidEmail, normalizeIndianMobile, isRealIndianMobile } = require('../utils/validators');

/** Throws-as-response guard: is this family account linked to this patient? */
async function requireLink(req, res, patientUserId) {
    const link = await prisma.familyPatientLink.findUnique({
        where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId } },
    });
    if (!link) {
        res.status(403).json({ success: false, message: 'Not linked to this patient' });
        return null;
    }
    return link;
}

async function notifyAccount(accountId, { title, body, category }) {
    await prisma.connectNotification.create({ data: { accountId, title, body, category } });
}

/** Strips medico's internal/session fields (refreshToken, otpCode, etc.) before exposing a patient to a family account. */
function sanitizePatient(user) {
    return {
        id: user.id,
        name: user.name,
        uniqueUserId: user.uniqueUserId,
        phone: user.phone,
        email: user.email,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        profileImageUrl: user.profileImageUrl,
        healthTag: user.healthTag,
        status: user.status,
    };
}

/** Strips the session refresh token before exposing a FamilyAccount to its own client. */
function sanitizeAccount(account) {
    const { refreshToken, ...safe } = account;
    return safe;
}

/** GET /api/connect/me */
const getMe = async (req, res, next) => {
    try {
        const account = await prisma.familyAccount.findUnique({
            where: { id: req.familyAccount.id },
            include: { links: true },
        });
        res.json({ success: true, data: sanitizeAccount(account) });
    } catch (error) {
        next(error);
    }
};

/** POST /api/connect/me/email/request-otp { email } — sends a code to a new email so it can be verified before it is saved */
const requestEmailOtp = async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!isValidEmail(email)) return res.status(422).json({ success: false, message: 'Please enter a valid email address.' });
        const result = await otpService.requestOTP(email);
        if (!result.success) return res.status(502).json({ success: false, message: 'Failed to send the verification code. Please try again.' });
        res.json({ success: true, message: 'Verification code sent' });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/connect/me — name, photo, and email (a changed email needs the OTP sent to it) */
const updateMe = async (req, res, next) => {
    try {
        const { name, email, photoUrl, emailOtp } = req.body;
        const fail = (status, message, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

        if (name !== undefined && !isValidName(name)) return fail(422, 'Please enter a valid name containing only letters.');

        let nextEmail;
        if (email !== undefined) {
            nextEmail = String(email || '').trim().toLowerCase();
            if (nextEmail && !isValidEmail(nextEmail)) return fail(422, 'Please enter a valid email address (it must contain @ and a domain).');
            const current = String(req.familyAccount.email || '').trim().toLowerCase();
            if (nextEmail === current) {
                nextEmail = undefined;
            } else if (nextEmail) {
                if (!emailOtp) return fail(403, 'Verify the new email with the code sent to it before saving.', 'EMAIL_VERIFICATION_REQUIRED');
                const verification = await otpService.verifyOTP(nextEmail, String(emailOtp));
                if (!verification.success) return fail(400, 'Invalid or expired verification code.');
            }
        }

        const account = await prisma.familyAccount.update({
            where: { id: req.familyAccount.id },
            data: {
                ...(name !== undefined && { name: String(name).trim() }),
                ...(nextEmail !== undefined && { email: nextEmail || null }),
                ...(photoUrl !== undefined && { photoUrl }),
            },
        });
        res.json({ success: true, data: sanitizeAccount(account) });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/connect/me/patients — link_family_member_screen.dart's "My
 * Mobile" link flow: proves the family member knows the patient's Ayuxa ID
 * (medico uniqueUserId) AND their primary registered mobile number.
 */
const linkPatient = async (req, res, next) => {
    try {
        const { ayuxaId, primaryMobile, relation } = req.body;

        const patient = await medicoRepo.findUserByUniqueUserId(ayuxaId);
        if (!patient) {
            return res.status(404).json({ success: false, message: 'No Ayuxa patient found with that Ayuxa ID.' });
        }
        // Compare last-10-digits so +91/leading-zero formatting differences don't block a real match.
        const normalize = (n) => String(n || '').replace(/\D/g, '').slice(-10);
        if (normalize(patient.phone) !== normalize(primaryMobile)) {
            return res.status(403).json({ success: false, message: "That mobile number doesn't match this patient's records." });
        }

        const link = await prisma.familyPatientLink.upsert({
            where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId: patient.id } },
            update: { relation: relation || 'Family' },
            create: { accountId: req.familyAccount.id, patientUserId: patient.id, relation: relation || 'Family' },
        });

        res.status(201).json({ success: true, data: { link, patient: sanitizePatient(patient) } });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/me/patients — every patient this family account can see, with medical data */
const listLinkedPatients = async (req, res, next) => {
    try {
        const links = await prisma.familyPatientLink.findMany({ where: { accountId: req.familyAccount.id } });

        const patients = await Promise.all(links.map(async (link) => {
            const [user, healthReports, emergencyContacts, careTeam, serviceVisits] = await Promise.all([
                medicoRepo.findUserById(link.patientUserId),
                medicoRepo.listHealthReportsForUser(link.patientUserId),
                medicoRepo.listEmergencyContactsForUser(link.patientUserId),
                prisma.careTeamMember.findMany({ where: { patientUserId: link.patientUserId } }),
                prisma.serviceVisit.findMany({ where: { patientUserId: link.patientUserId }, orderBy: { visitDate: 'desc' } }),
            ]);
            if (!user) return null;
            return { relation: link.relation, canEdit: link.canEdit, patient: sanitizePatient(user), healthReports, emergencyContacts: await withContactPrefs(emergencyContacts), careTeam, serviceVisits };
        }));

        res.json({ success: true, data: patients.filter(Boolean) });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/patients/:patientUserId/medical-records?category=X */
const listMedicalRecords = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;

        const reports = await medicoRepo.listHealthReportsForUser(req.params.patientUserId);
        const filtered = req.query.category ? reports.filter((r) => r.category === req.query.category) : reports;
        res.json({ success: true, data: filtered });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/patients/:patientUserId/service-history?providerType=X */
const listServiceHistory = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;

        const where = { patientUserId: req.params.patientUserId, ...(req.query.providerType && { providerType: req.query.providerType }) };
        const visits = await prisma.serviceVisit.findMany({ where, orderBy: { visitDate: 'desc' } });
        res.json({ success: true, data: visits });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/patients/:patientUserId/care-team */
const getCareTeam = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;

        const team = await prisma.careTeamMember.findMany({ where: { patientUserId: req.params.patientUserId } });
        res.json({ success: true, data: team });
    } catch (error) {
        next(error);
    }
};

const CONTACT_RELATIONSHIPS = ['Spouse', 'Son', 'Daughter', 'Parent', 'Sibling', 'Relative', 'Friend', 'Neighbour', 'Other'];
const MAX_EMERGENCY_CONTACTS = 5;

/** Adds each contact's Ayuxa-side preferences (SMS alerts opt-in). */
async function withContactPrefs(contacts) {
    if (!contacts.length) return [];
    const prefs = await prisma.emergencyContactPref.findMany({ where: { contactId: { in: contacts.map((c) => c.id) } } });
    const byId = new Map(prefs.map((p) => [p.contactId, p]));
    return contacts.map((c) => ({ ...c, smsAlerts: byId.get(c.id)?.smsAlerts ?? false }));
}

const setSmsPref = (patientUserId, contactId, smsAlerts) =>
    prisma.emergencyContactPref.upsert({
        where: { contactId },
        update: { smsAlerts: !!smsAlerts },
        create: { patientUserId, contactId, smsAlerts: !!smsAlerts },
    });

/** Validates name / phone / relationship; returns { error } or { value }. */
function validateContact({ name, phone, relationship }, { partial = false } = {}) {
    const value = {};
    if (!partial || name !== undefined) {
        if (!isValidName(name)) return { error: 'Please enter a valid contact name containing only letters.' };
        value.name = String(name).trim();
    }
    if (!partial || phone !== undefined) {
        if (!normalizeIndianMobile(phone)) return { error: 'Enter a valid 10-digit mobile number (it must start with 6, 7, 8 or 9).' };
        if (!isRealIndianMobile(phone)) return { error: 'That looks like a dummy number. Please enter the contact\'s real mobile number.' };
        value.phone = normalizeIndianMobile(phone);
    }
    if (!partial || relationship !== undefined) {
        const rel = String(relationship || 'Other').trim();
        if (!CONTACT_RELATIONSHIPS.includes(rel)) return { error: 'Please choose a valid relationship.' };
        value.relationship = rel;
    }
    return { value };
}

const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);

/** POST /api/connect/patients/:patientUserId/emergency-contacts — adds a contact (what "Add emergency contact" calls) */
const addEmergencyContact = async (req, res, next) => {
    try {
        const link = await requireLink(req, res, req.params.patientUserId);
        if (!link) return;
        if (!link.canEdit) return res.status(403).json({ success: false, message: 'This link is view-only' });

        const { error, value } = validateContact(req.body);
        if (error) return res.status(422).json({ success: false, message: error });

        const existing = await medicoRepo.listEmergencyContactsForUser(req.params.patientUserId);
        if (existing.length >= MAX_EMERGENCY_CONTACTS) {
            return res.status(409).json({ success: false, message: `You can add up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.` });
        }
        if (existing.some((c) => last10(c.phone) === value.phone)) {
            return res.status(409).json({ success: false, message: 'That number is already an emergency contact.' });
        }

        const created = await medicoRepo.createEmergencyContact(req.params.patientUserId, value);
        await setSmsPref(req.params.patientUserId, created.id, req.body.smsAlerts);

        await notifyAccount(req.familyAccount.id, {
            title: 'Emergency Contact Added',
            body: `${value.name} was added as an emergency contact.`,
            category: 'recordUpdated',
        });
        res.status(201).json({ success: true, data: (await withContactPrefs([created]))[0] });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/connect/patients/:patientUserId/emergency-contact/:contactId — edit name, number, relationship, SMS opt-in */
const updateEmergencyContact = async (req, res, next) => {
    try {
        const link = await requireLink(req, res, req.params.patientUserId);
        if (!link) return;
        if (!link.canEdit) return res.status(403).json({ success: false, message: 'This link is view-only' });

        const { error, value } = validateContact(req.body, { partial: true });
        if (error) return res.status(422).json({ success: false, message: error });

        if (value.phone) {
            const others = (await medicoRepo.listEmergencyContactsForUser(req.params.patientUserId)).filter((c) => c.id !== req.params.contactId);
            if (others.some((c) => last10(c.phone) === value.phone)) {
                return res.status(409).json({ success: false, message: 'That number is already an emergency contact.' });
            }
        }

        const updated = await medicoRepo.updateEmergencyContact(req.params.patientUserId, req.params.contactId, value);
        if (!updated) return res.status(404).json({ success: false, message: 'Emergency contact not found' });
        if (req.body.smsAlerts !== undefined) await setSmsPref(req.params.patientUserId, updated.id, req.body.smsAlerts);

        await notifyAccount(req.familyAccount.id, {
            title: 'Emergency Contact Updated',
            body: 'Emergency contact details were updated.',
            category: 'recordUpdated',
        });
        res.json({ success: true, data: (await withContactPrefs([updated]))[0] });
    } catch (error) {
        next(error);
    }
};

/** DELETE /api/connect/patients/:patientUserId/emergency-contact/:contactId */
const deleteEmergencyContact = async (req, res, next) => {
    try {
        const link = await requireLink(req, res, req.params.patientUserId);
        if (!link) return;
        if (!link.canEdit) return res.status(403).json({ success: false, message: 'This link is view-only' });

        const removed = await medicoRepo.deleteEmergencyContact(req.params.patientUserId, req.params.contactId);
        if (!removed) return res.status(404).json({ success: false, message: 'Emergency contact not found' });
        await prisma.emergencyContactPref.deleteMany({ where: { contactId: req.params.contactId } });
        res.json({ success: true, message: 'Emergency contact removed' });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/support — support contact details shown on the Contact Support screen */
const getSupport = (req, res) => {
    const phone = String(process.env.SUPPORT_PHONE || '08047280789').replace(/\D/g, '');
    const whatsapp = String(process.env.SUPPORT_WHATSAPP || '919480198108').replace(/\D/g, '');
    res.json({
        success: true,
        data: {
            phone,
            phoneDisplay: process.env.SUPPORT_PHONE_DISPLAY || '080 4728 0789',
            whatsapp,
            email: process.env.SUPPORT_EMAIL || 'support@ayuxacare.com',
            hours: process.env.SUPPORT_HOURS || '',
        },
    });
};

// ─── Plan checkout (Razorpay, via medico's billing) ───

const CYCLE_PRICE = { QUARTERLY: 'quarterlyPrice', BIANNUAL: 'biannualPrice', YEARLY: 'yearlyPrice' };

function sendBillingError(res, error, next) {
    if (error instanceof billing.BillingError) return res.status(error.status).json({ success: false, message: error.message });
    return next(error);
}

/** Resolves the link and checks this account may pay for the patient. */
async function requirePayerLink(req, res) {
    const link = await requireLink(req, res, req.params.patientUserId);
    if (!link) return null;
    if (!link.canEdit) {
        res.status(403).json({ success: false, message: 'This link is view-only, so it cannot buy or change plans.' });
        return null;
    }
    return link;
}

/**
 * POST /api/connect/patients/:patientUserId/checkout/start { planId, billingCycle }
 * The price is read from the plan here — the app's number is never trusted.
 */
const startCheckout = async (req, res, next) => {
    try {
        if (!(await requirePayerLink(req, res))) return;
        const { planId, billingCycle } = req.body;
        if (!CYCLE_PRICE[billingCycle]) return res.status(422).json({ success: false, message: 'Choose a billing period.' });

        const plan = await medicoRepo.findPlanById(planId);
        if (!plan) return res.status(404).json({ success: false, message: 'That plan is no longer available.' });
        const amount = plan[CYCLE_PRICE[billingCycle]];
        if (!(amount > 0)) return res.status(422).json({ success: false, message: 'This plan is priced on demand — please contact support to subscribe.' });

        const order = await billing.startSubscription(req.params.patientUserId, { planId, billingCycle, amount });
        res.json({ success: true, data: { ...order, planName: plan.name } });
    } catch (error) {
        sendBillingError(res, error, next);
    }
};

/** POST /api/connect/patients/:patientUserId/checkout/verify { razorpayOrderId, razorpayPaymentId, razorpaySignature } */
const verifyCheckout = async (req, res, next) => {
    try {
        if (!(await requirePayerLink(req, res))) return;
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(422).json({ success: false, message: 'Payment details are incomplete.' });
        }
        const result = await billing.verifyPayment(req.params.patientUserId, { razorpayOrderId, razorpayPaymentId, razorpaySignature });

        await notifyAccount(req.familyAccount.id, {
            title: 'Payment Successful',
            body: 'Your plan payment was received. Your membership is being activated.',
            category: 'recordUpdated',
        });
        res.json({ success: true, message: result.message || 'Payment verified', data: result.data });
    } catch (error) {
        sendBillingError(res, error, next);
    }
};

/** POST /api/connect/patients/:patientUserId/checkout/cancel { orderId } — checkout dismissed or failed */
const cancelCheckout = async (req, res, next) => {
    try {
        if (!(await requirePayerLink(req, res))) return;
        if (req.body.orderId) await billing.cancelPayment(req.params.patientUserId, req.body.orderId).catch(() => {});
        res.json({ success: true });
    } catch (error) {
        sendBillingError(res, error, next);
    }
};

// ─── Subscriptions & payments (read-only — see connect.routes.js) ───

/** GET /api/connect/patients/:patientUserId/subscriptions */
const listSubscriptions = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const subs = await medicoRepo.listSubscriptionsForUser(req.params.patientUserId);
        res.json({ success: true, data: subs });
    } catch (error) {
        next(error);
    }
};


/** GET /api/connect/plans?planType=CARE|HOMEMAKER — same data as medico's plans-by-category */
const listPlans = async (req, res, next) => {
    try {
        const planType = String(req.query.planType || 'CARE').toUpperCase();
        if (!['CARE', 'HOMEMAKER'].includes(planType)) return res.status(400).json({ success: false, message: 'planType must be CARE or HOMEMAKER' });
        res.json({ success: true, data: await medicoRepo.listPlansByType(planType) });
    } catch (error) { next(error); }
};

/** GET /api/connect/patients/:patientUserId/memberships — current plan(s); available to every linked login mode, incl. emergency contacts */
const getMemberships = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        res.json({ success: true, data: await medicoRepo.getMembershipsForUser(req.params.patientUserId) });
    } catch (error) { next(error); }
};

/** GET /api/connect/patients/:patientUserId/payments */
const listPayments = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const payments = await medicoRepo.listPaymentsForUser(req.params.patientUserId);
        res.json({ success: true, data: payments });
    } catch (error) {
        next(error);
    }
};

// ─── Documents ────────────────────────────────

/** GET /api/connect/patients/:patientUserId/uploads?source=AYUXA|FAMILY */
const listUploads = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const { patientUserId } = req.params;

        const patient = await medicoRepo.findUserById(patientUserId);
        const [connectUploads, caregiverUploads] = await Promise.all([
            prisma.connectUpload.findMany({ where: { patientUserId }, orderBy: { uploadedAt: 'desc' } }),
            // Documents Ayuxa Buddy caregivers uploaded for this patient are the
            // "Ayuxa Documents" tab — matched by id, or by the patient's Ayuxa ID.
            prisma.caregiverUpload.findMany({
                where: { OR: [{ patientUserId }, ...(patient ? [{ patientCode: patient.uniqueUserId }] : [])] },
                orderBy: { uploadedAt: 'desc' },
            }),
        ]);

        const merged = [
            ...connectUploads,
            ...caregiverUploads.map((u) => ({
                id: u.id, patientUserId, fileName: u.fileName, fileUrl: u.fileUrl, category: u.category,
                source: 'AYUXA', uploadedBy: u.uploadedBy, uploadedAt: u.uploadedAt,
            })),
        ].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

        const source = req.query.source;
        res.json({ success: true, data: source ? merged.filter((u) => u.source === source) : merged });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/connect/patients/:patientUserId/file-url  { url }
 * Returns a fresh, short-lived link for a file that belongs to this patient
 * (a health report or an upload), so tapping a document opens it. Only links
 * already stored against the patient are accepted — never an arbitrary URL.
 */
const getFileUrl = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const { patientUserId } = req.params;
        const { url } = req.body;
        if (!url) return res.status(422).json({ success: false, message: 'url is required' });

        const patient = await medicoRepo.findUserById(patientUserId);
        const [reports, connectFile, caregiverFile] = await Promise.all([
            medicoRepo.listHealthReportsForUser(patientUserId),
            prisma.connectUpload.findFirst({ where: { patientUserId, fileUrl: url } }),
            prisma.caregiverUpload.findFirst({
                where: { fileUrl: url, OR: [{ patientUserId }, ...(patient ? [{ patientCode: patient.uniqueUserId }] : [])] },
            }),
        ]);
        const owned = connectFile || caregiverFile || reports.some((r) => r.fileUrl === url);
        if (!owned) return res.status(404).json({ success: false, message: 'File not found for this patient' });

        const { getFreshReadUrl } = require('../services/providers/gcs.service');
        res.json({ success: true, data: { url: await getFreshReadUrl(url) } });
    } catch (error) {
        next(error);
    }
};

/** POST /api/connect/patients/:patientUserId/uploads — family_documents_screen.dart's upload flow */
const addUpload = async (req, res, next) => {
    try {
        const link = await requireLink(req, res, req.params.patientUserId);
        if (!link) return;

        const { fileName, fileUrl, category } = req.body;
        const upload = await prisma.connectUpload.create({
            data: {
                patientUserId: req.params.patientUserId,
                uploadedByAccountId: req.familyAccount.id,
                fileName, fileUrl, category,
                source: 'FAMILY',
                uploadedBy: req.familyAccount.name || req.familyAccount.phone,
            },
        });

        await notifyAccount(req.familyAccount.id, {
            title: 'Document Uploaded',
            body: `${category} uploaded successfully.`,
            category: 'documentUploaded',
        });

        res.status(201).json({ success: true, data: upload });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/connect/patients/:patientUserId/uploads/:uploadId — rename,
 * re-categorise or replace the file of a document the family uploaded.
 * Documents uploaded by Ayuxa staff (source AYUXA) are read-only here.
 */
const updateUpload = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const existing = await prisma.connectUpload.findFirst({
            where: { id: req.params.uploadId, patientUserId: req.params.patientUserId, source: 'FAMILY' },
        });
        if (!existing) return res.status(404).json({ success: false, message: 'Document not found' });

        const { fileName, fileUrl, category } = req.body;
        const upload = await prisma.connectUpload.update({
            where: { id: existing.id },
            data: {
                ...(fileName !== undefined && { fileName }),
                ...(fileUrl !== undefined && { fileUrl }),
                ...(category !== undefined && { category }),
            },
        });
        res.json({ success: true, data: upload });
    } catch (error) {
        next(error);
    }
};

/** DELETE /api/connect/patients/:patientUserId/uploads/:uploadId — remove a family-uploaded document */
const deleteUpload = async (req, res, next) => {
    try {
        if (!(await requireLink(req, res, req.params.patientUserId))) return;
        const result = await prisma.connectUpload.deleteMany({
            where: { id: req.params.uploadId, patientUserId: req.params.patientUserId, source: 'FAMILY' },
        });
        if (result.count === 0) return res.status(404).json({ success: false, message: 'Document not found' });
        res.json({ success: true, message: 'Document removed' });
    } catch (error) {
        next(error);
    }
};

// ─── Notifications ────────────────────────────

/** GET /api/connect/me/notifications */
const listNotifications = async (req, res, next) => {
    try {
        const notifications = await prisma.connectNotification.findMany({
            where: { accountId: req.familyAccount.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: notifications });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/connect/me/device-token  { token } — registers this device for push; null clears it (logout) */
const setDeviceToken = async (req, res, next) => {
    try {
        const token = req.body.token ? String(req.body.token) : null;
        // A phone shared by two family accounts must only push to the one signed in now.
        if (token) await prisma.familyAccount.updateMany({ where: { fcmDeviceToken: token, NOT: { id: req.familyAccount.id } }, data: { fcmDeviceToken: null } });
        await prisma.familyAccount.update({ where: { id: req.familyAccount.id }, data: { fcmDeviceToken: token } });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/connect/me/notifications/:notificationId/read */
const markNotificationRead = async (req, res, next) => {
    try {
        const result = await prisma.connectNotification.updateMany({
            where: { id: req.params.notificationId, accountId: req.familyAccount.id },
            data: { read: true },
        });
        if (result.count === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/connect/me/notifications/read-all */
const markAllNotificationsRead = async (req, res, next) => {
    try {
        await prisma.connectNotification.updateMany({
            where: { accountId: req.familyAccount.id, read: false },
            data: { read: true },
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

// ─── Account deletion ─────────────────────────

/**
 * DELETE /api/connect/me — delete_account_screen.dart's "Right to be
 * Forgotten" flow. Wipes this family account's own Ayuxa-owned data (links,
 * uploads it made, notifications, sessions — via cascade) and clears its
 * medico-facing refresh token. Never touches the patient's own medico
 * records — those aren't this family account's data to delete.
 */
const deleteAccount = async (req, res, next) => {
    try {
        await prisma.familyAccount.delete({ where: { id: req.familyAccount.id } });
        res.clearCookie('auth-token');
        res.clearCookie('refresh-token');
        res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
        next(error);
    }
};

// ─── Admin-facing ────────────────────────────

/** POST /api/connect/care-team (admin) — assign a caregiver/provider to a patient's visible care team */
const addCareTeamMember = async (req, res, next) => {
    try {
        const { patientUserId, caregiverId, name, role, phone, photoUrl } = req.body;
        const member = await prisma.careTeamMember.create({
            data: { patientUserId, caregiverId, name, role, phone, photoUrl },
        });
        res.status(201).json({ success: true, data: member });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMe, updateMe, requestEmailOtp, linkPatient, listLinkedPatients,
    listMedicalRecords, listServiceHistory, getCareTeam,
    addEmergencyContact, updateEmergencyContact, deleteEmergencyContact, getSupport,
    startCheckout, verifyCheckout, cancelCheckout,
    listSubscriptions, listPayments, listPlans, getMemberships,
    listUploads, addUpload, updateUpload, deleteUpload, getFileUrl,
    listNotifications, markAllNotificationsRead, markNotificationRead, setDeviceToken,
    deleteAccount,
    addCareTeamMember,
};
