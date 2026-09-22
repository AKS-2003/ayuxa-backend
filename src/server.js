// ══════════════════════════════════════════════════════════════
//  Ayuxa Backend — shared API for Ayuxa Buddy (caregiver app),
//  Ayuxa Connect (patient & family app), and the Ayuxa Admin panel.
//
//  Architecture mirrors medico's backend/src/server.js: Helmet +
//  CORS + tiered rate limiting, routes -> controllers -> services,
//  Prisma/Postgres, JWT access+refresh with a DB-persisted session
//  per actor type.
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { logger } = require('./config/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const buddyRoutes = require('./routes/buddy.routes');
const connectRoutes = require('./routes/connect.routes');
const mediaRoutes = require('./routes/media.routes');
const sessionRoutes = require('./routes/session.routes');
const auditRoutes = require('./routes/audit.routes');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(cookieParser(process.env.JWT_SECRET));

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// ─── CORS ───────────────────────────────────
const ALLOWED_ORIGINS = [
    process.env.ADMIN_FRONTEND_URL,
    process.env.BUDDY_APP_URL,
    process.env.CONNECT_APP_URL,
    'http://localhost:3000',
    'http://localhost:3001',
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // mobile apps, curl, server-to-server
        const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
            origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin);

        if (isAllowed) return callback(null, true);
        logger.warn(`CORS blocked: ${origin}`);
        callback(null, true); // allow while debugging, but log it — tighten before production
    },
    credentials: true,
    maxAge: 86400,
}));

// ─── Rate limiting ───────────────────────────
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
    skip: (req) => req.path === '/api/health',
});
app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many auth attempts. Please try again later.' },
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Upload rate limit exceeded. Please try again later.' },
});

// ─── Body parsing ─────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static file serving (local storage provider) ────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Logging ──────────────────────────────────
app.use(morgan(':method :url :status :response-time ms - :remote-addr', {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => process.env.NODE_ENV === 'production' && req.path === '/api/health',
}));

// ─── Health check ─────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Ayuxa API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
    });
});

// ─── API routes ────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/buddy', buddyRoutes);
app.use('/api/connect', connectRoutes);
app.use('/api/media', uploadLimiter, mediaRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/audit-logs', auditRoutes);

// ─── Error handling ─────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Ayuxa Backend running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;
