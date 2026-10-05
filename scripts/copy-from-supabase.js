// One-off: copies Ayuxa-owned data (and the medico `caregivers` rows Ayuxa
// created for Buddy signups) from the old Supabase database into the
// database this backend now points at (DATABASE_URL). Insert-only and
// idempotent (skipDuplicates) — safe to re-run, never updates or deletes.
//
// Usage (on the server, inside the backend folder):
//   SOURCE_DATABASE_URL='postgresql://...old supabase url...' node scripts/copy-from-supabase.js
require('dotenv').config();
const { PrismaClient: AyuxaClient } = require('../node_modules/.prisma/ayuxa-client');
const { PrismaClient: MedicoClient } = require('../node_modules/.prisma/medico-readonly-client');

const sourceUrl = process.env.SOURCE_DATABASE_URL;
if (!sourceUrl) {
    console.error('Set SOURCE_DATABASE_URL to the old Supabase connection string.');
    process.exit(1);
}

const src = new AyuxaClient({ datasources: { db: { url: sourceUrl } } });
const dst = new AyuxaClient();
const srcMedico = new MedicoClient({ datasources: { db: { url: sourceUrl } } });
const dstMedico = new MedicoClient();

// Parents before children.
const TABLES = [
    'ayuxaAdmin', 'ayuxaAdminSession', 'ayuxaAuditLog',
    'caregiverProfile', 'caregiverSession', 'caregiverCheckIn', 'checkInTask',
    'caregiverUpload', 'caregiverNotification',
    'familyAccount', 'familyAccountSession', 'familyPatientLink',
    'careTeamMember', 'serviceVisit', 'connectUpload', 'connectNotification',
    'mediaAsset',
];

async function copyTable(name) {
    const rows = await src[name].findMany();
    if (!rows.length) return console.log(`${name}: 0 rows`);
    const res = await dst[name].createMany({ data: rows, skipDuplicates: true });
    console.log(`${name}: ${res.count}/${rows.length} copied`);
}

async function copyCaregivers() {
    const profiles = await src.caregiverProfile.findMany({ select: { caregiverId: true } });
    const ids = profiles.map((p) => p.caregiverId);
    const rows = await srcMedico.caregivers.findMany({ where: { id: { in: ids } } });
    let copied = 0;
    for (const row of rows) {
        const exists = await dstMedico.caregivers.findFirst({ where: { OR: [{ id: row.id }, { phone: row.phone }] } });
        if (exists) continue;
        try {
            await dstMedico.caregivers.create({ data: row });
            copied++;
        } catch (e) {
            console.warn(`caregiver ${row.phone} skipped: ${e.message.split('\n').pop()}`);
        }
    }
    console.log(`medico caregivers: ${copied}/${rows.length} copied`);
}

(async () => {
    // Caregivers first so Buddy profiles never point at a missing medico row.
    await copyCaregivers();
    for (const t of TABLES) {
        try {
            await copyTable(t);
        } catch (e) {
            console.warn(`${t} failed: ${e.message.split('\n').pop()}`);
        }
    }
    process.exit(0);
})();
