const express = require('express');
const ctrl = require('../controllers/connect.controller');
const { authenticateFamilyAccount, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// ─── Self-service (Ayuxa Connect app) ───────
router.get('/me', authenticateFamilyAccount, ctrl.getMe);
router.put('/me', authenticateFamilyAccount, ctrl.updateMe);
router.delete('/me', authenticateFamilyAccount, ctrl.deleteAccount);
router.post('/me/patients', authenticateFamilyAccount, ctrl.linkPatient);
router.get('/me/patients', authenticateFamilyAccount, ctrl.listLinkedPatients);
router.get('/me/notifications', authenticateFamilyAccount, ctrl.listNotifications);
router.put('/me/notifications/read-all', authenticateFamilyAccount, ctrl.markAllNotificationsRead);

router.get('/patients/:patientUserId/medical-records', authenticateFamilyAccount, ctrl.listMedicalRecords);
router.get('/patients/:patientUserId/service-history', authenticateFamilyAccount, ctrl.listServiceHistory);
router.get('/patients/:patientUserId/care-team', authenticateFamilyAccount, ctrl.getCareTeam);
router.put('/patients/:patientUserId/emergency-contact/:contactId', authenticateFamilyAccount, ctrl.updateEmergencyContact);
router.get('/plans', authenticateFamilyAccount, ctrl.listPlans);
router.get('/patients/:patientUserId/memberships', authenticateFamilyAccount, ctrl.getMemberships);
router.get('/patients/:patientUserId/subscriptions', authenticateFamilyAccount, ctrl.listSubscriptions);
router.get('/patients/:patientUserId/payments', authenticateFamilyAccount, ctrl.listPayments);
router.post('/patients/:patientUserId/file-url', authenticateFamilyAccount, ctrl.getFileUrl);
router.get('/patients/:patientUserId/uploads', authenticateFamilyAccount, ctrl.listUploads);
router.post('/patients/:patientUserId/uploads', authenticateFamilyAccount, ctrl.addUpload);

// ─── Admin management ────────────────────────
router.post('/care-team', authenticateAdmin, authorize('SUPER_ADMIN', 'OPERATIONS_EXECUTIVE'), ctrl.addCareTeamMember);

module.exports = router;
