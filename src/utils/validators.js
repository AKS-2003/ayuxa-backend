// Shared input validators for identity fields. Mirrors the checks in the
// Ayuxa Buddy app (lib/utils/validators.dart) so the API never trusts the client.

const D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** 12 digits, not starting with 0/1, passing the Verhoeff checksum. */
function isValidAadhaar(value) {
    const digits = String(value || '').replace(/\s/g, '');
    if (!/^[2-9][0-9]{11}$/.test(digits)) return false;
    let c = 0;
    digits.split('').reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
    return c === 0;
}

const isValidPan = (value) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(value || '').trim().toUpperCase());

/** Letters (any script), spaces, dots, apostrophes, hyphens; 2-60 chars. */
const isValidName = (value) => /^[\p{L}][\p{L}\p{M} .'-]{1,59}$/u.test(String(value || '').trim());

/** Last 10 digits of an Indian mobile number; null when it isn't a valid 6-9 starting number. */
function normalizeIndianMobile(value) {
    const last10 = String(value || '').replace(/\D/g, '').slice(-10);
    return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

/**
 * True for obviously fake numbers: one repeated digit (9999999999), simple
 * ascending/descending runs (1234567890, 9876543210) and short repeating
 * patterns (9898989898).
 */
function isDummyMobile(value) {
    const d = String(value || '').replace(/\D/g, '').slice(-10);
    if (d.length !== 10) return false;
    if (/^(\d)\1{9}$/.test(d)) return true;
    if ('01234567890123456789'.includes(d) || '98765432109876543210'.includes(d)) return true;
    return /^(\d{2})\1{4}$/.test(d) || /^(\d{3})\1{2}\d$/.test(d) || /^(\d{5})\1$/.test(d);
}

/** A real Indian mobile: +91 optional, 10 digits starting 6-9, not an obvious dummy. */
const isRealIndianMobile = (value) => !!normalizeIndianMobile(value) && !isDummyMobile(value);

const isValidEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim());

module.exports = { isValidAadhaar, isValidPan, isValidName, normalizeIndianMobile, isValidEmail, isDummyMobile, isRealIndianMobile };
