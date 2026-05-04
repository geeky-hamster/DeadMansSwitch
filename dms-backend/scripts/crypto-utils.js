// crypto-utils.js
// Shared encryption helpers used by encrypt-upload and reader view.
// Uses only Node.js built-in 'crypto' — no extra dependencies.
//
// IMPORTANT: Uses PBKDF2 for key derivation to stay compatible with
// the browser's WebCrypto API (which doesn't support scrypt).

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM  = 'aes-256-gcm';
const KEY_LEN    = 32;   // 256 bits
const IV_LEN     = 12;   // 96 bits — GCM standard
const SALT_LEN   = 16;
const TAG_LEN    = 16;

// PBKDF2 params — must match frontend crypto.js exactly
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST     = 'sha256';

/**
 * Derives a 256-bit key from a password using PBKDF2.
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Buffer} 32-byte derived key
 */
export function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST);
}

/**
 * Encrypts arbitrary data with AES-256-GCM.
 * Returns a single Buffer: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
 * @param {Buffer} data
 * @param {string} password
 * @returns {Buffer}
 */
export function encryptBuffer(data, password) {
  const salt   = randomBytes(SALT_LEN);
  const iv     = randomBytes(IV_LEN);
  const key    = deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // Layout: salt | iv | tag | ciphertext
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypts a Buffer produced by encryptBuffer().
 * @param {Buffer} blob  The full encrypted blob (salt + iv + tag + ciphertext)
 * @param {string} password
 * @returns {Buffer} Decrypted plaintext
 */
export function decryptBuffer(blob, password) {
  const salt       = blob.subarray(0, SALT_LEN);
  const iv         = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag        = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const key      = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Generates a random AES-256 key (32 bytes).
 * @returns {Buffer}
 */
export function generateAESKey() {
  return randomBytes(KEY_LEN);
}

/**
 * Encrypts file data with a fresh random AES-256-GCM key.
 * Returns both the ciphertext blob and the raw key (to be stored separately).
 * Blob layout: [iv(12)] + [tag(16)] + [ciphertext]
 *
 * @param {Buffer} fileData
 * @returns {{ cipherBlob: Buffer, aesKey: Buffer }}
 */
export function encryptFile(fileData) {
  const aesKey = generateAESKey();
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, aesKey, iv);

  const ciphertext = Buffer.concat([cipher.update(fileData), cipher.final()]);
  const tag        = cipher.getAuthTag();

  // Blob: iv | tag | ciphertext
  const cipherBlob = Buffer.concat([iv, tag, ciphertext]);

  return { cipherBlob, aesKey };
}

/**
 * Decrypts a file blob produced by encryptFile().
 * @param {Buffer} blob   The [iv + tag + ciphertext] blob from IPFS
 * @param {Buffer} aesKey The 32-byte AES key
 * @returns {Buffer} Decrypted file content
 */
export function decryptFile(blob, aesKey) {
  const iv         = blob.subarray(0, IV_LEN);
  const tag        = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGORITHM, aesKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
