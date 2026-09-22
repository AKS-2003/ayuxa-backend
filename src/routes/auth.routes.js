const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const ctrl = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.body?.target || req.body?.phoneNumber || req.ip,
    message: { success: false, message: 'Too many OTP requests. Please try again later.' },
});

const phoneValidator = body('phoneNumber').isMobilePhone('any').withMessage('Valid phone number required');
const signupOtpValidator = [phoneValidator, body('otp').isLength({ min: 4, max: 4 }).withMessage('4-digit OTP required')];

const emailValidator = body('email').isEmail().withMessage('Valid email is required');
const emailOtpValidator = [emailValidator, body('otp').isLength({ min: 4, max: 4 }).withMessage('4-digit OTP required')];

// target/mode covers login_screen.dart's Mobile OTP / Email OTP toggle —
// target is a phone number when mode is 'mobile', an email when 'email'.
const loginTargetValidator = [
    body('target').notEmpty().withMessage('Mobile number or email is required'),
    body('mode').isIn(['mobile', 'email']).withMessage('mode must be mobile or email'),
];
const loginOtpValidator = [...loginTargetValidator, body('otp').isLength({ min: 4, max: 4 }).withMessage('4-digit OTP required')];

// ─── Admin ───────────────────────────────────
router.post('/admin/login', [body('email').isEmail(), body('password').notEmpty()], validate, ctrl.adminLogin);
router.post('/admin/register',
    authenticateAdmin, authorize('SUPER_ADMIN'),
    [body('name').notEmpty(), body('email').isEmail(), body('password').isLength({ min: 8 }), body('role').notEmpty()], validate,
    ctrl.adminRegister);
router.post('/admin/refresh', ctrl.adminRefreshToken);

// ─── Ayuxa Buddy: Caregiver OTP login (mobile or email, existing account) ──
router.post('/caregiver/request-otp', otpLimiter, loginTargetValidator, validate, ctrl.caregiverRequestOTP);
router.post('/caregiver/verify-otp', loginOtpValidator, validate, ctrl.caregiverVerifyOTP);
router.post('/caregiver/refresh', ctrl.caregiverRefreshToken);

// ─── Ayuxa Buddy: Caregiver signup (create a brand-new caregiver) ──
router.post('/caregiver/signup/request-otp', otpLimiter, [phoneValidator], validate, ctrl.caregiverSignupRequestOTP);
router.post('/caregiver/signup/verify-otp', signupOtpValidator, validate, ctrl.caregiverSignupVerifyOTP);

// ─── Ayuxa Buddy: email ownership verification (registration_screen.dart's
// "Verify" button) — no account required, unlike login's email mode. ──
router.post('/caregiver/verify-email/request-otp', otpLimiter, [emailValidator], validate, ctrl.caregiverVerifyEmailRequestOTP);
router.post('/caregiver/verify-email/verify-otp', emailOtpValidator, validate, ctrl.caregiverVerifyEmailVerifyOTP);

// ─── Ayuxa Connect: Family account OTP (self-registers) ────────
router.post('/family/request-otp', otpLimiter, [phoneValidator], validate, ctrl.familyRequestOTP);
router.post('/family/verify-otp', signupOtpValidator, validate, ctrl.familyVerifyOTP);
router.post('/family/refresh', ctrl.familyRefreshToken);

// ─── Shared ──────────────────────────────────
router.post('/logout', authenticate, ctrl.logout);

module.exports = router;
