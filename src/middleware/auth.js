// ──────────────────────────────────────────────
//  JWT Authentication Middleware
//  Three actor types share one JWT shape, distinguished by `type`:
//    admin        — Ayuxa HQ staff (email+password), own table
//    caregiver    — Ayuxa Buddy user. id = medico Caregiver.id;
//                   req.caregiverProfile is this backend's CaregiverProfile row.
//    familyAccount — Ayuxa Connect user (own table, own phone-OTP login).
// ──────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');

const SESSION_MODEL = {
    admin: 'ayuxaAdminSession',
    caregiver: 'caregiverSession',
    familyAccount: 'familyAccountSession',
};

function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    if (req.signedCookies) {
        return req.signedCookies['auth-token'] || null;
    }
    return null;
}

/** Generic guard — accepts a token from any actor type, checks session validity. */
const authenticate = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.sessionId) {
            const sessionModel = SESSION_MODEL[decoded.type];
            const activeSession = sessionModel
                ? await prisma[sessionModel].findUnique({ where: { id: decoded.sessionId } })
                : null;
            if (!activeSession || !activeSession.isActive) {
                return res.status(401).json({ success: false, message: 'Session terminated' });
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired' });
        }
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};

async function verifySession(decoded, type) {
    if (!decoded.sessionId) return true;
    const activeSession = await prisma[SESSION_MODEL[type]].findUnique({ where: { id: decoded.sessionId } });
    return !!activeSession?.isActive;
}

/** Admin guard — re-fetches the admin row from this backend's own table. */
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ success: false, message: 'Admin authentication required' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'admin') return res.status(403).json({ success: false, message: 'Admin access restricted' });
        if (!(await verifySession(decoded, 'admin'))) {
            return res.status(401).json({ success: false, message: 'Session terminated. Please login again.' });
        }

        const admin = await prisma.ayuxaAdmin.findUnique({ where: { id: decoded.id } });
        if (!admin || !admin.isActive) {
            return res.status(403).json({ success: false, message: 'Admin account deactivated' });
        }

        req.admin = admin;
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired' });
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};

/**
 * Caregiver guard (Ayuxa Buddy). decoded.id = medico Caregiver.id.
 * Attaches req.caregiver (medico caregivers row) and req.caregiverProfile
 * (this backend's caregiver_profiles row, KYC/onboarding data).
 */
const authenticateCaregiver = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ success: false, message: 'Session required' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'caregiver') return res.status(403).json({ success: false, message: 'Caregiver access restricted' });
        if (!(await verifySession(decoded, 'caregiver'))) {
            return res.status(401).json({ success: false, message: 'Session terminated. Please login again.' });
        }

        const [caregiver, profile] = await Promise.all([
            medicoRepo.findCaregiverById(decoded.id),
            prisma.caregiverProfile.findUnique({ where: { caregiverId: decoded.id } }),
        ]);
        if (!caregiver || !profile) {
            return res.status(403).json({ success: false, message: 'Caregiver profile not found' });
        }

        req.caregiver = caregiver;
        req.caregiverProfile = profile;
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired' });
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};

/** Family account guard (Ayuxa Connect). decoded.id = this backend's FamilyAccount.id. */
const authenticateFamilyAccount = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ success: false, message: 'Session required' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.type !== 'familyAccount') return res.status(403).json({ success: false, message: 'Access restricted' });
        if (!(await verifySession(decoded, 'familyAccount'))) {
            return res.status(401).json({ success: false, message: 'Session terminated. Please login again.' });
        }

        const account = await prisma.familyAccount.findUnique({ where: { id: decoded.id } });
        if (!account) return res.status(403).json({ success: false, message: 'Account not found' });

        req.familyAccount = account;
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired' });
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};

module.exports = {
    authenticate,
    authenticateAdmin,
    authenticateCaregiver,
    authenticateFamilyAccount,
};
