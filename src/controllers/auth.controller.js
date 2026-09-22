// ──────────────────────────────────────────────
//  Auth Controller
//  Admin login (email+password) + OTP login for:
//    caregiver     — Ayuxa Buddy. Either already exists as a medico
//                    `caregivers` row (added via medico's admin panel),
//                    in which case request-otp/verify-otp just log them
//                    in — or self-signs up via signup/request-otp +
//                    signup/verify-otp, which creates that medico row.
//    familyAccount — Ayuxa Connect. Self-registers on first OTP verify,
//                    same as medico's own User OTP flow.
// ──────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { createAuditLog } = require('../middleware/audit');
const {
    generateAccessToken, generateRefreshToken,
    hashPassword, comparePassword,
    generateAcknowledgementId,
} = require('../utils/helpers');
const otpService = require('../services/otp.service');
const sessionService = require('../services/session.service');
const medicoRepo = require('../services/medico.repository');

/** Strips the session refresh token (and FCM device token) before embedding a CaregiverProfile in a login/signup response. */
function sanitizeProfile(profile) {
    if (!profile) return profile;
    const { refreshToken, fcmDeviceToken, ...safe } = profile;
    return safe;
}

const ACCESS_COOKIE_MAX_AGE = 3600000; // 1 hour
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 3600000; // 30 days

function setAuthCookies(res, accessToken, refreshToken) {
    res.cookie('auth-token', accessToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        signed: true, sameSite: 'lax', maxAge: ACCESS_COOKIE_MAX_AGE,
    });
    res.cookie('refresh-token', refreshToken, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        signed: true, sameSite: 'lax', maxAge: REFRESH_COOKIE_MAX_AGE,
    });
}

// ═══════════════════════════════════════════
//  ADMIN AUTH (email + password)
// ═══════════════════════════════════════════

const adminLogin = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const admin = await prisma.ayuxaAdmin.findUnique({ where: { email } });
        if (!admin) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        if (!admin.isActive) return res.status(403).json({ success: false, message: 'Account deactivated' });

        const isValid = await comparePassword(password, admin.passwordHash);
        if (!isValid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const session = await sessionService.recordAdminSession(admin.id, req);
        const payload = { id: admin.id, role: admin.role, type: 'admin', sessionId: session?.id };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await prisma.ayuxaAdmin.update({ where: { id: admin.id }, data: { refreshToken, lastLoginAt: new Date() } });
        await createAuditLog({
            adminId: admin.id, action: 'ADMIN_LOGIN', entity: 'AyuxaAdmin', entityId: admin.id,
            ipAddress: req.ip, userAgent: req.get('user-agent'),
        });

        res.json({
            success: true,
            data: { accessToken, refreshToken, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } },
        });
    } catch (error) {
        next(error);
    }
};

const adminRegister = async (req, res, next) => {
    try {
        const { name, email, password, role, phone } = req.body;
        const passwordHash = await hashPassword(password);
        const admin = await prisma.ayuxaAdmin.create({ data: { name, email, passwordHash, role, phone } });

        await createAuditLog({
            adminId: req.user.id, action: 'ADMIN_REGISTER', entity: 'AyuxaAdmin', entityId: admin.id,
            newValue: { name, email, role }, ipAddress: req.ip,
        });

        res.status(201).json({ success: true, message: 'Admin created successfully', data: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
    } catch (error) {
        next(error);
    }
};

const adminRefreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        const admin = await prisma.ayuxaAdmin.findUnique({ where: { id: decoded.id } });
        if (!admin || admin.refreshToken !== refreshToken) {
            return res.status(401).json({ success: false, message: 'Invalid refresh token' });
        }

        const payload = { id: admin.id, role: admin.role, type: 'admin', sessionId: decoded.sessionId };
        res.json({ success: true, data: { accessToken: generateAccessToken(payload) } });
    } catch (error) {
        next(error);
    }
};

// ═══════════════════════════════════════════
//  AYUXA BUDDY — Caregiver OTP login (phone OR email, per LoginMode
//  in the original login_screen.dart) + signup (registration_screen.dart
//  collects the full profile after first OTP verification).
// ═══════════════════════════════════════════

