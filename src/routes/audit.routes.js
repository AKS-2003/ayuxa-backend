const express = require('express');
const prisma = require('../config/database');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { paginate, sendPaginatedResponse } = require('../utils/helpers');

const router = express.Router();

router.get('/', authenticateAdmin, authorize('SUPER_ADMIN'), async (req, res, next) => {
    try {
        const { page, limit, skip } = paginate(req.query);
        const [items, total] = await Promise.all([
            prisma.ayuxaAuditLog.findMany({
                skip, take: limit,
                orderBy: { createdAt: 'desc' },
                include: { admin: { select: { name: true, email: true } } },
            }),
            prisma.ayuxaAuditLog.count(),
        ]);
        sendPaginatedResponse(res, items, total, page, limit);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
