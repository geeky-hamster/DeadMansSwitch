// crypto.js — Browser-native WebCrypto API utilities
// Mirrors the logic in the backend crypto-utils.js but uses SubtleCrypto.
//
// CRITICAL: Both backend and frontend use:
//   - PBKDF2 with 100000 iterations + SHA-256 for password-based key derivation
//   - AES-256-GCM for encryption
//   - Blob layout for encryptBuffer: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
//   - Blob layout for encryptFile:   [iv(12)] + [tag(16)] + [ciphertext]

const SALT_LEN = 16;
const IV_LEN   = 12;
const TAG_LEN  = 16; // GCM auth tag

/**
 * Derives an AES-256 key from a password using PBKDF2.
 * Must match backend: 100000 iterations, SHA-256.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypts a blob produced by the Node.js encryptBuffer() function.
 * Blob layout: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
 * Note: WebCrypto's AES-GCM expects [ciphertext + tag] together.
 *
 * @param {ArrayBuffer} blob
 * @param {string} password
 * @returns {Promise<ArrayBuffer>} decrypted data
 */
export async function decryptBlob(blob, password) {
  const buf  = new Uint8Array(blob);
  const salt = buf.slice(0, SALT_LEN);
  const iv   = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ct   = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);

  // WebCrypto expects ciphertext + tag concatenated
  const ctWithTag = new Uint8Array(ct.length + TAG_LEN);
  ctWithTag.set(ct, 0);
  ctWithTag.set(tag, ct.length);

  const key = await deriveKey(password, salt);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctWithTag);
}

/**
 * Encrypts a raw buffer using PBKDF2 derived key.
 * Output layout: [salt(16)] + [iv(12)] + [tag(16)] + [ciphertext]
 * This matches the Node.js encryptBuffer() format exactly.
 */
export async function encryptBlob(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  
  // WebCrypto produces [ciphertext + tag] as one blob
  const ctWithTagBuf = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  );
  
  // Split into ciphertext and tag to match Node.js layout: [salt][iv][tag][ct]
  const ct  = ctWithTagBuf.slice(0, ctWithTagBuf.length - TAG_LEN);
  const tag = ctWithTagBuf.slice(ctWithTagBuf.length - TAG_LEN);
  
  const buf = new Uint8Array(SALT_LEN + IV_LEN + TAG_LEN + ct.length);
  buf.set(salt, 0);
  buf.set(iv, SALT_LEN);
  buf.set(tag, SALT_LEN + IV_LEN);
  buf.set(ct, SALT_LEN + IV_LEN + TAG_LEN);
  
  return buf;
}

/**
 * Decrypts a file blob produced by the Node.js encryptFile() function.
 * Blob layout: [iv(12)] + [tag(16)] + [ciphertext]
 * WebCrypto needs [ciphertext + tag], so we rearrange.
 *
 * @param {ArrayBuffer} blob
 * @param {string} aesKeyHex  32-byte AES key as hex string
 * @returns {Promise<ArrayBuffer>} decrypted file bytes
 */
export async function decryptFile(blob, aesKeyHex) {
  const keyBytes = hexToBytes(aesKeyHex);
  const buf      = new Uint8Array(blob);
  const iv       = buf.slice(0, IV_LEN);
  const tag      = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const ct       = buf.slice(IV_LEN + TAG_LEN);

  // WebCrypto expects ciphertext + tag concatenated
  const ctWithTag = new Uint8Array(ct.length + TAG_LEN);
  ctWithTag.set(ct, 0);
  ctWithTag.set(tag, ct.length);

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );

  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctWithTag);
}

/**
 * Encrypts a file using a random AES key.
 * Output layout: [iv(12)] + [tag(16)] + [ciphertext]
 * This matches the Node.js encryptFile() format exactly.
 */
export async function encryptFile(fileBlob) {
  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  
  const key = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-GCM' }, false, ['encrypt']);
  
  // WebCrypto produces [ciphertext + tag] as one blob
  const ctWithTagBuf = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, fileBlob)
  );
  
  // Split into ciphertext and tag to match Node.js layout: [iv][tag][ct]
  const ct  = ctWithTagBuf.slice(0, ctWithTagBuf.length - TAG_LEN);
  const tag = ctWithTagBuf.slice(ctWithTagBuf.length - TAG_LEN);
  
  const cipherBlob = new Uint8Array(IV_LEN + TAG_LEN + ct.length);
  cipherBlob.set(iv, 0);
  cipherBlob.set(tag, IV_LEN);
  cipherBlob.set(ct, IV_LEN + TAG_LEN);
  
  return { cipherBlob, aesKey };
}

/** Converts a hex string (with or without 0x) to Uint8Array */
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Converts Uint8Array to hex string */
export function bytesToHex(bytes) {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Converts ArrayBuffer to UTF-8 string */
export function bufferToString(buf) {
  return new TextDecoder().decode(buf);
}
