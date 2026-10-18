const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const ctrl = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { authenticate, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const otpService = require('../services/otp.service');
const { isRealIndianMobile, isDummyMobile } = require('../utils/validators');

const router = express.Router();

const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.body?.target || req.body?.phoneNumber || req.ip,
    message: { success: false, message: 'Too many OTP requests. Please try again later.' },
});

// A real mobile number: +91 / 10 digits starting 6-9, never an obvious dummy such
// as 1234567890 or 9999999999. The configured demo-login number is exempt.
const phoneValidator = body('phoneNumber')
    .custom((value) => {
        const v = String(value || '').trim();
        if (otpService.isDemoIdentifier(v)) return true;
        if (isRealIndianMobile(v)) return true;
        // Non-Indian numbers: must still look like a phone number and not be a dummy.
        return v.startsWith('+') && !v.startsWith('+91') && require('validator').isMobilePhone(v, 'any') && !isDummyMobile(v);
    })
    .withMessage('Enter a valid mobile number (10 digits, e.g. 98765 43210)');
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
    [body('name').notEmpty(), body('email').isEmail(), body('password').isLength({ min: 8 }), body('role').notEmpty(), body('emailOtp').isLength({ min: 4, max: 4 }).withMessage('Verify the staff email with the 4-digit OTP first')], validate,
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

// ─── Ayuxa Connect: Family account OTP (self-registers). mode covers
// login_screen.dart's "My Mobile" vs "Emergency Contact" toggle — ayuxaId
// (medico uniqueUserId) is required only for the emergency-contact mode. ──
const familyOtpValidator = [
    ...signupOtpValidator,
    body('mode').isIn(['mobile', 'emergency']).withMessage('mode must be mobile or emergency'),
    body('ayuxaId').if(body('mode').equals('emergency')).notEmpty().withMessage('Ayuxa ID is required for emergency contact login'),
];
router.post('/family/request-otp', otpLimiter, [phoneValidator], validate, ctrl.familyRequestOTP);
router.post('/family/verify-otp', familyOtpValidator, validate, ctrl.familyVerifyOTP);
router.post('/family/refresh', ctrl.familyRefreshToken);

// ─── Shared ──────────────────────────────────
router.post('/logout', authenticate, ctrl.logout);

module.exports = router;
