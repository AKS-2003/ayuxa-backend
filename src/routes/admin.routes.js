const express = require('express');
const ctrl = require('../controllers/admin.controller');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

router.get('/dashboard', authenticateAdmin, ctrl.dashboard);
router.get('/staff', authenticateAdmin, authorize('SUPER_ADMIN'), ctrl.listStaff);
router.put('/staff/:id/status', authenticateAdmin, authorize('SUPER_ADMIN'), ctrl.setStaffActive);

module.exports = router;
