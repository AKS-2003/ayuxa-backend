// ──────────────────────────────────────────────
//  Admin Controller — dashboard stats & staff management
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const { createAuditLog } = require('../middleware/audit');

/** GET /api/admin/dashboard */
const dashboard = async (req, res, next) => {
    try {
        const [
            totalCaregiverProfiles, pendingKyc, totalFamilyAccounts,
            activeCheckIns, recentUploads,
        ] = await Promise.all([
            prisma.caregiverProfile.count(),
            prisma.caregiverProfile.count({ where: { kycStatus: 'PENDING_VERIFICATION' } }),
            prisma.familyAccount.count(),
            prisma.caregiverCheckIn.count({ where: { checkedIn: true } }),
            prisma.caregiverUpload.count({ where: { uploadedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
        ]);

        res.json({
            success: true,
            data: { totalCaregiverProfiles, pendingKyc, totalFamilyAccounts, activeCheckIns, recentUploads },
        });
    } catch (error) {
        next(error);
    }
};

/** GET /api/admin/staff (SUPER_ADMIN only) */
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

/** PUT /api/admin/staff/:id/status (SUPER_ADMIN only) */
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

module.exports = { dashboard, listStaff, setStaffActive };
