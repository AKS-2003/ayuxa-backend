// ──────────────────────────────────────────────
//  Push Service (Firebase Cloud Messaging)
//  Sends a push whenever an in-app notification row is created for a
//  caregiver (Ayuxa Buddy) or family account (Ayuxa Live). Uses the same
//  service-account JSON as GCS (GOOGLE_APPLICATION_CREDENTIALS) — if that
//  isn't set, push is skipped and the apps' in-app polling still works.
// ──────────────────────────────────────────────

const { logger } = require('../config/logger');

let messaging = null;
let initTried = false;

function getMessaging() {
    if (messaging || initTried) return messaging;
    initTried = true;
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        logger.warn('[Push] GOOGLE_APPLICATION_CREDENTIALS not set — push notifications disabled.');
        return null;
    }
    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
        messaging = admin.messaging();
    } catch (error) {
        logger.error(`[Push] Firebase init failed: ${error.message}`);
    }
    return messaging;
}

const CHANNEL_ID = 'ayuxa_alerts';

/**
 * Sends one notification to one device token. Returns 'sent', 'invalid'
 * (token is dead — caller should clear it) or 'failed'.
 */
async function sendToToken(token, { title, body, data = {} }) {
    const m = getMessaging();
    if (!m || !token) return 'failed';
    try {
        await m.send({
            token,
            notification: { title, body },
            data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
            android: { priority: 'high', notification: { channelId: CHANNEL_ID, sound: 'default' } },
        });
        return 'sent';
    } catch (error) {
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) {
            return 'invalid';
        }
        logger.error(`[Push] send failed: ${error.code || error.message}`);
        return 'failed';
    }
}

/** Push for a freshly created CaregiverNotification row. */
async function pushCaregiverNotification(row) {
    const prisma = require('../config/database');
    const profile = await prisma.caregiverProfile.findUnique({ where: { id: row.profileId }, select: { id: true, fcmDeviceToken: true } });
    if (!profile?.fcmDeviceToken) return;
    const result = await sendToToken(profile.fcmDeviceToken, { title: row.title, body: row.body, data: { app: 'buddy', category: row.category, notificationId: row.id } });
    if (result === 'invalid') await prisma.caregiverProfile.update({ where: { id: profile.id }, data: { fcmDeviceToken: null } });
}

/** Push for a freshly created ConnectNotification row. */
async function pushConnectNotification(row) {
    const prisma = require('../config/database');
    const account = await prisma.familyAccount.findUnique({ where: { id: row.accountId }, select: { id: true, fcmDeviceToken: true } });
    if (!account?.fcmDeviceToken) return;
    const result = await sendToToken(account.fcmDeviceToken, { title: row.title, body: row.body, data: { app: 'live', category: row.category, notificationId: row.id } });
    if (result === 'invalid') await prisma.familyAccount.update({ where: { id: account.id }, data: { fcmDeviceToken: null } });
}

module.exports = { pushCaregiverNotification, pushConnectNotification, sendToToken };
