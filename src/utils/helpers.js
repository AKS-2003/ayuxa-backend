// ──────────────────────────────────────────────
//  Utility Helpers
// ──────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ─── JWT Token Generation ───────────────────

const generateAccessToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
    });
};

const generateRefreshToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
    });
};

// ─── Password Hashing ──────────────────────

const hashPassword = async (password) => bcrypt.hash(password, 12);
const comparePassword = async (password, hash) => bcrypt.compare(password, hash);

// ─── ID Generation ──────────────────────────
// Caregiver (Buddy): ACK-XXXXX acknowledgement id, AYX-EMP-XXXXX employee id

const _randomSuffix = () => String(Date.now() % 100000).padStart(5, '0');

const generateAcknowledgementId = () => `ACK-${_randomSuffix()}`;
const generateEmployeeId = () => `AYX-EMP-${_randomSuffix()}`;

// ─── OTP Generation ─────────────────────────

const generateOTP = () => String(Math.floor(1000 + Math.random() * 9000)); // 4-digit

// ─── Pagination Helper ──────────────────────

const paginate = (query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// ─── Standard Response Helpers ──────────────

const sendResponse = (res, statusCode, data, message = 'Success') => {
    return res.status(statusCode).json({
        success: statusCode < 400,
        message,
        data,
    });
};

const sendPaginatedResponse = (res, data, total, page, limit) => {
    return res.json({
        success: true,
        data,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasMore: page * limit < total,
        },
    });
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    hashPassword,
    comparePassword,
    generateAcknowledgementId,
    generateEmployeeId,
    generateOTP,
    paginate,
    sendResponse,
    sendPaginatedResponse,
};
