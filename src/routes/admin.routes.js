const express = require('express');
const ctrl = require('../controllers/admin.controller');
const extra = require('../controllers/admin.extra.controller');
const { authenticateAdmin } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');

const router = express.Router();

const staffRoles = ['SUPER_ADMIN', 'OPERATIONS_EXECUTIVE'];

router.get('/dashboard', authenticateAdmin, ctrl.dashboard);

// ─── Ayuxa Buddy: caregiver management ──────────────
router.get('/caregivers', authenticateAdmin, authorize(...staffRoles), ctrl.listCaregivers);
router.get('/caregivers/:caregiverId', authenticateAdmin, authorize(...staffRoles), ctrl.getCaregiverDetail);
router.put('/caregivers/:caregiverId/kyc', authenticateAdmin, authorize(...staffRoles), ctrl.setCaregiverKyc);
router.post('/caregivers/:caregiverId/assignments', authenticateAdmin, authorize(...staffRoles), ctrl.createAssignment);
router.get('/check-ins', authenticateAdmin, authorize(...staffRoles), extra.listCheckIns);
router.get('/check-ins/:checkInId', authenticateAdmin, authorize(...staffRoles), extra.getCheckInDetail);
router.put('/check-ins/:checkInId', authenticateAdmin, authorize(...staffRoles), extra.updateCheckIn);
router.put('/caregivers/:caregiverId', authenticateAdmin, authorize(...staffRoles), extra.updateCaregiver);
router.delete('/check-ins/:checkInId', authenticateAdmin, authorize(...staffRoles), ctrl.removeAssignment);

// ─── Ayuxa Connect: family account & patient management ──────────────
router.get('/family-accounts', authenticateAdmin, authorize(...staffRoles), extra.listFamilyAccounts);
router.put('/family-accounts/:accountId', authenticateAdmin, authorize(...staffRoles), extra.updateFamilyAccount);
router.get('/family-accounts/:accountId', authenticateAdmin, authorize(...staffRoles), ctrl.getFamilyAccountDetail);
router.get('/patients', authenticateAdmin, authorize(...staffRoles), ctrl.listPatients);
router.get('/patients/:patientUserId', authenticateAdmin, authorize(...staffRoles), extra.getPatientDetail);
router.post('/patients/:patientUserId/care-team', authenticateAdmin, authorize(...staffRoles), ctrl.addCareTeamMember);
router.delete('/care-team/:memberId', authenticateAdmin, authorize(...staffRoles), ctrl.removeCareTeamMember);

// ─── Staff management (SUPER_ADMIN only) ──────────────
router.get('/staff', authenticateAdmin, authorize('SUPER_ADMIN'), ctrl.listStaff);
router.put('/staff/:id/status', authenticateAdmin, authorize('SUPER_ADMIN'), ctrl.setStaffActive);
router.post('/staff/verify-email/request-otp', authenticateAdmin, authorize('SUPER_ADMIN'), extra.requestStaffEmailOtp);
router.put('/staff/:id', authenticateAdmin, authorize('SUPER_ADMIN'), extra.updateStaff);
router.delete('/staff/:id', authenticateAdmin, authorize('SUPER_ADMIN'), extra.deleteStaff);

// ─── The signed-in admin's own profile ──────────────
router.get('/me', authenticateAdmin, extra.getOwnProfile);
router.put('/me', authenticateAdmin, extra.updateOwnProfile);
router.put('/me/password', authenticateAdmin, extra.changeOwnPassword);

module.exports = router;
