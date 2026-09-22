// ──────────────────────────────────────────────
//  Admin Controller — dashboard stats, staff management, and the
//  read/manage surface the React admin panel needs for both apps:
//    Buddy   — caregiver list/detail, KYC queue, check-ins, uploads
//    Connect — family account list/detail, linked patients, care team
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');
const { createAuditLog } = require('../middleware/audit');
const { paginate, sendPaginatedResponse, generateEmployeeId } = require('../utils/helpers');

/** Strips session/internal fields before a CaregiverProfile reaches the admin panel. */
function sanitizeProfile(profile) {
    if (!profile) return profile;
    const { refreshToken, fcmDeviceToken, ...safe } = profile;
    return safe;
}

/** Strips session/internal fields before a medico User reaches the admin panel. */
function sanitizeUser(user) {
    if (!user) return user;
    const { refreshToken, otpCode, otpExpiresAt, fcmDeviceToken, ...safe } = user;
    return safe;
}

/** Strips the session refresh token before a FamilyAccount reaches the admin panel. */
function sanitizeAccount(account) {
    if (!account) return account;
    const { refreshToken, ...safe } = account;
    return safe;
}

/** GET /api/admin/dashboard */
const dashboard = async (req, res, next) => {
    try {
        const [
            totalCaregiverProfiles, pendingKyc, totalFamilyAccounts,
            activeCheckIns, recentUploads, totalPatientLinks,
            kycAccepted, kycRejected,
        ] = await Promise.all([
            prisma.caregiverProfile.count(),
            prisma.caregiverProfile.count({ where: { kycStatus: 'PENDING_VERIFICATION' } }),
            prisma.familyAccount.count(),
            prisma.caregiverCheckIn.count({ where: { checkedIn: true } }),
            prisma.caregiverUpload.count({ where: { uploadedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
            prisma.familyPatientLink.count(),
            prisma.caregiverProfile.count({ where: { kycStatus: 'ACCEPTED' } }),
            prisma.caregiverProfile.count({ where: { kycStatus: 'REJECTED' } }),
        ]);

        res.json({
            success: true,
            data: {
                totalCaregiverProfiles, pendingKyc, totalFamilyAccounts,
                activeCheckIns, recentUploads, totalPatientLinks,
                kycAccepted, kycRejected,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─── Ayuxa Buddy: caregiver management ──────────────

/** GET /api/admin/caregivers?search=&kycStatus=&page=&limit= */
const listCaregivers = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { search, kycStatus } = req.query;

        const profileWhere = kycStatus ? { kycStatus } : {};
        const profiles = await prisma.caregiverProfile.findMany({
            where: profileWhere,
            skip, take: limit,
            orderBy: { createdAt: 'desc' },
        });

        const caregiverIds = profiles.map((p) => p.caregiverId);
        const caregivers = await Promise.all(caregiverIds.map((id) => medicoRepo.findCaregiverById(id)));
        const caregiverById = new Map(caregivers.filter(Boolean).map((c) => [c.id, c]));

        let merged = profiles.map((profile) => ({
            profile: sanitizeProfile(profile),
            caregiver: caregiverById.get(profile.caregiverId) || null,
        }));

        if (search) {
            const q = search.toLowerCase();
            merged = merged.filter(({ caregiver }) =>
                caregiver && (
                    caregiver.name?.toLowerCase().includes(q) ||
                    caregiver.phone?.includes(q) ||
                    caregiver.email?.toLowerCase().includes(q)
                ));
        }

        const total = kycStatus ? await prisma.caregiverProfile.count({ where: profileWhere }) : await prisma.caregiverProfile.count();
        sendPaginatedResponse(res, merged, total, page, limit);
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/caregivers/:caregiverId */
const getCaregiverDetail = async (req, res, next) => {
    try {
        const { caregiverId } = req.params;
        const [caregiver, profile, bookings] = await Promise.all([
            medicoRepo.findCaregiverById(caregiverId),
            prisma.caregiverProfile.findUnique({
                where: { caregiverId },
                include: {
                    checkIns: { include: { tasks: true }, orderBy: { shiftStart: 'desc' }, take: 20 },
                    uploads: { orderBy: { uploadedAt: 'desc' }, take: 20 },
                    notifications: { orderBy: { createdAt: 'desc' }, take: 20 },
                },
            }),
            medicoRepo.listBookingsForCaregiver(caregiverId),
        ]);

        if (!caregiver || !profile) return res.status(404).json({ success: false, message: 'Caregiver not found' });

        res.json({ success: true, data: { caregiver, profile: sanitizeProfile(profile), bookings } });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/caregivers/:caregiverId/kyc — approve/reject (same action as buddy.routes.js's existing endpoint, admin-list-friendly path) */
const setCaregiverKyc = async (req, res, next) => {
    try {
        const { status } = req.body;
        if (!['NOT_SUBMITTED', 'PENDING_VERIFICATION', 'ACCEPTED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid KYC status' });
        }

        const profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId: req.params.caregiverId } });
        if (!profile) return res.status(404).json({ success: false, message: 'Caregiver profile not found' });

        const data = { kycStatus: status };
        if (status === 'ACCEPTED' && !profile.employeeId) data.employeeId = generateEmployeeId();

        const updated = await prisma.caregiverProfile.update({ where: { id: profile.id }, data });

        await prisma.caregiverNotification.create({
            data: {
                profileId: updated.id,
                title: status === 'ACCEPTED' ? 'KYC Approved' : status === 'REJECTED' ? 'KYC Rejected' : 'KYC Status Updated',
                body: status === 'ACCEPTED'
                    ? 'Your KYC documents have been verified. Welcome aboard!'
                    : status === 'REJECTED'
                        ? 'Your KYC documents need attention. Please re-submit.'
                        : 'Your KYC status has been updated.',
                category: 'approval',
                channels: ['push', 'email'],
            },
        });

        await createAuditLog({
            adminId: req.user.id,
            action: `KYC_${status}`,
            entity: 'CaregiverProfile',
            entityId: updated.id,
            ipAddress: req.ip,
        });

        res.json({ success: true, data: sanitizeProfile(updated) });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/admin/caregivers/:caregiverId/assignments — assigns a patient to
 * a caregiver by creating a CaregiverCheckIn shift record directly (skipping
 * medico's booking flow). Without at least one of these, Buddy's dashboard
 * shows no current assignment and check-in stays blocked.
 */
const createAssignment = async (req, res, next) => {
    try {
        const { caregiverId } = req.params;
        const { patientUserId, address, caregiverRole, scopeOfWork, shiftStart, shiftEnd, tasks } = req.body;

        if (!patientUserId) return res.status(422).json({ success: false, message: 'patientUserId is required' });
        if (!shiftStart || !shiftEnd) return res.status(422).json({ success: false, message: 'shiftStart and shiftEnd are required' });

        const profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId } });
        if (!profile) return res.status(404).json({ success: false, message: 'Caregiver profile not found' });

        const patient = await medicoRepo.findUserById(patientUserId);
        if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

        const checkIn = await prisma.caregiverCheckIn.create({
            data: {
                profileId: profile.id,
                patientUserId: patient.id,
                patientName: patient.name || '',
                patientCode: patient.uniqueUserId || '',
                address: address || '',
                mobile: patient.phone || '',
                caregiverRole: caregiverRole || profile.jobRole || '',
                scopeOfWork: scopeOfWork || '',
                shiftStart: new Date(shiftStart),
                shiftEnd: new Date(shiftEnd),
                tasks: { create: (tasks || []).map((title) => ({ title })) },
            },
            include: { tasks: true },
        });

        await prisma.caregiverNotification.create({
            data: {
                profileId: profile.id,
                title: 'New Patient Assigned',
                body: `You've been assigned to ${patient.name || 'a patient'}. Check your dashboard for details.`,
                category: 'assignment',
                channels: ['push'],
            },
        });

        await createAuditLog({ adminId: req.user.id, action: 'ASSIGNMENT_CREATE', entity: 'CaregiverCheckIn', entityId: checkIn.id, ipAddress: req.ip });

        res.status(201).json({ success: true, data: checkIn });
    } catch (error) {
        next(error);
    }
};

/** DELETE /api/admin/check-ins/:checkInId — removes an assignment that hasn't started yet (mis-assigned patient, etc.) */
const removeAssignment = async (req, res, next) => {
    try {
        const checkIn = await prisma.caregiverCheckIn.findUnique({ where: { id: req.params.checkInId } });
        if (!checkIn) return res.status(404).json({ success: false, message: 'Assignment not found' });
        if (checkIn.checkedIn || checkIn.checkOutTime) {
            return res.status(409).json({ success: false, message: 'Cannot remove an assignment that has already started or completed' });
        }

        await prisma.caregiverCheckIn.delete({ where: { id: checkIn.id } });
        await createAuditLog({ adminId: req.user.id, action: 'ASSIGNMENT_REMOVE', entity: 'CaregiverCheckIn', entityId: checkIn.id, ipAddress: req.ip });

        res.json({ success: true, message: 'Assignment removed' });
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/check-ins?active=true — live operations view */
const listCheckIns = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const where = req.query.active === 'true' ? { checkedIn: true } : {};

        const [checkIns, total] = await Promise.all([
            prisma.caregiverCheckIn.findMany({
                where, skip, take: limit,
                include: { tasks: true, profile: { select: { caregiverId: true, employeeId: true, phone: true } } },
                orderBy: { shiftStart: 'desc' },
            }),
            prisma.caregiverCheckIn.count({ where }),
        ]);

        sendPaginatedResponse(res, checkIns, total, page, limit);
    } catch (error) {
        next(error);
    }
};

// ─── Ayuxa Connect: family account management ──────────────

/** GET /api/admin/family-accounts?search=&page=&limit= */
const listFamilyAccounts = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { search } = req.query;

        const where = search
            ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { email: { contains: search, mode: 'insensitive' } }] }
            : {};

        const [accounts, total] = await Promise.all([
            prisma.familyAccount.findMany({
                where, skip, take: limit,
                include: { links: true },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.familyAccount.count({ where }),
        ]);

        sendPaginatedResponse(res, accounts.map(sanitizeAccount), total, page, limit);
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/family-accounts/:accountId */
const getFamilyAccountDetail = async (req, res, next) => {
    try {
        const account = await prisma.familyAccount.findUnique({
            where: { id: req.params.accountId },
            include: { links: true, notifications: { orderBy: { createdAt: 'desc' }, take: 20 } },
        });
        if (!account) return res.status(404).json({ success: false, message: 'Family account not found' });

        const patients = await Promise.all(
            account.links.map(async (link) => {
                const user = await medicoRepo.findUserById(link.patientUserId);
                return { link, patient: user ? sanitizeUser(user) : null };
            })
        );

        res.json({ success: true, data: { account: sanitizeAccount(account), patients } });
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/patients?search=&page=&limit() — medico patients, for admin lookup/linking context */
const listPatients = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { search } = req.query;

        const [users, total] = await Promise.all([
            medicoRepo.listUsers({ skip, take: limit, search }),
            medicoRepo.countUsers(search),
        ]);

        sendPaginatedResponse(res, users.map(sanitizeUser), total, page, limit);
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/patients/:patientUserId — full Ayuxa-side detail for one patient (care team, visits, uploads, links) */
const getPatientDetail = async (req, res, next) => {
    try {
        const { patientUserId } = req.params;
        const [user, careTeam, serviceVisits, uploads, links] = await Promise.all([
            medicoRepo.findUserById(patientUserId),
            prisma.careTeamMember.findMany({ where: { patientUserId } }),
            prisma.serviceVisit.findMany({ where: { patientUserId }, orderBy: { visitDate: 'desc' }, take: 20 }),
            prisma.connectUpload.findMany({ where: { patientUserId }, orderBy: { uploadedAt: 'desc' }, take: 20 }),
            prisma.familyPatientLink.findMany({ where: { patientUserId }, include: { account: { select: { id: true, name: true, phone: true } } } }),
        ]);
        if (!user) return res.status(404).json({ success: false, message: 'Patient not found' });

        res.json({ success: true, data: { patient: sanitizeUser(user), careTeam, serviceVisits, uploads, linkedFamilyAccounts: links } });
    } catch (error) {
        next(error);
    }
};

/** POST /api/admin/patients/:patientUserId/care-team — assign a care team member (caregiver or manual entry) */
const addCareTeamMember = async (req, res, next) => {
    try {
        const { patientUserId } = req.params;
        const { caregiverId, name, role, phone, photoUrl } = req.body;

        const member = await prisma.careTeamMember.create({
            data: { patientUserId, caregiverId: caregiverId || null, name, role, phone, photoUrl },
        });

        const links = await prisma.familyPatientLink.findMany({ where: { patientUserId } });
        await Promise.all(links.map((link) =>
            prisma.connectNotification.create({
                data: {
                    accountId: link.accountId,
                    title: 'Care Team Updated',
                    body: `${name} (${role}) has been added to the care team.`,
                    category: 'caregiverAssigned',
                },
            })
        ));

        await createAuditLog({ adminId: req.user.id, action: 'CARE_TEAM_ADD', entity: 'CareTeamMember', entityId: member.id, ipAddress: req.ip });

        res.status(201).json({ success: true, data: member });
    } catch (error) {
        next(error);
    }
};

/** DELETE /api/admin/care-team/:memberId */
const removeCareTeamMember = async (req, res, next) => {
    try {
        await prisma.careTeamMember.delete({ where: { id: req.params.memberId } });
        await createAuditLog({ adminId: req.user.id, action: 'CARE_TEAM_REMOVE', entity: 'CareTeamMember', entityId: req.params.memberId, ipAddress: req.ip });
        res.json({ success: true, message: 'Care team member removed' });
    } catch (error) {
        next(error);
    }
};

// ─── Staff management (SUPER_ADMIN only) ──────────────

/** GET /api/admin/staff */
const listStaff = async (req, res, next) => {
    try {
        const staff = await prisma.ayuxaAdmin.findMany({
            select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: staff });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/staff/:id/status */
const setStaffActive = async (req, res, next) => {
    try {
        const { isActive } = req.body;
        const admin = await prisma.ayuxaAdmin.update({ where: { id: req.params.id }, data: { isActive } });
        await createAuditLog({
            adminId: req.user.id,
            action: isActive ? 'STAFF_ACTIVATE' : 'STAFF_DEACTIVATE',
            entity: 'AyuxaAdmin',
            entityId: admin.id,
            ipAddress: req.ip,
        });
        res.json({ success: true, data: { id: admin.id, isActive: admin.isActive } });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    dashboard,
    listCaregivers, getCaregiverDetail, setCaregiverKyc, listCheckIns,
    createAssignment, removeAssignment,
    listFamilyAccounts, getFamilyAccountDetail,
    listPatients, getPatientDetail, addCareTeamMember, removeCareTeamMember,
    listStaff, setStaffActive,
};
