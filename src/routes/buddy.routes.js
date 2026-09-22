const express = require('express');
const ctrl = require('../controllers/buddy.controller');
const { authenticateCaregiver, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// ─── Self-service (Ayuxa Buddy app) ─────────
router.get('/me', authenticateCaregiver, ctrl.getMe);
router.put('/me', authenticateCaregiver, ctrl.updateMe);
router.post('/me/kyc/submit', authenticateCaregiver, ctrl.submitKyc);
router.post('/me/pcc', authenticateCaregiver, ctrl.uploadPcc);
router.post('/me/agreement/accept', authenticateCaregiver, ctrl.acceptAgreement);
router.post('/me/check-ins', authenticateCaregiver, ctrl.createCheckInRecord);
router.post('/me/check-ins/:id/check-in', authenticateCaregiver, ctrl.checkIn);
router.post('/me/check-ins/:id/check-out', authenticateCaregiver, ctrl.checkOut);
router.put('/me/check-ins/:checkInId/tasks/:taskId', authenticateCaregiver, ctrl.toggleTask);
router.post('/me/uploads', authenticateCaregiver, ctrl.addUpload);
router.put('/me/notifications/read-all', authenticateCaregiver, ctrl.markAllNotificationsRead);

// ─── Admin management ────────────────────────
router.put('/profiles/:caregiverId/kyc', authenticateAdmin, authorize('SUPER_ADMIN', 'OPERATIONS_EXECUTIVE'), ctrl.setKycStatus);

module.exports = router;
