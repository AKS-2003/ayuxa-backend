// ──────────────────────────────────────────────
//  Medico billing bridge
//  Plan purchase, Razorpay orders, signature checks, renewals/upgrades and
//  membership activation all live in medico's backend. Re-implementing that
//  here would fork real-money business logic, so Ayuxa Connect relays the same
//  calls medico's own app makes, acting as the (linked) patient:
//
//    subscriptions/initiate → payments/initiate → [Razorpay checkout in the app]
//    → payments/verify            (or payments/cancel on dismiss/failure)
//
//  Needs MEDICO_API_URL (e.g. http://127.0.0.1:5000/api) and MEDICO_JWT_SECRET
//  (the same JWT_SECRET medico signs its tokens with). Without them billing is
//  reported as unavailable instead of failing obscurely.
// ──────────────────────────────────────────────

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { logger } = require('../config/logger');

class BillingError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function isConfigured() {
    return !!(process.env.MEDICO_API_URL && process.env.MEDICO_JWT_SECRET);
}

/** A short-lived medico user token for [patientUserId] — never leaves the server. */
function patientToken(patientUserId) {
    return jwt.sign({ id: patientUserId, type: 'user' }, process.env.MEDICO_JWT_SECRET, { expiresIn: '10m' });
}

async function call(patientUserId, method, path, body) {
    if (!isConfigured()) throw new BillingError(503, 'Online payments are not available right now. Please contact support.');
    try {
        const res = await axios({
            method,
            url: `${process.env.MEDICO_API_URL.replace(/\/$/, '')}${path}`,
            data: body,
            headers: { Authorization: `Bearer ${patientToken(patientUserId)}` },
            timeout: 30000,
        });
        return res.data;
    } catch (error) {
        const status = error.response?.status || 502;
        const message = error.response?.data?.message || 'The payment service could not be reached. Please try again.';
        logger.warn(`[Billing] ${method.toUpperCase()} ${path} → ${status}: ${message}`);
        throw new BillingError(status >= 500 ? 502 : status, message);
    }
}

/**
 * Creates the pending subscription and the Razorpay order for it.
 * Returns what the app needs to open the checkout sheet.
 */
async function startSubscription(patientUserId, { planId, billingCycle, amount }) {
    const sub = await call(patientUserId, 'post', '/subscriptions/initiate', { planId, billingCycle, amount });
    const subscription = sub.data;
    if (!subscription?.id) throw new BillingError(502, 'Could not start the subscription.');

    const order = await call(patientUserId, 'post', '/payments/initiate', {
        amount: subscription.amount,
        paymentMethod: 'UPI',
        subscriptionId: subscription.id,
    });
    const o = order.data || {};
    return {
        subscriptionId: subscription.id,
        paymentId: o.paymentId,
        orderId: o.orderId || null,
        amount: o.amount ?? subscription.amount,
        currency: o.currency || 'INR',
        key: o.key || null,
        paymentNotRequired: !!o.paymentNotRequired,
    };
}

const verifyPayment = (patientUserId, ids) => call(patientUserId, 'post', '/payments/verify', ids);
const cancelPayment = (patientUserId, orderId) => call(patientUserId, 'post', '/payments/cancel', { orderId });

module.exports = { isConfigured, startSubscription, verifyPayment, cancelPayment, BillingError };
