// ──────────────────────────────────────────────
//  Buddy Controller — Ayuxa Buddy (caregiver app)
//  Identity lives in medico's `caregivers` table (req.caregiver);
//  everything Buddy-specific lives in caregiver_profiles and its
//  related tables (req.caregiverProfile).
// ──────────────────────────────────────────────

const prisma = require('../config/database');
const medicoRepo = require('../services/medico.repository');
const { generateEmployeeId } = require('../utils/helpers');

/** Strips the session refresh token (and FCM device token) before exposing a CaregiverProfile to its own client. */
function sanitizeProfile(profile) {
    if (!profile) return profile;
    const { refreshToken, fcmDeviceToken, ...safe } = profile;
    return safe;
}

/** GET /api/buddy/me */
const getMe = async (req, res, next) => {
    try {
        const [profile, bookings] = await Promise.all([
            prisma.caregiverProfile.findUnique({
                where: { id: req.caregiverProfile.id },
                include: {
                    checkIns: { include: { tasks: true }, orderBy: { shiftStart: 'desc' } },
                    uploads: { orderBy: { uploadedAt: 'desc' } },
                    notifications: { orderBy: { createdAt: 'desc' } },
                },
            }),
            medicoRepo.listBookingsForCaregiver(req.caregiver.id),
        ]);

        res.json({ success: true, data: { caregiver: req.caregiver, profile: sanitizeProfile(profile), bookings } });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/buddy/me — registration_screen.dart's "Save & Continue" submits
 * the full profile here in one call: identity fields (name/email) are
 * written to medico's caregivers row, everything else to caregiver_profiles.
 */
const updateMe = async (req, res, next) => {
    try {
        const {
            name, email,
            gender, dob, photoUrl,
            presentAddress, permanentAddress, emergencyNumber,
            aadhaarNumber, panNumber,
            aadhaarUploaded, panUploaded, otherDocsUploaded,
            aadhaarDocUrl, panDocUrl, otherDocsUrl,
            preferredLanguage, jobRole,
        } = req.body;

        if (name !== undefined || email !== undefined) {
            await medicoRepo.updateCaregiverProfile(req.caregiver.id, { name, email });
        }

        const profile = await prisma.caregiverProfile.update({
            where: { id: req.caregiverProfile.id },
            data: {
                ...(gender !== undefined && { gender }),
                ...(dob !== undefined && { dob: dob ? new Date(dob) : null }),
                ...(photoUrl !== undefined && { photoUrl }),
                ...(presentAddress !== undefined && { presentAddress }),
                ...(permanentAddress !== undefined && { permanentAddress }),
                ...(emergencyNumber !== undefined && { emergencyNumber }),
                ...(aadhaarNumber !== undefined && { aadhaarNumber }),
                ...(panNumber !== undefined && { panNumber }),
                ...(aadhaarUploaded !== undefined && { aadhaarUploaded }),
                ...(panUploaded !== undefined && { panUploaded }),
                ...(otherDocsUploaded !== undefined && { otherDocsUploaded }),
                ...(aadhaarDocUrl !== undefined && { aadhaarDocUrl }),
                ...(panDocUrl !== undefined && { panDocUrl }),
                ...(otherDocsUrl !== undefined && { otherDocsUrl }),
                ...(preferredLanguage !== undefined && { preferredLanguage }),
                ...(jobRole !== undefined && { jobRole }),
            },
        });

        const caregiver = await medicoRepo.findCaregiverById(req.caregiver.id);
        res.json({ success: true, data: { caregiver, profile: sanitizeProfile(profile) } });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/kyc/submit */
const submitKyc = async (req, res, next) => {
    try {
        const profile = await prisma.caregiverProfile.update({
            where: { id: req.caregiverProfile.id },
            data: { kycStatus: 'PENDING_VERIFICATION' },
        });
        res.json({ success: true, data: sanitizeProfile(profile) });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/pcc */
const uploadPcc = async (req, res, next) => {
    try {
        const { pccDocUrl } = req.body;
        const profile = await prisma.caregiverProfile.update({
            where: { id: req.caregiverProfile.id },
            data: { pccUploaded: true, ...(pccDocUrl !== undefined && { pccDocUrl }) },
        });
        await prisma.caregiverNotification.create({
            data: {
                profileId: profile.id,
                title: 'PCC Received',
                body: 'Your Police Clearance Certificate has been submitted for review.',
                category: 'approval',
                channels: ['push', 'email'],
            },
        });
        res.json({ success: true, data: sanitizeProfile(profile) });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/agreement/accept */
const acceptAgreement = async (req, res, next) => {
    try {
        const profile = await prisma.caregiverProfile.update({
            where: { id: req.caregiverProfile.id },
            data: { agreementAccepted: true, offerLetterGenerated: true },
        });
        await prisma.caregiverNotification.create({
            data: {
                profileId: profile.id,
                title: 'Digital Offer Letter Ready',
                body: 'Your offer letter has been generated. Tap to view.',
                category: 'offerLetter',
                channels: ['email', 'sms'],
            },
        });
        res.json({ success: true, data: sanitizeProfile(profile) });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/check-ins — start tracking a shift (from a medico booking or ad hoc) */
const createCheckInRecord = async (req, res, next) => {
    try {
        const {
            bookingId, patientUserId, patientName, patientCode, address, mobile,
            caregiverRole, scopeOfWork, shiftStart, shiftEnd, tasks,
        } = req.body;

        const checkIn = await prisma.caregiverCheckIn.create({
            data: {
                profileId: req.caregiverProfile.id,
                bookingId, patientUserId, patientName, patientCode, address, mobile,
                caregiverRole, scopeOfWork,
                shiftStart: new Date(shiftStart),
                shiftEnd: new Date(shiftEnd),
                tasks: { create: (tasks || []).map((title) => ({ title })) },
            },
            include: { tasks: true },
        });

        res.status(201).json({ success: true, data: checkIn });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/check-ins/:id/check-in */
const checkIn = async (req, res, next) => {
    try {
        const { selfieUrl } = req.body;
        const record = await prisma.caregiverCheckIn.updateMany({
            where: { id: req.params.id, profileId: req.caregiverProfile.id },
            data: { checkedIn: true, checkInTime: new Date(), checkInSelfieUrl: selfieUrl, checkOutSelfieUrl: null },
        });
        if (record.count === 0) return res.status(404).json({ success: false, message: 'Check-in record not found' });

        const updated = await prisma.caregiverCheckIn.findUnique({ where: { id: req.params.id }, include: { tasks: true } });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/check-ins/:id/check-out */
const checkOut = async (req, res, next) => {
    try {
        const { selfieUrl, bp, pulse, temperature, careSummary, comments } = req.body;

        const existing = await prisma.caregiverCheckIn.findFirst({ where: { id: req.params.id, profileId: req.caregiverProfile.id } });
        if (!existing) return res.status(404).json({ success: false, message: 'Check-in record not found' });

        const updated = await prisma.caregiverCheckIn.update({
            where: { id: existing.id },
            data: {
                checkedIn: false,
                checkOutTime: new Date(),
                checkOutSelfieUrl: selfieUrl,
                vitalsBp: bp,
                vitalsPulse: pulse,
                vitalsTemp: temperature,
                careSummary,
                checkoutComments: comments,
            },
            include: { tasks: true },
        });

        if (updated.patientUserId) {
            await prisma.serviceVisit.create({
                data: {
                    patientUserId: updated.patientUserId,
                    providerType: updated.caregiverRole,
                    providerName: req.caregiver.name || 'Ayuxa Buddy',
                    visitDate: updated.checkInTime || new Date(),
                    checkOutTime: new Date(),
                    notes: careSummary,
                },
            });
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/buddy/me/check-ins/:checkInId/tasks/:taskId */
const toggleTask = async (req, res, next) => {
    try {
        const task = await prisma.checkInTask.findUnique({ where: { id: req.params.taskId }, include: { checkIn: true } });
        if (!task || task.checkIn.profileId !== req.caregiverProfile.id || task.checkInId !== req.params.checkInId) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }
        const updated = await prisma.checkInTask.update({ where: { id: task.id }, data: { done: !task.done } });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

/** POST /api/buddy/me/uploads */
const addUpload = async (req, res, next) => {
    try {
        const { fileName, fileUrl, category, patientCode, mobile, patientUserId } = req.body;
        const upload = await prisma.caregiverUpload.create({
            data: {
                profileId: req.caregiverProfile.id,
                patientUserId: patientUserId || null,
                fileName, fileUrl, category, patientCode, mobile,
                uploadedBy: req.caregiver.name || 'Ayuxa Buddy',
            },
        });
        res.status(201).json({ success: true, data: upload });
    } catch (error) {
        next(error);
    }
};

/** PUT /api/buddy/me/notifications/read-all */
const markAllNotificationsRead = async (req, res, next) => {
    try {
        await prisma.caregiverNotification.updateMany({
            where: { profileId: req.caregiverProfile.id, read: false },
            data: { read: true },
        });
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

// ─── Admin-facing ────────────────────────────

/** PUT /api/buddy/profiles/:caregiverId/kyc (admin) */
const setKycStatus = async (req, res, next) => {
    try {
        const { status } = req.body;
        const profile = await prisma.caregiverProfile.findUnique({ where: { caregiverId: req.params.caregiverId } });
        if (!profile) return res.status(404).json({ success: false, message: 'Caregiver profile not found' });

        const data = { kycStatus: status };
        if (status === 'ACCEPTED' && !profile.employeeId) data.employeeId = generateEmployeeId();

        const updated = await prisma.caregiverProfile.update({ where: { id: profile.id }, data });
        res.json({ success: true, data: sanitizeProfile(updated) });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMe, updateMe, submitKyc, uploadPcc, acceptAgreement,
    createCheckInRecord, checkIn, checkOut, toggleTask, addUpload, markAllNotificationsRead,
    setKycStatus,
};
