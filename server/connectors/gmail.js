import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { encryptToken, decryptToken } from './encryption.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Least-privileged scopes: send emails + verify authenticated email identity
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Resolves the OAuth callback URL for Google.
 */
export function getGoogleRedirectUri(overrideUri) {
  if (overrideUri) return overrideUri;
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI.trim();
  const frontendUrl = process.env.FRONTEND_URL || 'https://alertflow-two.vercel.app';
  return `${frontendUrl}/api/connectors/gmail/callback`;
}

/**
 * Generates an OAuth 2.0 authorization URL for connecting Gmail.
 * Stores single-use state in database for CSRF protection.
 */
export function generateAuthUrl(db, userId, organizationId, options = {}) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is not configured.');
  }

  const redirectUri = getGoogleRedirectUri(options.redirectUri);
  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  // Store single-use state in database
  db.prepare(`
    INSERT INTO oauth_states (state, provider, user_id, organization_id, redirect_url, expires_at)
    VALUES (?, 'gmail', ?, ?, ?, ?)
  `).run(state, userId, organizationId, redirectUri, expiresAt);
  db.save();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline', // Required to receive refresh_token
    prompt: 'consent',     // Force consent to ensure refresh_token is returned
    state,
  });

  return {
    authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state,
    redirectUri,
  };
}

/**
 * Handles Google OAuth callback: validates state, exchanges code for tokens,
 * retrieves Google account identity, encrypts tokens, and saves connector.
 */
export async function handleOAuthCallback(db, { code, state, error, redirectUri: reqRedirectUri }) {
  try {
    if (error) {
      return { success: false, error: `Google OAuth error: ${error}` };
    }
    if (!code || !state) {
      return { success: false, error: 'Missing code or state in OAuth callback' };
    }

    // 1. Validate state parameter
    const stateRow = db.prepare(`
      SELECT * FROM oauth_states WHERE state = ? AND provider = 'gmail'
    `).get(state);

    if (!stateRow) {
      return { success: false, error: 'Invalid or expired OAuth state parameter (CSRF check failed).' };
    }

    if (new Date(stateRow.expires_at) < new Date()) {
      db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
      db.save();
      return { success: false, error: 'OAuth state has expired. Please try connecting again.' };
    }

    // Consume state immediately to enforce single-use
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    db.save();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are missing.');
  }

  const redirectUri = reqRedirectUri || stateRow.redirect_url || getGoogleRedirectUri();

  // 2. Exchange authorization code for tokens
  const tokenParams = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  let tokens;
  try {
    tokens = await tokenRes.json();
  } catch {
    const raw = await tokenRes.text().catch(() => '');
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${raw}`);
  }

  if (!tokenRes.ok || tokens.error) {
    const errMsg = tokens.error_description || tokens.error || 'Token exchange failed';
    throw new Error(`Google token exchange failed: ${errMsg}`);
  }

  // 3. Retrieve verified user identity from Google UserInfo endpoint
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let userInfo;
  try {
    userInfo = await userRes.json();
  } catch {
    throw new Error(`Failed to retrieve verified Google profile for connected account (${userRes.status})`);
  }

  if (!userRes.ok || !userInfo.email) {
    throw new Error('Failed to retrieve verified Google profile for connected account.');
  }

  const accountEmail = userInfo.email.toLowerCase().trim();
  const accountId = userInfo.id || userInfo.sub || null;
  const now = new Date().toISOString();
  const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  // 4. Encrypt sensitive credentials at rest using AES-256-GCM
  const encryptedAccessToken = encryptToken(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;

  // 5. Upsert connector in database
  const existing = db.prepare(`
    SELECT * FROM connectors WHERE organization_id = ? AND provider = 'gmail' AND account_email = ?
  `).get(stateRow.organization_id, accountEmail);

  let connectorId;

  if (existing) {
    connectorId = existing.id;
    // Retain existing refresh token if Google did not supply a new one
    const finalRefreshToken = encryptedRefreshToken || existing.encrypted_refresh_token;

    db.prepare(`
      UPDATE connectors
      SET account_id = ?,
          encrypted_access_token = ?,
          encrypted_refresh_token = ?,
          token_expires_at = ?,
          scope = ?,
          status = 'connected',
          last_error = NULL,
          metadata = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      accountId,
      encryptedAccessToken,
      finalRefreshToken,
      tokenExpiresAt,
      tokens.scope || '',
      JSON.stringify({ name: userInfo.name, picture: userInfo.picture }),
      now,
      connectorId
    );
  } else {
    connectorId = `conn-gmail-${uuidv4().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO connectors (
        id, organization_id, provider, name, account_id, account_email,
        encrypted_access_token, encrypted_refresh_token, token_expires_at,
        scope, status, metadata, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, 'gmail', ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)
    `).run(
      connectorId,
      stateRow.organization_id,
      `Gmail (${accountEmail})`,
      accountId,
      accountEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      tokens.scope || '',
      JSON.stringify({ name: userInfo.name, picture: userInfo.picture }),
      stateRow.user_id,
      now,
      now
    );
  }

  // 6. Sync with destinations table for incident notification routing
  const existingDest = db.prepare(`
    SELECT * FROM destinations WHERE organization_id = ? AND type = 'gmail'
  `).get(stateRow.organization_id);

  const destConfig = JSON.stringify({
    email: accountEmail,
    connector_id: connectorId,
    service: 'gmail_oauth',
  });

  if (existingDest) {
    db.prepare(`
      UPDATE destinations
      SET name = ?, status = 'connected', enabled = 1, configuration = ?
      WHERE id = ?
    `).run(`Gmail (${accountEmail})`, destConfig, existingDest.id);
  } else {
    const destId = `dest-gmail-${uuidv4().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO destinations (id, organization_id, type, name, status, enabled, configuration, created_at)
      VALUES (?, ?, 'gmail', ?, 'connected', 1, ?, ?)
    `).run(destId, stateRow.organization_id, `Gmail (${accountEmail})`, destConfig, now);
  }

  db.save();

  return {
    success: true,
    connectorId,
    email: accountEmail,
    name: userInfo.name,
    organizationId: stateRow.organization_id,
  };
} catch (err) {
  return {
    success: false,
    error: err.message,
  };
}
}

