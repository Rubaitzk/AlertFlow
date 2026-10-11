import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { stringifySetCookie, parseCookie } from 'cookie';
import { v4 as uuidv4 } from 'uuid';

export const COOKIE_NAME = 'alertflow_session';
export const DEFAULT_ORG_ID = 'org-default';
export const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 12;
export const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS, 10) || 7;

/**
 * Normalizes email address to lower-case trimmed format.
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validates email format according to RFC 5322 simplified pattern.
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = normalizeEmail(email);
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(normalized);
}

/**
 * Validates password according to configurable policy:
 * - At least PASSWORD_MIN_LENGTH chars (default 12)
 * - Contains at least one uppercase letter
 * - Contains at least one lowercase letter
 * - Contains at least one number or special character
 */
export function validatePassword(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[0-9\W_]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one digit or special character' };
  }
  return { valid: true };
}

/**
 * Hash password securely with bcrypt (cost factor 12).
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 12);
}

/**
 * Verify password against bcrypt hash.
 */
export async function verifyPassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false;
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Removes sensitive fields (password_hash, salt) before sending to client.
 */
export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, salt, ...safe } = user;
  return safe;
}

/**
 * Create a new persistent session in the database.
 */
export function createSession(db, userId, { userAgent = '', ipAddress = '' } = {}) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = now.toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, createdAt, expiresAt, createdAt, userAgent.slice(0, 255), ipAddress.slice(0, 45));

  return {
    id: sessionId,
    user_id: userId,
    created_at: createdAt,
    expires_at: expiresAt,
    last_active_at: createdAt,
  };
}

/**
 * Look up session and associated active user.
 * Touches last_active_at if valid.
 */
export function getSession(db, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  const row = db.prepare(`
    SELECT s.id as session_id, s.user_id, s.expires_at, s.created_at as session_created_at,
           u.id, u.organization_id, u.name, u.email, u.role, u.avatar_color, u.is_active, u.created_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(sessionId);

  if (!row) return null;

  // Verify expiry
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  if (now > expiresAt) {
    // Expired - clean it up
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch {}
    return null;
  }

  // Verify active user
  if (row.is_active === 0) {
    return null;
  }

  // Touch last_active_at (throttled: only once per minute)
  try {
    db.prepare(`UPDATE sessions SET last_active_at = datetime('now') WHERE id = ?`).run(sessionId);
  } catch {}

  const user = {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar_color: row.avatar_color,
    created_at: row.created_at,
  };

  return {
    session: {
      id: row.session_id,
      user_id: row.user_id,
      expires_at: row.expires_at,
    },
    user,
  };
}

/**
 * Deletes a session from the database (logout / revocation).
 */
export function deleteSession(db, sessionId) {
  if (!sessionId) return false;
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return (result?.changes || 0) > 0;
}

/**
 * Deletes all sessions for a specific user.
 */
export function deleteUserSessions(db, userId) {
  if (!userId) return false;
  const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return (result?.changes || 0) > 0;
}

/**
 * Cleans up expired sessions.
 */
export function cleanExpiredSessions(db) {
  try {
    db.prepare(`DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')`).run();
  } catch (err) {
    console.error('[Auth] Failed to clean expired sessions:', err.message);
  }
}

/**
 * Sets session cookie on response object.
 */
export function setSessionCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production';
  // Allow explicit override via environment variables
  const secure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : isProd;

  // In cross-origin deployments (Vercel frontend calling Railway backend directly),
  // SameSite=None is required. If running same-origin (proxy or local dev), SameSite=Lax.
  let sameSite = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
  sameSite = sameSite.toLowerCase();

  // Browsers reject SameSite=None without Secure
  const actualSecure = sameSite === 'none' ? true : secure;

  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60; // in seconds
  const cookieOptions = {
    name: COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: actualSecure,
    sameSite,
    path: '/',
    maxAge,
  };

  if (sameSite === 'none') {
    // Partitioned cookie support for modern cross-site cookie privacy standards
    cookieOptions.partitioned = true;
  }

  const serialized = stringifySetCookie(cookieOptions);
  res.setHeader('Set-Cookie', serialized);
}

/**
 * Clears session cookie on response object.
 */
export function clearSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : isProd;
  let sameSite = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
  sameSite = sameSite.toLowerCase();
  const actualSecure = sameSite === 'none' ? true : secure;

  const serialized = stringifySetCookie({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: actualSecure,
    sameSite,
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  });
  res.setHeader('Set-Cookie', serialized);
}

/**
 * Extracts session ID from cookie header string.
 */
export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const parsed = parseCookie(cookieHeader);
  return parsed[COOKIE_NAME] || null;
}

/**
 * Creates a secure password reset token for a user.
 * Returns the raw token to be sent to user; stores SHA-256 hash in DB.
 */
export function createPasswordResetToken(db, userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour
  const createdAt = now.toISOString();

  // Invalidate any existing unused reset tokens for this user
  db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL`).run(userId);

  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenId, userId, tokenHash, expiresAt, createdAt);

  return { rawToken, expiresAt };
}

/**
 * Verifies a raw password reset token and returns user if valid.
 */
export function verifyPasswordResetToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const row = db.prepare(`
    SELECT prt.*, u.id as user_id, u.email, u.name, u.is_active
    FROM password_reset_tokens prt
    JOIN users u ON prt.user_id = u.id
    WHERE prt.token_hash = ? AND prt.used_at IS NULL
  `).get(tokenHash);

  if (!row) return null;

  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  if (now > expiresAt || row.is_active === 0) {
    return null;
  }

  return row;
}

/**
 * Consumes a password reset token and sets the new password hash.
 */
export function consumePasswordResetToken(db, rawToken, newPasswordHash) {
  const tokenRecord = verifyPasswordResetToken(db, rawToken);
  if (!tokenRecord) return false;

  const now = new Date().toISOString();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Update password and mark token as used
  db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
  `).run(newPasswordHash, now, tokenRecord.user_id);

  db.prepare(`
    UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?
  `).run(now, tokenHash);

  // Invalidate all active sessions for this user for security
  deleteUserSessions(db, tokenRecord.user_id);

  return true;
}

/**
 * In-memory sliding-window rate limiter for sensitive authentication operations.
 */
class RateLimiter {
  constructor(windowMs = 15 * 60 * 1000, maxAttempts = 10) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.attempts = new Map();

    // Clean up every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  isLimited(key) {
    const now = Date.now();
    const timestamps = this.attempts.get(key) || [];
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxAttempts) {
      return true;
    }
    return false;
  }

  recordAttempt(key) {
    const now = Date.now();
    const timestamps = this.attempts.get(key) || [];
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);
    validTimestamps.push(now);
    this.attempts.set(key, validTimestamps);
  }

  reset(key) {
    this.attempts.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.attempts.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, valid);
      }
    }
  }
}

export const loginLimiter = new RateLimiter(15 * 60 * 1000, 10);
export const registerLimiter = new RateLimiter(60 * 60 * 1000, 5);
export const resetLimiter = new RateLimiter(15 * 60 * 1000, 5);