/** POST /api/auth/caregiver/request-otp  body: { target, mode: 'mobile'|'email' } */
const caregiverRequestOTP = async (req, res, next) => {
    try {
        const { target, mode } = req.body;

        const caregiver = mode === 'email'
            ? await medicoRepo.findCaregiverByEmail(target)
            : await medicoRepo.findCaregiverByPhone(target);

        if (!caregiver) {
            // Deliberately vague — don't leak which identifiers are registered.
            return res.status(404).json({ success: false, message: 'No Ayuxa caregiver account found. Please sign up.' });
        }

        const result = await otpService.requestOTP(target);
        if (!result.success) return res.status(502).json({ success: false, message: 'Failed to send OTP. Please try again.' });

        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/caregiver/verify-otp  body: { target, mode, otp } */
const caregiverVerifyOTP = async (req, res, next) => {
    try {
        const { target, mode, otp } = req.body;

        const verification = await otpService.verifyOTP(target, otp);
        if (!verification.success) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

        const caregiver = mode === 'email'
            ? await medicoRepo.findCaregiverByEmail(target)
            : await medicoRepo.findCaregiverByPhone(target);
        if (!caregiver) return res.status(404).json({ success: false, message: 'Caregiver not found' });

        let profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId: caregiver.id } });
        if (!profile) {
            profile = await prisma.caregiverProfile.create({
                data: { caregiverId: caregiver.id, phone: caregiver.phone, acknowledgementId: generateAcknowledgementId() },
            });
        }
        if (mode === 'email' && !profile.emailVerified) {
            profile = await prisma.caregiverProfile.update({ where: { id: profile.id }, data: { emailVerified: true } });
        }

        const session = await sessionService.recordCaregiverSession(profile.id, req);
        const payload = { id: caregiver.id, type: 'caregiver', sessionId: session?.id };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await prisma.caregiverProfile.update({ where: { id: profile.id }, data: { refreshToken } });
        setAuthCookies(res, accessToken, refreshToken);

        res.json({
            success: true,
            data: {
                accessToken, refreshToken,
                caregiver: { id: caregiver.id, name: caregiver.name, phone: caregiver.phone, email: caregiver.email },
                profile: sanitizeProfile(profile),
            },
        });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/caregiver/signup/request-otp — mobile-number OTP to create a new account */
const caregiverSignupRequestOTP = async (req, res, next) => {
    try {
        const { phoneNumber } = req.body;

        const existing = await medicoRepo.findCaregiverByPhone(phoneNumber);
        if (existing) {
            return res.status(409).json({ success: false, message: 'This number is already registered. Please log in instead.' });
        }

        const result = await otpService.requestOTP(phoneNumber);
        if (!result.success) return res.status(502).json({ success: false, message: 'Failed to send OTP. Please try again.' });

        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/caregiver/signup/verify-otp — creates the account, full profile filled in via PUT /api/buddy/me afterward */
const caregiverSignupVerifyOTP = async (req, res, next) => {
    try {
        const { phoneNumber, otp } = req.body;

        const verification = await otpService.verifyOTP(phoneNumber, otp);
        if (!verification.success) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

        const existing = await medicoRepo.findCaregiverByPhone(phoneNumber);
        if (existing) {
            return res.status(409).json({ success: false, message: 'This number is already registered. Please log in instead.' });
        }

        const defaultCity = (await medicoRepo.listEnabledCities())[0];
        if (!defaultCity) return res.status(500).json({ success: false, message: 'No city configured. Contact HQ.' });

        const caregiver = await medicoRepo.createCaregiver({ name: '', phone: phoneNumber, cityId: defaultCity.id });
        const profile = await prisma.caregiverProfile.create({
            data: { caregiverId: caregiver.id, phone: phoneNumber, acknowledgementId: generateAcknowledgementId() },
        });

        const session = await sessionService.recordCaregiverSession(profile.id, req);
        const payload = { id: caregiver.id, type: 'caregiver', sessionId: session?.id };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await prisma.caregiverProfile.update({ where: { id: profile.id }, data: { refreshToken } });
        setAuthCookies(res, accessToken, refreshToken);

        res.status(201).json({
            success: true,
            data: {
                accessToken, refreshToken,
                caregiver: { id: caregiver.id, name: caregiver.name, phone: caregiver.phone, email: caregiver.email },
                profile: sanitizeProfile(profile),
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/caregiver/verify-email/request-otp — sends an OTP to an
 * arbitrary email address so registration_screen.dart's "Verify" button
 * can confirm ownership during signup, before any caregiver account
 * exists. Unlike the login endpoints, this never checks medico's
 * caregivers table — email verification here is just proof of ownership.
 */
const caregiverVerifyEmailRequestOTP = async (req, res, next) => {
    try {
        const { email } = req.body;
        const result = await otpService.requestOTP(email);
        if (!result.success) return res.status(502).json({ success: false, message: 'Failed to send OTP. Please try again.' });
        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/caregiver/verify-email/verify-otp */
const caregiverVerifyEmailVerifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body;
        const verification = await otpService.verifyOTP(email, otp);
        if (!verification.success) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        res.json({ success: true, message: 'Email verified' });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/caregiver/refresh */
const caregiverRefreshToken = async (req, res, next) => {
    try {
        let { refreshToken } = req.body;
        if (!refreshToken && req.signedCookies) refreshToken = req.signedCookies['refresh-token'];
        if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        const profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId: decoded.id } });
        if (!profile || profile.refreshToken !== refreshToken) {
            return res.status(401).json({ success: false, message: 'Invalid session' });
        }

        const payload = { id: decoded.id, type: 'caregiver', sessionId: decoded.sessionId };
        const newAccessToken = generateAccessToken(payload);
        res.cookie('auth-token', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', signed: true, sameSite: 'lax', maxAge: ACCESS_COOKIE_MAX_AGE });
        res.json({ success: true, data: { accessToken: newAccessToken } });
    } catch (error) {
        next(error);
    }
};

// ═══════════════════════════════════════════
//  AYUXA CONNECT — Family account OTP login
//  Mirrors login_screen.dart's two LoginModes:
//    mobile    — family member's own number; if not yet linked to any
//                patient, the app separately calls POST /api/connect/me/patients
//                (see connect.controller.js linkPatient) after this.
//    emergency — family member's own number, which must already be a
//                registered emergency contact for the patient identified
//                by ayuxaId (medico User.uniqueUserId) — verify-otp links
//                them immediately, matching otp_verify_screen.dart's
//                inline validation (no separate Link screen for this mode).
// ═══════════════════════════════════════════

/** POST /api/auth/family/request-otp  body: { phoneNumber } */
const familyRequestOTP = async (req, res, next) => {
    try {
        const { phoneNumber } = req.body;
        const result = await otpService.requestOTP(phoneNumber);
        if (!result.success) return res.status(502).json({ success: false, message: 'Failed to send OTP. Please try again.' });
        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/family/verify-otp  body: { phoneNumber, otp, mode, ayuxaId? } */
const familyVerifyOTP = async (req, res, next) => {
    try {
        const { phoneNumber, otp, mode, ayuxaId } = req.body;

        const verification = await otpService.verifyOTP(phoneNumber, otp);
        if (!verification.success) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

        let account = await prisma.familyAccount.findUnique({ where: { phone: phoneNumber } });
        const isNewAccount = !account;
        if (isNewAccount) {
            account = await prisma.familyAccount.create({ data: { phone: phoneNumber } });
        }

        let linkedPatient = null;
        if (mode === 'emergency') {
            if (!ayuxaId) return res.status(422).json({ success: false, message: 'Ayuxa ID is required for emergency contact login' });

            const patient = await medicoRepo.findUserByUniqueUserId(ayuxaId);
            if (!patient) return res.status(404).json({ success: false, message: 'No patient found with that Ayuxa ID' });

            const isEmergencyContact = await medicoRepo.isEmergencyContactForUser(patient.id, phoneNumber);
            if (!isEmergencyContact) {
                return res.status(403).json({ success: false, message: 'This number is not a registered emergency contact for that patient' });
            }

            const link = await prisma.familyPatientLink.upsert({
                where: { accountId_patientUserId: { accountId: account.id, patientUserId: patient.id } },
                update: {},
                create: { accountId: account.id, patientUserId: patient.id, relation: 'Emergency Contact' },
            });
            linkedPatient = { link, patient: { id: patient.id, name: patient.name, uniqueUserId: patient.uniqueUserId } };
        }

        const session = await sessionService.recordFamilyAccountSession(account.id, req);
        const payload = { id: account.id, type: 'familyAccount', sessionId: session?.id };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await prisma.familyAccount.update({ where: { id: account.id }, data: { refreshToken } });
        setAuthCookies(res, accessToken, refreshToken);

        res.json({
            success: true,
            data: {
                isNewAccount, accessToken, refreshToken,
                account: { id: account.id, name: account.name, phone: account.phone },
                linkedPatient,
            },
        });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/family/refresh */
const familyRefreshToken = async (req, res, next) => {
    try {
        let { refreshToken } = req.body;
        if (!refreshToken && req.signedCookies) refreshToken = req.signedCookies['refresh-token'];
        if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        const account = await prisma.familyAccount.findUnique({ where: { id: decoded.id } });
        if (!account || account.refreshToken !== refreshToken) {
            return res.status(401).json({ success: false, message: 'Invalid session' });
        }

        const payload = { id: account.id, type: 'familyAccount', sessionId: decoded.sessionId };
        const newAccessToken = generateAccessToken(payload);
        res.cookie('auth-token', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', signed: true, sameSite: 'lax', maxAge: ACCESS_COOKIE_MAX_AGE });
        res.json({ success: true, data: { accessToken: newAccessToken } });
    } catch (error) {
        next(error);
    }
};

// ═══════════════════════════════════════════
//  SHARED
// ═══════════════════════════════════════════

const logout = async (req, res, next) => {
    try {
        const { type, id } = req.user;

        if (type === 'admin') {
            await prisma.ayuxaAdmin.update({ where: { id }, data: { refreshToken: null } });
        } else if (type === 'caregiver') {
            await prisma.caregiverProfile.update({ where: { caregiverId: id }, data: { refreshToken: null } });
        } else if (type === 'familyAccount') {
            await prisma.familyAccount.update({ where: { id }, data: { refreshToken: null } });
        }

        res.clearCookie('auth-token');
        res.clearCookie('refresh-token');
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    adminLogin, adminRegister, adminRefreshToken,
    caregiverRequestOTP, caregiverVerifyOTP, caregiverRefreshToken,
    caregiverSignupRequestOTP, caregiverSignupVerifyOTP,
    caregiverVerifyEmailRequestOTP, caregiverVerifyEmailVerifyOTP,
    familyRequestOTP, familyVerifyOTP, familyRefreshToken,
    logout,
};
