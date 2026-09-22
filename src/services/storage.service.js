// ──────────────────────────────────────────────
//  Storage Service
//  Provider-switchable like otp.service.js. STORAGE_PROVIDER=local
//  (default) writes to ./uploads and serves it back via /uploads static
//  route — good enough for dev. Set STORAGE_PROVIDER=gcs once Ayuxa has
//  its own Google Cloud Storage bucket (see medico's
//  backend/src/utils/storage.service.js for the signed-URL pattern this
//  should mirror when that's wired up).
// ──────────────────────────────────────────────

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const prisma = require('../config/database');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

function safeExt(originalName) {
    const ext = path.extname(originalName || '').toLowerCase();
    return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

async function uploadLocal(buffer, folder, originalName) {
    const dir = path.join(UPLOADS_DIR, folder);
    await fs.mkdir(dir, { recursive: true });

    const fileName = `${crypto.randomUUID()}${safeExt(originalName)}`;
    await fs.writeFile(path.join(dir, fileName), buffer);

    const baseUrl = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
    return `${baseUrl}/uploads/${folder}/${fileName}`;
}

/**
 * Uploads a file buffer and registers a MediaAsset row.
 * Returns the public-facing URL the client should store/display.
 */
const uploadFile = async (buffer, folder, originalName, mimeType, uploadedBy) => {
    const provider = process.env.STORAGE_PROVIDER || 'local';

    let fileUrl;
    if (provider === 'local') {
        fileUrl = await uploadLocal(buffer, folder, originalName);
    } else if (provider === 'gcs') {
        const gcs = require('./providers/gcs.service');
        fileUrl = await gcs.uploadFile(buffer, folder, originalName, mimeType);
    } else {
        throw new Error(`Unknown STORAGE_PROVIDER: ${provider}`);
    }

    await prisma.mediaAsset.create({
        data: {
            fileName: originalName || 'file',
            fileUrl,
            fileType: mimeType || 'application/octet-stream',
            fileSize: buffer.length,
            folder,
            uploadedBy,
        },
    });

    return fileUrl;
};

module.exports = { uploadFile };
