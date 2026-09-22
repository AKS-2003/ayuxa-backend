// Seeds a first SUPER_ADMIN for this backend's own ayuxa_admins table.
//
// Deliberately does NOT create demo caregiver/patient rows: those must
// already exist in medico's `caregivers`/`users` tables (medico owns that
// data). To test Buddy/Connect locally, either point OTP_SMS_PROVIDER at a
// real medico caregiver/user phone number that already exists in the
// shared database, or ask medico's team for a caregiver test account.
const { PrismaClient } = require('../node_modules/.prisma/ayuxa-client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@ayuxa.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

    const admin = await prisma.ayuxaAdmin.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
            name: 'Ayuxa Super Admin',
            email: adminEmail,
            passwordHash: await bcrypt.hash(adminPassword, 12),
            role: 'SUPER_ADMIN',
            isActive: true,
        },
    });
    console.log(`Admin ready: ${admin.email} (password from SEED_ADMIN_PASSWORD or default)`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
