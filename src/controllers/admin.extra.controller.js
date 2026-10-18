// ──────────────────────────────────────────────
//  Admin Controller (part 2) — check-in management, caregiver / family
//  account editing, audit history per user, staff editing and the admin's
//  own profile. Split from admin.controller.js to keep both files readable.
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');
const otpService = require('../services/otp.service');
const { createAuditLog } = require('../middleware/audit');
const { paginate, sendPaginatedResponse, hashPassword, comparePassword } = require('../utils/helpers');
const { isValidName, isValidEmail, normalizeIndianMobile, isDummyMobile } = require('../utils/validators');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const STATUS_FILTERS = {
    scheduled: { checkedIn: false, checkOutTime: null },
    checked_in: { checkedIn: true },
    completed: { checkOutTime: { not: null } },
};

// ─── Check-ins ───────────────────────────────

/**
 * GET /api/admin/check-ins — filters: status (scheduled|checked_in|completed),
 * from/to (shift start date), category (caregiver role), search (patient,
 * caregiver name / email / phone), active=true (legacy). Also returns
 * per-status counts for the tab bar.
 */
const listCheckIns = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { status, from, to, category, search } = req.query;

        const and = [];
        if (req.query.active === 'true') and.push({ checkedIn: true });
        if (status && STATUS_FILTERS[status]) and.push(STATUS_FILTERS[status]);
        if (from) and.push({ shiftStart: { gte: new Date(from) } });
        if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); and.push({ shiftStart: { lte: end } }); }
        if (category) and.push({ caregiverRole: { contains: category, mode: 'insensitive' } });
        if (search) {
            const caregiverIds = await medicoRepo.searchCaregiverIds(search);
            and.push({
                OR: [
                    { patientName: { contains: search, mode: 'insensitive' } },
                    { patientCode: { contains: search, mode: 'insensitive' } },
                    { address: { contains: search, mode: 'insensitive' } },
                    { profile: { phone: { contains: search } } },
                    { profile: { employeeId: { contains: search, mode: 'insensitive' } } },
                    ...(caregiverIds.length ? [{ profile: { caregiverId: { in: caregiverIds } } }] : []),
                ],
            });
        }
        const where = and.length ? { AND: and } : {};

        const [checkIns, total, scheduled, checkedIn, completed, all] = await Promise.all([
            prisma.caregiverCheckIn.findMany({
                where, skip, take: limit,
                include: { tasks: true, profile: { select: { caregiverId: true, employeeId: true, phone: true } } },
                orderBy: { shiftStart: 'desc' },
            }),
            prisma.caregiverCheckIn.count({ where }),
            prisma.caregiverCheckIn.count({ where: STATUS_FILTERS.scheduled }),
            prisma.caregiverCheckIn.count({ where: STATUS_FILTERS.checked_in }),
            prisma.caregiverCheckIn.count({ where: STATUS_FILTERS.completed }),
            prisma.caregiverCheckIn.count(),
        ]);

        const caregivers = await medicoRepo.findCaregiversByIds([...new Set(checkIns.map((c) => c.profile?.caregiverId).filter(Boolean))]);
        const byId = new Map(caregivers.map((c) => [c.id, c]));
        const rows = checkIns.map((c) => ({
            ...c,
            caregiver: byId.get(c.profile?.caregiverId) ? { name: byId.get(c.profile.caregiverId).name, email: byId.get(c.profile.caregiverId).email } : null,
        }));

        res.json({
            success: true,
            data: rows,
            counts: { all, scheduled, checked_in: checkedIn, completed },
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
        });
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/check-ins/:checkInId — full record with caregiver, patient, tasks and selfies */
const getCheckInDetail = async (req, res, next) => {
    try {
        const checkIn = await prisma.caregiverCheckIn.findUnique({
            where: { id: req.params.checkInId },
            include: { tasks: true, profile: true },
        });
        if (!checkIn) return fail(res, 404, 'Check-in not found');

        const [caregiver, patient] = await Promise.all([
            medicoRepo.findCaregiverById(checkIn.profile.caregiverId),
            checkIn.patientUserId ? medicoRepo.findUserByIdIncludingDeleted(checkIn.patientUserId) : null,
        ]);

        // Selfies are stored as short-lived links — hand the panel fresh ones.
        const { getFreshReadUrl } = require('../services/providers/gcs.service');
        const fresh = async (url) => { try { return url ? await getFreshReadUrl(url) : url; } catch { return url; } };
        const { refreshToken, fcmDeviceToken, ...profile } = checkIn.profile;

        res.json({
            success: true,
            data: {
                checkIn: { ...checkIn, profile, checkInSelfieUrl: await fresh(checkIn.checkInSelfieUrl), checkOutSelfieUrl: await fresh(checkIn.checkOutSelfieUrl) },
                caregiver: caregiver ? { id: caregiver.id, name: caregiver.name, email: caregiver.email, phone: caregiver.phone, city: caregiver.cities?.name || null } : null,
                patient: patient ? { id: patient.id, name: patient.name, uniqueUserId: patient.uniqueUserId, phone: patient.phone, status: patient.status } : null,
            },
        });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/check-ins/:checkInId — edit an assignment that hasn't been completed */
const updateCheckIn = async (req, res, next) => {
    try {
        const existing = await prisma.caregiverCheckIn.findUnique({ where: { id: req.params.checkInId } });
        if (!existing) return fail(res, 404, 'Check-in not found');
        if (existing.checkOutTime) return fail(res, 409, 'A completed visit can no longer be edited.');

        const { address, scopeOfWork, caregiverRole, shiftStart, shiftEnd, tasks } = req.body;
        const start = shiftStart ? new Date(shiftStart) : existing.shiftStart;
        const end = shiftEnd ? new Date(shiftEnd) : existing.shiftEnd;
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fail(res, 422, 'Invalid shift date/time.');
        if (end <= start) return fail(res, 422, 'Shift end must be after shift start.');
        if (address !== undefined && !String(address).trim()) return fail(res, 422, 'Address cannot be empty.');

        const updated = await prisma.$transaction(async (tx) => {
            if (Array.isArray(tasks)) {
                await tx.checkInTask.deleteMany({ where: { checkInId: existing.id } });
                const titles = tasks.map((t) => String(t).trim()).filter(Boolean);
                if (titles.length) await tx.checkInTask.createMany({ data: titles.map((title) => ({ checkInId: existing.id, title })) });
            }
            return tx.caregiverCheckIn.update({
                where: { id: existing.id },
                data: {
                    ...(address !== undefined && { address: String(address).trim() }),
                    ...(scopeOfWork !== undefined && { scopeOfWork: String(scopeOfWork).trim() }),
                    ...(caregiverRole !== undefined && { caregiverRole: String(caregiverRole).trim() }),
                    shiftStart: start,
                    shiftEnd: end,
                },
                include: { tasks: true },
            });
        });

        await createAuditLog({
            adminId: req.user.id, action: 'CHECKIN_UPDATE', entity: 'CaregiverCheckIn', entityId: existing.id,
            oldValue: { address: existing.address, scopeOfWork: existing.scopeOfWork, caregiverRole: existing.caregiverRole, shiftStart: existing.shiftStart, shiftEnd: existing.shiftEnd },
            newValue: { address: updated.address, scopeOfWork: updated.scopeOfWork, caregiverRole: updated.caregiverRole, shiftStart: updated.shiftStart, shiftEnd: updated.shiftEnd },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

// ─── Caregiver contact edit ─────────────────

/** PUT /api/admin/caregivers/:caregiverId — correct a caregiver's name / email / job role */
const updateCaregiver = async (req, res, next) => {
    try {
        const { caregiverId } = req.params;
        const { name, email, jobRole } = req.body;
        const profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId } });
        if (!profile) return fail(res, 404, 'Caregiver profile not found');

        if (name !== undefined && !isValidName(name)) return fail(res, 422, 'Please enter a valid name containing only letters.');
        if (email !== undefined && !isValidEmail(email)) return fail(res, 422, 'Please enter a valid email address.');
        const JOB_ROLES = ['Nurse', 'Caregiver', 'Attendant', 'Physiotherapist', 'Home Health Aide'];
        if (jobRole !== undefined && !JOB_ROLES.includes(jobRole)) return fail(res, 422, 'Please select a valid job role.');

        const before = await medicoRepo.findCaregiverById(caregiverId);
        if (email !== undefined) {
            const clash = await medicoRepo.findCaregiverByEmail(String(email).trim().toLowerCase());
            if (clash && clash.id !== caregiverId) return fail(res, 409, 'That email is already used by another caregiver.');
        }
        if (name !== undefined || email !== undefined) {
            await medicoRepo.updateCaregiverProfile(caregiverId, {
                name: name !== undefined ? String(name).trim() : undefined,
                email: email !== undefined ? String(email).trim().toLowerCase() : undefined,
            });
        }
        // An admin-corrected email is admin-vouched, not owner-verified.
        const updatedProfile = await prisma.caregiverProfile.update({
            where: { id: profile.id },
            data: { ...(jobRole !== undefined && { jobRole }), ...(email !== undefined && { emailVerified: false }) },
        });

        await createAuditLog({
            adminId: req.user.id, action: 'CAREGIVER_UPDATE', entity: 'Caregiver', entityId: caregiverId,
            oldValue: { name: before?.name, email: before?.email, jobRole: profile.jobRole },
            newValue: { name, email, jobRole }, ipAddress: req.ip,
        });
        res.json({ success: true, data: { caregiver: await medicoRepo.findCaregiverById(caregiverId), profile: updatedProfile } });
    } catch (error) {
        next(error);
    }
};

// ─── Family accounts ────────────────────────

/** GET /api/admin/family-accounts — search, filter (completeness / linked) and sort */
const listFamilyAccounts = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { search, filter, sort = 'newest' } = req.query;

        const and = [];
        if (search) and.push({ OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { email: { contains: search, mode: 'insensitive' } }] });
        if (filter === 'missing_name') and.push({ name: '' });
        if (filter === 'missing_email') and.push({ OR: [{ email: null }, { email: '' }] });
        if (filter === 'linked') and.push({ links: { some: {} } });
        if (filter === 'unlinked') and.push({ links: { none: {} } });
        const where = and.length ? { AND: and } : {};
        const orderBy = {
            newest: { createdAt: 'desc' },
            oldest: { createdAt: 'asc' },
            name_asc: { name: 'asc' },
            name_desc: { name: 'desc' },
            patients: { links: { _count: 'desc' } },
        }[sort] || { createdAt: 'desc' };

        const [accounts, total] = await Promise.all([
            prisma.familyAccount.findMany({ where, skip, take: limit, include: { links: true }, orderBy }),
            prisma.familyAccount.count({ where }),
        ]);
        sendPaginatedResponse(res, accounts.map(({ refreshToken, fcmDeviceToken, ...a }) => a), total, page, limit);
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/family-accounts/:accountId — name is required; email optional but validated */
const updateFamilyAccount = async (req, res, next) => {
    try {
        const { name, email } = req.body;
        const existing = await prisma.familyAccount.findUnique({ where: { id: req.params.accountId } });
        if (!existing) return fail(res, 404, 'Family account not found');

        if (name === undefined || !isValidName(name)) return fail(res, 422, 'Name is required and must contain only letters.');
        if (email && !isValidEmail(email)) return fail(res, 422, 'Please enter a valid email address.');

        const updated = await prisma.familyAccount.update({
            where: { id: existing.id },
            data: { name: String(name).trim(), email: email ? String(email).trim().toLowerCase() : null },
        });
        await createAuditLog({
            adminId: req.user.id, action: 'FAMILY_ACCOUNT_UPDATE', entity: 'FamilyAccount', entityId: existing.id,
            oldValue: { name: existing.name, email: existing.email }, newValue: { name: updated.name, email: updated.email }, ipAddress: req.ip,
        });
        const { refreshToken, fcmDeviceToken, ...safe } = updated;
        res.json({ success: true, data: safe });
    } catch (error) {
        next(error);
    }
};

// ─── Patient history & activity ─────────────

/** GET /api/admin/patients/:patientUserId — profile plus full history and an activity timeline */
const getPatientDetail = async (req, res, next) => {
    try {
        const { patientUserId } = req.params;
        const [user, careTeam, serviceVisits, uploads, links, checkIns, caregiverUploads, healthReports, defaultAddress] = await Promise.all([
            medicoRepo.findUserByIdIncludingDeleted(patientUserId),
            prisma.careTeamMember.findMany({ where: { patientUserId } }),
            prisma.serviceVisit.findMany({ where: { patientUserId }, orderBy: { visitDate: 'desc' } }),
            prisma.connectUpload.findMany({ where: { patientUserId }, orderBy: { uploadedAt: 'desc' } }),
            prisma.familyPatientLink.findMany({ where: { patientUserId }, include: { account: { select: { id: true, name: true, phone: true } } } }),
            prisma.caregiverCheckIn.findMany({ where: { patientUserId }, include: { profile: { select: { caregiverId: true, employeeId: true } } }, orderBy: { shiftStart: 'desc' } }),
            prisma.caregiverUpload.findMany({ where: { patientUserId }, orderBy: { uploadedAt: 'desc' } }),
            medicoRepo.listHealthReportsForUser(patientUserId).catch(() => []),
            medicoRepo.getDefaultAddress(patientUserId).catch(() => null),
        ]);
        if (!user) return fail(res, 404, 'Patient not found');

        const caregivers = await medicoRepo.findCaregiversByIds([...new Set(checkIns.map((c) => c.profile?.caregiverId).filter(Boolean))]);
        const nameById = new Map(caregivers.map((c) => [c.id, c.name]));
        const careName = (c) => nameById.get(c.profile?.caregiverId) || c.profile?.employeeId || 'Caregiver';

        const timeline = [
            ...checkIns.flatMap((c) => [
                { at: c.createdAt, type: 'ASSIGNED', title: `${careName(c)} assigned`, detail: `${c.caregiverRole || 'Visit'} · ${c.scopeOfWork || ''}`.trim() },
                ...(c.checkInTime ? [{ at: c.checkInTime, type: 'CHECK_IN', title: `${careName(c)} checked in`, detail: c.address }] : []),
                ...(c.checkOutTime ? [{ at: c.checkOutTime, type: 'CHECK_OUT', title: `${careName(c)} checked out`, detail: c.careSummary || '' }] : []),
            ]),
            ...serviceVisits.map((v) => ({ at: v.visitDate, type: 'VISIT', title: `${v.providerType || 'Service'} visit — ${v.providerName || ''}`.trim(), detail: v.notes || '' })),
            ...uploads.map((u) => ({ at: u.uploadedAt, type: 'DOCUMENT', title: `Family uploaded ${u.category}`, detail: u.fileName })),
            ...caregiverUploads.map((u) => ({ at: u.uploadedAt, type: 'DOCUMENT', title: `${u.uploadedBy || 'Caregiver'} uploaded ${u.category}`, detail: u.fileName })),
            ...healthReports.map((r) => ({ at: r.createdAt || r.reportDate, type: 'RECORD', title: `Health report: ${r.title || r.reportType || 'Report'}`, detail: '' })),
            ...links.map((l) => ({ at: l.createdAt, type: 'FAMILY_LINK', title: `${l.account?.name || l.account?.phone || 'Family member'} linked (${l.relation})`, detail: '' })),
            ...careTeam.map((m) => ({ at: m.createdAt, type: 'CARE_TEAM', title: `${m.name} added to care team`, detail: m.role })),
        ]
            .filter((e) => e.at)
            .sort((a, b) => new Date(b.at) - new Date(a.at));

        const { refreshToken, otpCode, otpExpiresAt, fcmDeviceToken, ...patient } = user;
        res.json({
            success: true,
            data: {
                patient, defaultAddress, careTeam, serviceVisits, uploads, linkedFamilyAccounts: links,
                checkIns: checkIns.map((c) => ({ ...c, caregiverName: careName(c) })),
                caregiverUploads,
                healthReports: healthReports.map((r) => ({ id: r.id, title: r.title, fileType: r.fileType, uploadedBy: r.uploadedBy, flagSeverity: r.flagSeverity, flagNote: r.flagNote, reportDate: r.reportDate })),
                timeline,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─── Audit log ──────────────────────────────

/** GET /api/audit-logs?adminId=&action=&page= — optionally scoped to one user */
const listAuditLogs = async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const { adminId, action } = req.query;
        const where = { ...(adminId && { adminId }), ...(action && { action }) };
        const [items, total] = await Promise.all([
            prisma.ayuxaAuditLog.findMany({
                where, skip, take: limit, orderBy: { createdAt: 'desc' },
                include: { admin: { select: { id: true, name: true, email: true, role: true } } },
            }),
            prisma.ayuxaAuditLog.count({ where }),
        ]);
        sendPaginatedResponse(res, items, total, page, limit);
    } catch (error) {
        next(error);
    }
};

/** GET /api/audit-logs/users — one summary row per user: action count, last action, last seen */
const auditUsers = async (req, res, next) => {
    try {
        const groups = await prisma.ayuxaAuditLog.groupBy({
            by: ['adminId'],
            _count: { _all: true },
            _max: { createdAt: true },
            orderBy: { _max: { createdAt: 'desc' } },
        });
        const ids = groups.map((g) => g.adminId).filter(Boolean);
        const admins = await prisma.ayuxaAdmin.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, role: true, isActive: true } });
        const adminById = new Map(admins.map((a) => [a.id, a]));

        const data = await Promise.all(groups.map(async (g) => {
            const recent = await prisma.ayuxaAuditLog.findMany({
                where: { adminId: g.adminId }, orderBy: { createdAt: 'desc' }, take: 5,
                select: { id: true, action: true, entity: true, entityId: true, createdAt: true, ipAddress: true },
            });
            return {
                adminId: g.adminId,
                admin: g.adminId ? adminById.get(g.adminId) || { name: 'Deleted staff member', email: null, role: null } : { name: 'System', email: null, role: null },
                actionCount: g._count._all,
                lastActionAt: g._max.createdAt,
                recent,
            };
        }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// ─── Staff ──────────────────────────────────

const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATIONS_EXECUTIVE', 'SUPPORT_AGENT'];

/** POST /api/admin/staff/verify-email/request-otp — proves the new staff member's inbox is real before the account is created */
const requestStaffEmailOtp = async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!isValidEmail(email)) return fail(res, 422, 'Please enter a valid email address.');
        if (await prisma.ayuxaAdmin.findUnique({ where: { email } })) return fail(res, 409, 'A staff member with this email already exists.');
        const result = await otpService.requestOTP(email);
        if (!result.success) return fail(res, 502, 'Failed to send OTP. Please try again.');
        res.json({ success: true, message: 'OTP sent to the email address' });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/staff/:id — edit name, phone and role */
const updateStaff = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, phone, role } = req.body;
        const existing = await prisma.ayuxaAdmin.findUnique({ where: { id } });
        if (!existing) return fail(res, 404, 'Staff member not found');

        if (name !== undefined && !isValidName(name)) return fail(res, 422, 'Please enter a valid name containing only letters.');
        if (phone !== undefined && phone !== '' && phone !== null && !normalizeIndianMobile(phone)) return fail(res, 422, 'Please enter a valid 10-digit mobile number.');
        if (role !== undefined && !ADMIN_ROLES.includes(role)) return fail(res, 422, 'Invalid role.');

        if (role !== undefined && role !== existing.role && existing.role === 'SUPER_ADMIN') {
            const supers = await prisma.ayuxaAdmin.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
            if (supers <= 1) return fail(res, 409, 'There must always be at least one active Super Admin.');
        }

        const updated = await prisma.ayuxaAdmin.update({
            where: { id },
            data: {
                ...(name !== undefined && { name: String(name).trim() }),
                ...(phone !== undefined && { phone: phone ? normalizeIndianMobile(phone) : null }),
                ...(role !== undefined && { role }),
            },
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
        });
        await createAuditLog({
            adminId: req.user.id, action: 'STAFF_UPDATE', entity: 'AyuxaAdmin', entityId: id,
            oldValue: { name: existing.name, phone: existing.phone, role: existing.role }, newValue: { name: updated.name, phone: updated.phone, role: updated.role }, ipAddress: req.ip,
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

/** DELETE /api/admin/staff/:id — removes the account; past audit entries stay (shown as "Deleted staff member") */
const deleteStaff = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (id === req.user.id) return fail(res, 409, 'You cannot delete your own account.');
        const existing = await prisma.ayuxaAdmin.findUnique({ where: { id } });
        if (!existing) return fail(res, 404, 'Staff member not found');
        if (existing.role === 'SUPER_ADMIN' && existing.isActive) {
            const supers = await prisma.ayuxaAdmin.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
            if (supers <= 1) return fail(res, 409, 'There must always be at least one active Super Admin.');
        }

        await prisma.$transaction([
            prisma.ayuxaAuditLog.updateMany({ where: { adminId: id }, data: { adminId: null } }),
            prisma.ayuxaAdmin.delete({ where: { id } }),
        ]);
        await createAuditLog({
            adminId: req.user.id, action: 'STAFF_DELETE', entity: 'AyuxaAdmin', entityId: id,
            oldValue: { name: existing.name, email: existing.email, role: existing.role }, ipAddress: req.ip,
        });
        res.json({ success: true, message: 'Staff member deleted' });
    } catch (error) {
        next(error);
    }
};

// ─── My profile ─────────────────────────────

const ownAdminSelect = { id: true, name: true, email: true, phone: true, role: true, lastLoginAt: true, createdAt: true };

/** GET /api/admin/me */
const getOwnProfile = async (req, res, next) => {
    try {
        res.json({ success: true, data: await prisma.ayuxaAdmin.findUnique({ where: { id: req.user.id }, select: ownAdminSelect }) });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/me — name and phone (email is the login ID; role is managed by a Super Admin) */
const updateOwnProfile = async (req, res, next) => {
    try {
        const { name, phone } = req.body;
        if (name !== undefined && !isValidName(name)) return fail(res, 422, 'Please enter a valid name containing only letters.');
        if (phone !== undefined && phone !== '' && phone !== null && !normalizeIndianMobile(phone)) return fail(res, 422, 'Please enter a valid 10-digit mobile number.');
        const updated = await prisma.ayuxaAdmin.update({
            where: { id: req.user.id },
            data: { ...(name !== undefined && { name: String(name).trim() }), ...(phone !== undefined && { phone: phone ? normalizeIndianMobile(phone) : null }) },
            select: ownAdminSelect,
        });
        await createAuditLog({ adminId: req.user.id, action: 'PROFILE_UPDATE', entity: 'AyuxaAdmin', entityId: req.user.id, ipAddress: req.ip });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/admin/me/password — requires the current password */
const changeOwnPassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return fail(res, 422, 'Current and new password are required.');
        if (String(newPassword).length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
            return fail(res, 422, 'New password must be at least 8 characters and include a letter and a number.');
        }
        const admin = await prisma.ayuxaAdmin.findUnique({ where: { id: req.user.id } });
        if (!(await comparePassword(currentPassword, admin.passwordHash))) return fail(res, 400, 'Current password is incorrect.');
        if (await comparePassword(newPassword, admin.passwordHash)) return fail(res, 422, 'New password must be different from the current one.');

        await prisma.ayuxaAdmin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(newPassword) } });
        await createAuditLog({ adminId: admin.id, action: 'PASSWORD_CHANGE', entity: 'AyuxaAdmin', entityId: admin.id, ipAddress: req.ip });
        res.json({ success: true, message: 'Password changed' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listCheckIns, getCheckInDetail, updateCheckIn,
    updateCaregiver,
    listFamilyAccounts, updateFamilyAccount,
    getPatientDetail,
    listAuditLogs, auditUsers,
    requestStaffEmailOtp, updateStaff, deleteStaff,
    getOwnProfile, updateOwnProfile, changeOwnPassword,
};
