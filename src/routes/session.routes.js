const express = require('express');
const prisma = require('../config/database');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const sessionService = require('../services/session.service');

const router = express.Router();

/** GET /api/sessions — active sessions across all actor types (SUPER_ADMIN) */
router.get('/', authenticateAdmin, authorize('SUPER_ADMIN'), async (req, res, next) => {
    try {
        const [adminSessions, caregiverSessions, familyAccountSessions] = await Promise.all([
            prisma.ayuxaAdminSession.findMany({ where: { isActive: true }, include: { admin: { select: { name: true, email: true } } }, orderBy: { lastActiveAt: 'desc' } }),
            prisma.caregiverSession.findMany({ where: { isActive: true }, include: { profile: { select: { phone: true, acknowledgementId: true } } }, orderBy: { lastActiveAt: 'desc' } }),
            prisma.familyAccountSession.findMany({ where: { isActive: true }, include: { account: { select: { name: true, phone: true } } }, orderBy: { lastActiveAt: 'desc' } }),
        ]);

        res.json({
            success: true,
            data: {
                totalActive: adminSessions.length + caregiverSessions.length + familyAccountSessions.length,
                adminSessions, caregiverSessions, familyAccountSessions,
            },
        });
    } catch (error) {
        next(error);
    }
});

/** DELETE /api/sessions/:model/:id — force logout (SUPER_ADMIN) */
router.delete('/:model/:id', authenticateAdmin, authorize('SUPER_ADMIN'), async (req, res, next) => {
    try {
        const modelMap = {
            admin: 'ayuxaAdminSession',
            caregiver: 'caregiverSession',
            family: 'familyAccountSession',
        };
        const model = modelMap[req.params.model];
        if (!model) return res.status(400).json({ success: false, message: 'Unknown session type' });

        await sessionService.terminateSession(model, req.params.id);
        res.json({ success: true, message: 'Session terminated' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
