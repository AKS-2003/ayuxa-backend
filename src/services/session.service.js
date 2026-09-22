// ──────────────────────────────────────────────
//  Session Service
//  Records a session row per login for multi-device tracking and
//  forced logout, one model per actor type.
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const { logger } = require('../config/logger');

function extractClientInfo(req) {
    const rawIp = req?.headers?.['cf-connecting-ip'] ||
        (req?.headers?.['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
        req?.ip ||
        '127.0.0.1';

    let ipAddress = rawIp;
    if (ipAddress.includes('::ffff:')) ipAddress = ipAddress.split(':').pop();
    else if (ipAddress === '::1') ipAddress = '127.0.0.1';

    const uaString = (req?.get?.('user-agent') || req?.headers?.['user-agent'] || '').toLowerCase();
    let deviceType = 'PC';
    if (uaString.includes('mobile') || uaString.includes('android') || uaString.includes('iphone')) deviceType = 'Mobile';
    else if (uaString.includes('ipad') || uaString.includes('tablet')) deviceType = 'Tablet';

    return { ipAddress, deviceType };
}

const recordSession = async (model, foreignKey, id, req) => {
    try {
        const info = extractClientInfo(req);
        return await prisma[model].create({
            data: {
                [foreignKey]: id,
                deviceType: info.deviceType,
                ipAddress: info.ipAddress,
                isActive: true,
                lastActiveAt: new Date(),
            },
        });
    } catch (err) {
        logger.warn(`[SessionService] record${model} error:`, err.message);
        return null;
    }
};

const recordAdminSession = (adminId, req) => recordSession('ayuxaAdminSession', 'adminId', adminId, req);
const recordCaregiverSession = (profileId, req) => recordSession('caregiverSession', 'profileId', profileId, req);
const recordFamilyAccountSession = (accountId, req) => recordSession('familyAccountSession', 'accountId', accountId, req);

const terminateSession = async (model, sessionId) => {
    return prisma[model].update({
        where: { id: sessionId },
        data: { isActive: false },
    }).catch(() => null);
};

module.exports = {
    recordAdminSession,
    recordCaregiverSession,
    recordFamilyAccountSession,
    terminateSession,
};
