// ──────────────────────────────────────────────
//  Role-Based Access Control (Admin only)
// ──────────────────────────────────────────────

const authorize = (...allowedRoles) => (req, res, next) => {
    if (!req.user || req.user.type !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
};

module.exports = { authorize };
