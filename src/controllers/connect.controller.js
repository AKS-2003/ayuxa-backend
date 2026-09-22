// ──────────────────────────────────────────────
//  Connect Controller — Ayuxa Connect (patient & family app)
//  The logged-in actor is a FamilyAccount (req.familyAccount); patient
//  identity/medical data comes from medico's `users`/`health_reports`
//  tables via medicoRepo, joined with Ayuxa-owned care_team_members /
//  ayuxa_service_visits.
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');

/** GET /api/connect/me */
const getMe = async (req, res, next) => {
    try {
        const account = await prisma.familyAccount.findUnique({
            where: { id: req.familyAccount.id },
            include: { links: true },
        });
        res.json({ success: true, data: account });
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
        res.json({ success: true, data: account });
    } catch (error) {
        next(error);
    }
};

/** POST /api/connect/me/patients — link a patient to this family account by their medico phone number */
const linkPatient = async (req, res, next) => {
    try {
        const { patientPhone, relation } = req.body;

        const patient = await medicoRepo.findUserByPhone(patientPhone);
        if (!patient) {
            return res.status(404).json({ success: false, message: 'No Ayuxa patient found with that phone number.' });
        }

        const link = await prisma.familyPatientLink.upsert({
            where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId: patient.id } },
            update: { relation: relation || 'Family' },
            create: { accountId: req.familyAccount.id, patientUserId: patient.id, relation: relation || 'Family' },
        });

        res.status(201).json({ success: true, data: { link, patient: { id: patient.id, name: patient.name, phone: patient.phone } } });
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
            return { relation: link.relation, canEdit: link.canEdit, patient: user, healthReports, emergencyContacts, careTeam, serviceVisits };
        }));

        res.json({ success: true, data: patients.filter(Boolean) });
    } catch (error) {
        next(error);
    }
};

/** GET /api/connect/patients/:patientUserId/medical-records?category=X */
const listMedicalRecords = async (req, res, next) => {
    try {
        const link = await prisma.familyPatientLink.findUnique({
            where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId: req.params.patientUserId } },
        });
        if (!link) return res.status(403).json({ success: false, message: 'Not linked to this patient' });

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
        const link = await prisma.familyPatientLink.findUnique({
            where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId: req.params.patientUserId } },
        });
        if (!link) return res.status(403).json({ success: false, message: 'Not linked to this patient' });

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
        const link = await prisma.familyPatientLink.findUnique({
            where: { accountId_patientUserId: { accountId: req.familyAccount.id, patientUserId: req.params.patientUserId } },
        });
        if (!link) return res.status(403).json({ success: false, message: 'Not linked to this patient' });

        const team = await prisma.careTeamMember.findMany({ where: { patientUserId: req.params.patientUserId } });
        res.json({ success: true, data: team });
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
    listMedicalRecords, listServiceHistory, getCareTeam, addCareTeamMember,
};
