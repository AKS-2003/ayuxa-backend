// ──────────────────────────────────────────────
//  Multer File Upload Middleware
// ──────────────────────────────────────────────

const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

const fileFilter = (req, file, cb) => {
    // Flutter web's http.MultipartFile.fromBytes doesn't set a real
    // content-type, so browser-picked files often arrive as the generic
    // application/octet-stream — fall back to the file extension in that
    // case rather than rejecting every web upload outright.
    const isAllowedMimeType = allowedTypes.includes(file.mimetype);
    const isAllowedExtension = allowedExtensions.includes(path.extname(file.originalname).toLowerCase());

    if (isAllowedMimeType || (file.mimetype === 'application/octet-stream' && isAllowedExtension)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = upload;