/**
 * Returns a valid, non-expired access token for the given Gmail connector,
 * automatically refreshing via Google OAuth when needed.
 */
export async function getValidAccessToken(db, connectorOrId) {
  let connector = connectorOrId;
  if (typeof connectorOrId === 'string') {
    connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorOrId);
  }

  if (!connector || connector.provider !== 'gmail') {
    throw new Error('Gmail connector not found');
  }

  const isExpired = !connector.token_expires_at ||
    new Date(connector.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000; // 5 min safety buffer

  // If token is still fresh, decrypt and return it
  if (!isExpired && connector.encrypted_access_token) {
    return decryptToken(connector.encrypted_access_token);
  }

  // Token is expired: use refresh_token
  if (!connector.encrypted_refresh_token) {
    db.prepare(`UPDATE connectors SET status = 'expired', last_error = ? WHERE id = ?`)
      .run('No refresh token available. Reconnection required.', connector.id);
    db.save();
    throw new Error('Gmail authorization expired. Please reconnect your Gmail account.');
  }

  const refreshToken = decryptToken(connector.encrypted_refresh_token);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth configuration missing for token refresh.');
  }

  const refreshParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshParams.toString(),
  });

  const refreshData = await refreshRes.json();

  if (!refreshRes.ok || refreshData.error) {
    const errorMsg = refreshData.error_description || refreshData.error || 'Token refresh failed';
    db.prepare(`UPDATE connectors SET status = 'expired', last_error = ? WHERE id = ?`)
      .run(errorMsg, connector.id);
    db.save();
    throw new Error(`Gmail authorization refresh failed: ${errorMsg}. Reconnection required.`);
  }

  const newAccessToken = refreshData.access_token;
  const newEncryptedAccessToken = encryptToken(newAccessToken);
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();
  const now = new Date().toISOString();

  // If Google rotated the refresh token, store the new one
  let newEncryptedRefreshToken = connector.encrypted_refresh_token;
  if (refreshData.refresh_token) {
    newEncryptedRefreshToken = encryptToken(refreshData.refresh_token);
  }

  db.prepare(`
    UPDATE connectors
    SET encrypted_access_token = ?,
        encrypted_refresh_token = ?,
        token_expires_at = ?,
        status = 'connected',
        last_error = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(newEncryptedAccessToken, newEncryptedRefreshToken, newExpiresAt, now, connector.id);
  db.save();

  return newAccessToken;
}

/**
 * Builds an RFC 2822 formatted email message and encodes it as base64url.
 */
export function buildRfc2822RawEmail({ from, to, subject, htmlText, plainText, messageId }) {
  const boundary = `----=_Part_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const cleanMessageId = messageId || `<${uuidv4()}@alertflow.io>`;
  const date = new Date().toUTCString();

  // UTF-8 encode header values safely if non-ASCII
  const hasNonAscii = /[^\x00-\x7F]/.test(subject || '');
  const encodedSubject = hasNonAscii
    ? `=?utf-8?B?${Buffer.from(subject || '').toString('base64')}?=`
    : (subject || '');

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `Message-ID: ${cleanMessageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    plainText || (htmlText ? htmlText.replace(/<[^>]+>/g, ' ') : ''),
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    htmlText || `<p>${plainText || ''}</p>`,
    '',
    `--${boundary}--`,
  ];

  const fullEmail = lines.join('\r\n');
  return Buffer.from(fullEmail).toString('base64url');
}

/**
 * Sends an email directly through the Gmail API using the authorized account.
 */
export async function sendGmailMessage(db, connectorOrId, { to, subject, htmlText, plainText, messageId }) {
  let connector = connectorOrId;
  if (typeof connectorOrId === 'string') {
    connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorOrId);
  }

  if (!connector) {
    return { success: false, error: 'Gmail connector not configured or connected.' };
  }

  const recipient = to || connector.account_email;
  if (!recipient) {
    return { success: false, error: 'No recipient email specified.' };
  }

  try {
    const accessToken = await getValidAccessToken(db, connector);
    const raw = buildRfc2822RawEmail({
      from: `AlertFlow <${connector.account_email}>`,
      to: recipient,
      subject,
      htmlText,
      plainText,
      messageId,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const result = await response.json();

    if (!response.ok || result.error) {
      const errMsg = result.error?.message || result.error || `Gmail API HTTP ${response.status}`;
      return { success: false, error: errMsg };
    }

    return { success: true, messageId: result.id, threadId: result.threadId };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Gmail API request timed out' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Disconnects a Gmail account, revoking tokens with Google and updating DB.
 */
export async function disconnectGmail(db, organizationId, connectorId) {
  const query = connectorId
    ? db.prepare('SELECT * FROM connectors WHERE id = ? AND organization_id = ? AND provider = ?')
    : db.prepare('SELECT * FROM connectors WHERE organization_id = ? AND provider = ? LIMIT 1');

  const connector = connectorId
    ? query.get(connectorId, organizationId, 'gmail')
    : query.get(organizationId, 'gmail');

  if (!connector) {
    return { success: true, message: 'No connected Gmail account found' };
  }

  // Attempt Google token revocation asynchronously (best-effort)
  if (connector.encrypted_access_token) {
    try {
      const token = decryptToken(connector.encrypted_access_token);
      fetch(`${GOOGLE_REVOKE_URL}?token=${token}`, { method: 'POST' }).catch(() => {});
    } catch {}
  }

  // Mark connector as disconnected
  db.prepare(`
    UPDATE connectors
    SET status = 'disconnected',
        encrypted_access_token = NULL,
        encrypted_refresh_token = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), connector.id);

  // Update corresponding destination status
  db.prepare(`
    UPDATE destinations
    SET status = 'disconnected', enabled = 0
    WHERE organization_id = ? AND type = 'gmail'
  `).run(organizationId);

  db.save();
  return { success: true };
}

/**
 * Returns safe Gmail connector status (NEVER exposing credentials or tokens).
 */
export function getGmailStatus(db, organizationId) {
  const connector = db.prepare(`
    SELECT id, organization_id, provider, name, account_email, status, last_error, created_at, updated_at
    FROM connectors
    WHERE organization_id = ? AND provider = 'gmail' AND status != 'disconnected'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(organizationId);

  if (!connector) {
    return {
      connected: false,
      status: 'disconnected',
      email: null,
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    };
  }

  return {
    connected: connector.status === 'connected',
    status: connector.status,
    email: connector.account_email,
    id: connector.id,
    lastError: connector.last_error,
    updatedAt: connector.updated_at,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}
