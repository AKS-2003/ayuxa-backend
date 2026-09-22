const express = require('express');
const ctrl = require('../controllers/connect.controller');
const { authenticateFamilyAccount, authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

// ─── Self-service (Ayuxa Connect app) ───────
router.get('/me', authenticateFamilyAccount, ctrl.getMe);
router.put('/me', authenticateFamilyAccount, ctrl.updateMe);
router.post('/me/patients', authenticateFamilyAccount, ctrl.linkPatient);
router.get('/me/patients', authenticateFamilyAccount, ctrl.listLinkedPatients);
router.get('/patients/:patientUserId/medical-records', authenticateFamilyAccount, ctrl.listMedicalRecords);
router.get('/patients/:patientUserId/service-history', authenticateFamilyAccount, ctrl.listServiceHistory);
router.get('/patients/:patientUserId/care-team', authenticateFamilyAccount, ctrl.getCareTeam);

// ─── Admin management ────────────────────────
router.post('/care-team', authenticateAdmin, authorize('SUPER_ADMIN', 'OPERATIONS_EXECUTIVE'), ctrl.addCareTeamMember);

module.exports = router;
