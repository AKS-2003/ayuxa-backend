const prisma = require('../config/database');
const { logger } = require('../config/logger');

const createAuditLog = async ({ adminId, action, entity, entityId, oldValue, newValue, ipAddress, userAgent }) => {
    try {
        await prisma.ayuxaAuditLog.create({
            data: { adminId, action, entity, entityId, oldValue, newValue, ipAddress, userAgent },
        });
    } catch (err) {
        logger.warn('[Audit] failed to write audit log:', err.message);
    }
};

module.exports = { createAuditLog };
