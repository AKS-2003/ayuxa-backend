// Ayuxa-owned Prisma client — the ONLY client migrations ever run against.
// Tables: ayuxa_admins, caregiver_profiles, caregiver_check_ins,
// family_accounts, family_patient_links, care_team_members, etc.
// See prisma/schema.prisma.
const { PrismaClient } = require('../../node_modules/.prisma/ayuxa-client');

const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: process.env.DATABASE_URL } },
});

process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });

module.exports = prisma;
