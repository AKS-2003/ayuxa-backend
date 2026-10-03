// ──────────────────────────────────────────────
//  OTP Service
//  Same shape as medico: 4-digit code, 10-min expiry, OtpLog table.
//  Handles both phone and email identifiers — the `phoneNumber` column
//  is reused as a generic "identifier" (it's just a unique string key,
//  and adding a real email OTP table would duplicate this exact logic).
//
//  Delivery is behind a provider switch so this works without any SMS/
//  email account during development — set OTP_SMS_PROVIDER / OTP_EMAIL_PROVIDER
//  once real credentials exist. Until then both default to "console",
//  which just logs the code.
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const { logger } = require('../config/logger');
const { generateOTP } = require('../utils/helpers');

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// A single fixed identifier + code for app-store review builds, so a
// reviewer can log in without receiving a real SMS/email. Scoped to one
// exact identifier — every other number/email still goes through real
// delivery and single-use verification. Unset DEMO_LOGIN_IDENTIFIER in
// any environment to disable this entirely.
const DEMO_IDENTIFIER = process.env.DEMO_LOGIN_IDENTIFIER || null;
const DEMO_OTP = process.env.DEMO_LOGIN_OTP || null;

function isEmail(identifier) {
    return identifier.includes('@');
}

function isDemoIdentifier(identifier) {
    return !!DEMO_IDENTIFIER && !!DEMO_OTP && identifier === DEMO_IDENTIFIER;
}

async function deliverSMS(phoneNumber, otp) {
    const provider = process.env.OTP_SMS_PROVIDER || 'console';

    if (provider === 'console') {
        const masked = phoneNumber.replace(/(\+?\d{2,3})\d+(\d{4})$/, '$1***$2');
        logger.info(`[OTP][console-provider] ${masked} → ${otp} (set OTP_SMS_PROVIDER to send real SMS)`);
        return true;
    }

    if (provider === 'fast2sms') {
        const fast2sms = require('./providers/fast2sms.service');
        return fast2sms.sendOTP(phoneNumber, otp);
    }

    throw new Error(`Unknown OTP_SMS_PROVIDER: ${provider}`);
}

async function deliverEmail(email, otp) {
    const provider = process.env.OTP_EMAIL_PROVIDER || 'console';

    if (provider === 'console') {
        const masked = email.replace(/^(.{2}).+(@.+)$/, '$1***$2');
        logger.info(`[OTP][console-provider] ${masked} → ${otp} (set OTP_EMAIL_PROVIDER to send real email)`);
        return true;
    }

    if (provider === 'zeptomail') {
        const zeptomail = require('./providers/zeptomail.service');
        return zeptomail.sendOTP(email, otp);
    }

    throw new Error(`Unknown OTP_EMAIL_PROVIDER: ${provider}`);
}

const requestOTP = async (identifier) => {
    if (isDemoIdentifier(identifier)) {
        logger.info(`[OTP][demo] request for ${identifier} — using fixed demo code, no delivery sent`);
        return { success: true };
    }

    const otp = generateOTP();

    const delivered = await (isEmail(identifier) ? deliverEmail(identifier, otp) : deliverSMS(identifier, otp))
        .catch((err) => {
            logger.warn(`[OTP] delivery failed: ${err.message}`);
            return false;
        });

    if (!delivered) {
        return { success: false };
    }

    await prisma.otpLog.create({
        data: {
            phoneNumber: identifier,
            code: otp,
            expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        },
    });

    return { success: true };
};

const verifyOTP = async (identifier, code) => {
    if (isDemoIdentifier(identifier)) {
        return { success: code === DEMO_OTP };
    }

    const otpRecord = await prisma.otpLog.findFirst({
        where: {
            phoneNumber: identifier,
            code,
            expiresAt: { gt: new Date() },
            isUsed: false,
        },
        orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) return { success: false };

    await prisma.otpLog.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
    });

    return { success: true };
};

module.exports = { requestOTP, verifyOTP, isEmail, isDemoIdentifier };
