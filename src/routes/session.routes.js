const express = require('express');
const prisma = require('../config/database');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const sessionService = require('../services/session.service');
const medicoRepo = require('../services/medico.repository');

const router = express.Router();

/** GET /api/sessions — active sessions across all actor types (SUPER_ADMIN) */
router.get('/', authenticateAdmin, authorize('SUPER_ADMIN'), async (req, res, next) => {
    try {
        const [adminSessions, caregiverSessions, familyAccountSessions] = await Promise.all([
            prisma.ayuxaAdminSession.findMany({ where: { isActive: true }, include: { admin: { select: { name: true, email: true } } }, orderBy: { lastActiveAt: 'desc' } }),
            prisma.caregiverSession.findMany({ where: { isActive: true }, include: { profile: { select: { phone: true, acknowledgementId: true, caregiverId: true } } }, orderBy: { lastActiveAt: 'desc' } }),
            prisma.familyAccountSession.findMany({ where: { isActive: true }, include: { account: { select: { name: true, phone: true, email: true } } }, orderBy: { lastActiveAt: 'desc' } }),
        ]);

        // Every session gets the same flat `user` shape ({ name, email, phone }) so
        // the panel can show name and email in their own columns.
        const caregivers = await medicoRepo.findCaregiversByIds([...new Set(caregiverSessions.map((s) => s.profile?.caregiverId).filter(Boolean))]);
        const caregiverById = new Map(caregivers.map((c) => [c.id, c]));

        const withUser = (rows, pick) => rows.map((row) => ({ ...row, user: pick(row) }));
        const admins = withUser(adminSessions, (s) => ({ name: s.admin?.name || null, email: s.admin?.email || null, phone: null }));
        const caregiverRows = withUser(caregiverSessions, (s) => {
            const c = caregiverById.get(s.profile?.caregiverId);
            return { name: c?.name || null, email: c?.email || null, phone: s.profile?.phone || c?.phone || null };
        });
        const familyRows = withUser(familyAccountSessions, (s) => ({ name: s.account?.name || null, email: s.account?.email || null, phone: s.account?.phone || null }));

        res.json({
            success: true,
            data: {
                totalActive: adminSessions.length + caregiverSessions.length + familyAccountSessions.length,
                adminSessions: admins, caregiverSessions: caregiverRows, familyAccountSessions: familyRows,
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
