const express = require('express');
const extra = require('../controllers/admin.extra.controller');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

router.get('/', authenticateAdmin, authorize('SUPER_ADMIN'), extra.listAuditLogs);
router.get('/users', authenticateAdmin, authorize('SUPER_ADMIN'), extra.auditUsers);

module.exports = router;
