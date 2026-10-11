import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a 32-byte key from the configured secret.
 */
function getEncryptionKey() {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CONNECTOR_ENCRYPTION_KEY is required in production environment.');
    }
    // Safe deterministic development/test fallback key
    return crypto.createHash('sha256').update('alertflow-dev-connector-key-2026').digest();
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns formatted string: `${iv_hex}:${auth_tag_hex}:${ciphertext_hex}`
 */
export function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  if (plaintext === '') return '';
  if (typeof plaintext !== 'string') {
    throw new TypeError('Plaintext to encrypt must be a string');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${ivHex}:${authTag}:${ciphertext}`;
}

/**
 * Decrypts a formatted ciphertext string using AES-256-GCM.
 */
export function decryptToken(encryptedString) {
  if (encryptedString === null || encryptedString === undefined) return null;
  if (encryptedString === '') return '';
  if (typeof encryptedString !== 'string') {
    throw new TypeError('Encrypted data must be a string');
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
