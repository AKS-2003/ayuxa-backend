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

function isEmail(identifier) {
    return identifier.includes('@');
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

module.exports = { requestOTP, verifyOTP, isEmail };
