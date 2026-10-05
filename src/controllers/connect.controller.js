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

/** PUT /api/connect/me */
const updateMe = async (req, res, next) => {
    try {
        const { name, email, photoUrl } = req.body;
        const account = await prisma.familyAccount.update({
            where: { id: req.familyAccount.id },
            data: {
                ...(name !== undefined && { name }),
                ...(email !== undefined && { email }),
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
            return { relation: link.relation, canEdit: link.canEdit, patient: sanitizePatient(user), healthReports, emergencyContacts, careTeam, serviceVisits };
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

/**
 * PUT /api/connect/patients/:patientUserId/emergency-contact/:contactId —
 * emergency_contact_card.dart's edit action.
 */
const updateEmergencyContact = async (req, res, next) => {
    try {
        const link = await requireLink(req, res, req.params.patientUserId);
        if (!link) return;
        if (!link.canEdit) return res.status(403).json({ success: false, message: 'This link is view-only' });

        const { name, phone } = req.body;
        const updated = await medicoRepo.updateEmergencyContact(req.params.patientUserId, req.params.contactId, { name, phone });
        if (!updated) return res.status(404).json({ success: false, message: 'Emergency contact not found' });

        await notifyAccount(req.familyAccount.id, {
            title: 'Emergency Contact Updated',
            body: `Emergency contact details were updated.`,
            category: 'recordUpdated',
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
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
    getMe, updateMe, linkPatient, listLinkedPatients,
    listMedicalRecords, listServiceHistory, getCareTeam, updateEmergencyContact,
    listSubscriptions, listPayments, listPlans, getMemberships,
    listUploads, addUpload, getFileUrl,
    listNotifications, markAllNotificationsRead,
    deleteAccount,
    addCareTeamMember,
};
