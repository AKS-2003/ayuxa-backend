const express = require('express');
const ctrl = require('../controllers/connect.controller');
const { authenticateFamilyAccount, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// ─── Self-service (Ayuxa Connect app) ───────
router.get('/me', authenticateFamilyAccount, ctrl.getMe);
router.put('/me', authenticateFamilyAccount, ctrl.updateMe);
router.post('/me/email/request-otp', authenticateFamilyAccount, ctrl.requestEmailOtp);
router.get('/support', authenticateFamilyAccount, ctrl.getSupport);
router.delete('/me', authenticateFamilyAccount, ctrl.deleteAccount);
router.post('/me/patients', authenticateFamilyAccount, ctrl.linkPatient);
router.get('/me/patients', authenticateFamilyAccount, ctrl.listLinkedPatients);
router.get('/me/notifications', authenticateFamilyAccount, ctrl.listNotifications);
router.put('/me/device-token', authenticateFamilyAccount, ctrl.setDeviceToken);
router.put('/me/notifications/read-all', authenticateFamilyAccount, ctrl.markAllNotificationsRead);
router.put('/me/notifications/:notificationId/read', authenticateFamilyAccount, ctrl.markNotificationRead);

router.get('/patients/:patientUserId/medical-records', authenticateFamilyAccount, ctrl.listMedicalRecords);
router.get('/patients/:patientUserId/service-history', authenticateFamilyAccount, ctrl.listServiceHistory);
router.get('/patients/:patientUserId/care-team', authenticateFamilyAccount, ctrl.getCareTeam);
router.post('/patients/:patientUserId/emergency-contacts', authenticateFamilyAccount, ctrl.addEmergencyContact);
router.put('/patients/:patientUserId/emergency-contact/:contactId', authenticateFamilyAccount, ctrl.updateEmergencyContact);
router.delete('/patients/:patientUserId/emergency-contact/:contactId', authenticateFamilyAccount, ctrl.deleteEmergencyContact);
router.get('/plans', authenticateFamilyAccount, ctrl.listPlans);
router.post('/patients/:patientUserId/checkout/start', authenticateFamilyAccount, ctrl.startCheckout);
router.post('/patients/:patientUserId/checkout/verify', authenticateFamilyAccount, ctrl.verifyCheckout);
router.post('/patients/:patientUserId/checkout/cancel', authenticateFamilyAccount, ctrl.cancelCheckout);
router.get('/patients/:patientUserId/memberships', authenticateFamilyAccount, ctrl.getMemberships);
router.get('/patients/:patientUserId/subscriptions', authenticateFamilyAccount, ctrl.listSubscriptions);
router.get('/patients/:patientUserId/payments', authenticateFamilyAccount, ctrl.listPayments);
router.post('/patients/:patientUserId/file-url', authenticateFamilyAccount, ctrl.getFileUrl);
router.get('/patients/:patientUserId/uploads', authenticateFamilyAccount, ctrl.listUploads);
router.post('/patients/:patientUserId/uploads', authenticateFamilyAccount, ctrl.addUpload);
router.put('/patients/:patientUserId/uploads/:uploadId', authenticateFamilyAccount, ctrl.updateUpload);
router.delete('/patients/:patientUserId/uploads/:uploadId', authenticateFamilyAccount, ctrl.deleteUpload);

// ─── Admin management ────────────────────────
router.post('/care-team', authenticateAdmin, authorize('SUPER_ADMIN', 'OPERATIONS_EXECUTIVE'), ctrl.addCareTeamMember);

module.exports = router;
