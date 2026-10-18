// Ayuxa-owned Prisma client — the ONLY client migrations ever run against.
// Tables: ayuxa_admins, caregiver_profiles, caregiver_check_ins,
// family_accounts, family_patient_links, care_team_members, etc.
// See prisma/schema.prisma.
const { PrismaClient } = require('../../node_modules/.prisma/ayuxa-client');
const { logger } = require('./logger');

const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: process.env.DATABASE_URL } },
});

// Every in-app notification row also goes out as a push (FCM). Hooking the
// create here covers every place that raises a notification, and a push
// failure never affects the request that created the row.
const prisma = base.$extends({
    query: {
        caregiverNotification: {
            async create({ args, query }) {
                const row = await query(args);
                require('../services/push.service').pushCaregiverNotification(row).catch((e) => logger.error(`[Push] ${e.message}`));
                return row;
            },
        },
        connectNotification: {
            async create({ args, query }) {
                const row = await query(args);
                require('../services/push.service').pushConnectNotification(row).catch((e) => logger.error(`[Push] ${e.message}`));
                return row;
            },
        },
    },
});

process.on('SIGINT', async () => { await base.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await base.$disconnect(); process.exit(0); });

module.exports = prisma;
