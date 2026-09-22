const { uploadFile } = require('../services/storage.service');

/** POST /api/media/upload (multipart, field name "file") */
const upload = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        const folder = req.body.folder || 'general';
        const uploadedBy = req.user ? `${req.user.type}:${req.user.id}` : 'anonymous';

        const fileUrl = await uploadFile(req.file.buffer, folder, req.file.originalname, req.file.mimetype, uploadedBy);

        res.status(201).json({ success: true, data: { fileUrl, fileName: req.file.originalname } });
    } catch (error) {
        next(error);
    }
};

module.exports = { upload };
