// ──────────────────────────────────────────────
//  Fast2SMS DLT Provider — OTP delivery
//  Mirrors medico's backend/src/services/sms/{fast2sms.provider,sms.service}.js
//  dispatch logic, reusing the same Fast2SMS account/DLT template (OTP_USER,
//  templateId 215237, senderId AYUXA) — see FAST2SMS_* in .env.
// ──────────────────────────────────────────────

const axios = require('axios');
const { logger } = require('../../config/logger');

const BASE_URL = process.env.FAST2SMS_BASE_URL || 'https://www.fast2sms.com/dev/bulkV2';
const OTP_TEMPLATE_ID = process.env.FAST2SMS_OTP_TEMPLATE_ID || '215237';
const SENDER_ID = process.env.FAST2SMS_SENDER_ID || 'AYUXA';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

function validateIndianMobile(mobile) {
    const clean = String(mobile).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(clean)) {
        throw new Error(`Invalid Indian mobile number: ${mobile}`);
    }
    return clean;
}

/** Sends a 4-digit OTP via Fast2SMS's DLT-registered OTP_USER template. */
const sendOTP = async (phoneNumber, otp) => {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
        logger.warn('[Fast2SMS] FAST2SMS_API_KEY not set — cannot send real SMS');
        return false;
    }

    const mobile = validateIndianMobile(phoneNumber);
    const payload = {
        route: 'dlt',
        sender_id: SENDER_ID,
        message: OTP_TEMPLATE_ID,
        variables_values: `${otp}|`,
        numbers: mobile,
        flash: 0,
    };
    if (process.env.FAST2SMS_DLT_ENTITY_ID) {
        payload.entity_id = process.env.FAST2SMS_DLT_ENTITY_ID;
    }

    let attempt = 0;
    let lastError;

    while (attempt < MAX_RETRIES) {
        attempt++;
        try {
            const response = await axios.post(BASE_URL, payload, {
                headers: { authorization: apiKey, 'Content-Type': 'application/json' },
                timeout: 10000,
            });

            const resData = response.data;
            if (resData?.return === true) {
                logger.info(`[Fast2SMS] OTP sent to +91${mobile} [reqId: ${resData.request_id || 'n/a'}]`);
                return true;
            }

            // Fast2SMS returns HTTP 200 even on business-logic failures — don't retry those.
            logger.error(`[Fast2SMS] Rejected: ${JSON.stringify(resData)}`);
            return false;
        } catch (error) {
            const status = error.response?.status;
            const errData = error.response?.data;
            lastError = typeof errData === 'string' ? errData.substring(0, 300) : JSON.stringify(errData) || error.message;

            logger.error(`[Fast2SMS] HTTP error (attempt ${attempt}/${MAX_RETRIES}): [${status || 'network'}] ${lastError}`);

            if (status && status < 500) return false; // client error — don't retry
            if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
            }
        }
    }

    logger.error(`[Fast2SMS] OTP send failed after ${MAX_RETRIES} attempts: ${lastError}`);
    return false;
};

module.exports = { sendOTP };
