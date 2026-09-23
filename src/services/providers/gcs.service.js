// ──────────────────────────────────────────────
//  Google Cloud Storage provider — mirrors medico's
//  backend/src/utils/storage.service.js pattern: proxy upload via a
//  memory-buffered multer file, written straight to GCS (no local disk).
//  Reuses medico's ayuxa-assets bucket under Ayuxa-only path prefixes so
//  nothing collides with medico's own object paths.
// ──────────────────────────────────────────────

const path = require('path');
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');
const { logger } = require('../../config/logger');

const bucketName = process.env.GOOGLE_STORAGE_BUCKET_NAME;
const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;

let bucket = null;
try {
    if (bucketName && keyFilename) {
        const storage = new Storage({ keyFilename });
        bucket = storage.bucket(bucketName);
    } else {
        logger.warn('[GCS] GOOGLE_STORAGE_BUCKET_NAME or GOOGLE_APPLICATION_CREDENTIALS not set — GCS uploads will fail until configured.');
    }
} catch (err) {
    logger.error(`[GCS] Failed to initialize storage client: ${err.message}`);
}

function safeExt(originalName) {
    const ext = path.extname(originalName || '').toLowerCase();
    return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

const CDN_URL = process.env.ASSETS_CDN_URL;

function toPublicUrl(storagePath) {
    if (CDN_URL) return `${CDN_URL.replace(/\/$/, '')}/${storagePath}`;
    return `https://storage.googleapis.com/${bucketName}/${storagePath}`;
}

/**
 * Uploads a file buffer to GCS under ayuxa/<folder>/<uuid>.<ext> and
 * returns its public URL. Folder is caller-supplied (e.g. "caregiver-kyc",
 * "connect-uploads", "caregiver-selfies") and namespaced under "ayuxa/"
 * so it never collides with medico's own bucket paths.
 */
const uploadFile = async (buffer, folder, originalName, mimeType) => {
    if (!bucket) {
        throw new Error('GCS is not configured — set GOOGLE_STORAGE_BUCKET_NAME and GOOGLE_APPLICATION_CREDENTIALS');
    }

    const fileName = `${crypto.randomUUID()}${safeExt(originalName)}`;
    const storagePath = `ayuxa/${folder}/${fileName}`;
    const gcsFile = bucket.file(storagePath);
    const useResumable = buffer.length > 10 * 1024 * 1024;

    await gcsFile.save(buffer, {
        resumable: useResumable,
        contentType: mimeType || 'application/octet-stream',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });

    return toPublicUrl(storagePath);
};

module.exports = { uploadFile };
