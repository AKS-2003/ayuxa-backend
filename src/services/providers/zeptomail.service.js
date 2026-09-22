// ──────────────────────────────────────────────
//  ZeptoMail Provider — OTP email delivery
//  Mirrors medico's backend/src/services/email/email.service.js delivery
//  logic, reusing the same ZeptoMail account/sender (see ZEPTOMAIL_* in .env).
// ──────────────────────────────────────────────

const { SendMailClient } = require('zeptomail');
const { logger } = require('../../config/logger');

const ZEPTOMAIL_URL = 'https://api.zeptomail.in/v1.1/email';
const SENDER_EMAIL = process.env.ZEPTOMAIL_SENDER_EMAIL || 'noreply@ayuxacare.com';
const SENDER_NAME = process.env.ZEPTOMAIL_SENDER_NAME || 'Ayuxa Platforms';

let _client = null;

function getClient() {
    const token = process.env.ZEPTOMAIL_API_KEY;
    if (!_client && token) {
        _client = new SendMailClient({ url: ZEPTOMAIL_URL, token });
    }
    return _client;
}

/** Sends a 4-digit OTP as a simple transactional email via ZeptoMail. */
const sendOTP = async (email, otp) => {
    const client = getClient();
    if (!client) {
        logger.warn('[ZeptoMail] ZEPTOMAIL_API_KEY not set — cannot send real email');
        return false;
    }

    try {
        await client.sendMail({
            from: { address: SENDER_EMAIL, name: SENDER_NAME },
            to: [{ email_address: { address: email, name: email.split('@')[0] } }],
            subject: 'Your Ayuxa Buddy verification code',
            htmlbody: `<p><strong>${otp}</strong> is your Ayuxa Buddy verification code. Do not share it with anyone.</p>
                       <p>This code expires in 10 minutes.</p>`,
        });
        logger.info(`[ZeptoMail] OTP sent to ${email}`);
        return true;
    } catch (err) {
        const errMsg = typeof err === 'object' ? JSON.stringify(err) : String(err);
        logger.error(`[ZeptoMail] Send failed for ${email}: ${errMsg}`);
        return false;
    }
};

module.exports = { sendOTP };
