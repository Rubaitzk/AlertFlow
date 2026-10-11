import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, 'test_connectors.db');

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.CONNECTOR_ENCRYPTION_KEY = 'test-encryption-key-for-alertflow-unit-tests-32-bytes!';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

const { getDb, waitForDb } = await import('../server/db.js');
const { encryptToken, decryptToken } = await import('../server/connectors/encryption.js');
const {
  generateAuthUrl,
  handleOAuthCallback,
  getValidAccessToken,
  buildRfc2822RawEmail,
  sendGmailMessage,
  disconnectGmail,
  getGmailStatus
} = await import('../server/connectors/gmail.js');
const { sendDirectSlackMessage } = await import('../server/connectors/slack.js');
const { sendSlackNotification } = await import('../server/notifications/slack.js');
const { sendGmailNotification } = await import('../server/notifications/gmail.js');
const { dispatchNotifications } = await import('../server/notifications/dispatcher.js');

let db;

before(async () => {
  await waitForDb();
  db = getDb();
});

after(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
});

describe('AES-256-GCM Token Encryption', () => {
  test('encrypts and decrypts OAuth tokens reliably', () => {
    const rawToken = 'ya29.a0ARrdaM8-sample-google-oauth-access-token-xyz';
    const encrypted = encryptToken(rawToken);

    assert.notEqual(encrypted, rawToken);
    assert.match(encrypted, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:tag:ciphertext

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, rawToken);
  });

  test('generates unique ciphertexts and IVs for the same plaintext', () => {
    const rawToken = '1//04sample_refresh_token_abc';
    const enc1 = encryptToken(rawToken);
    const enc2 = encryptToken(rawToken);

    assert.notEqual(enc1, enc2);
    assert.equal(decryptToken(enc1), rawToken);
    assert.equal(decryptToken(enc2), rawToken);
  });

  test('throws on tampered ciphertext or auth tag', () => {
    const encrypted = encryptToken('secret-token');
    const parts = encrypted.split(':');
    // Tamper with the ciphertext byte
    const tamperedCipher = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    assert.throws(() => {
      decryptToken(tampered);
    });
  });

  test('gracefully handles null or empty input', () => {
    assert.equal(encryptToken(null), null);
    assert.equal(encryptToken(''), '');
    assert.equal(decryptToken(null), null);
    assert.equal(decryptToken(''), '');
  });
});

describe('Direct Slack Connector', () => {
  test('dispatches directly to Slack incoming webhook without Fastn loopback', async () => {
    let capturedUrl = null;
    let capturedBody = null;

    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => 'ok',
      };
    };

    try {
      const result = await sendDirectSlackMessage({
        webhookUrl: 'https://hooks.slack.com/services/T123/B456/XYZ789',
        channel: '#alerts',
        text: 'Production DB High Latency',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Alert*' } }],
      });

      assert.equal(result.success, true);
      assert.equal(capturedUrl, 'https://hooks.slack.com/services/T123/B456/XYZ789');
      assert.equal(capturedBody.text, 'Production DB High Latency');
      assert.equal(capturedBody.channel, '#alerts');
      assert.ok(Array.isArray(capturedBody.blocks));
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('dispatches directly with Slack Bot Token via chat.postMessage', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;
    let capturedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, ts: '1712839201.000100', channel: 'C12345' }),
      };
    };

    try {
      const result = await sendDirectSlackMessage({
        botToken: 'xoxb-12345-67890-testbottoken',
        channel: '#incidents',
        text: 'AlertFlow Direct Test Notification',
        blocks: [],
      });

      assert.equal(result.success, true);
      assert.equal(capturedUrl, 'https://slack.com/api/chat.postMessage');
      assert.equal(capturedHeaders['Authorization'], 'Bearer xoxb-12345-67890-testbottoken');
      assert.equal(capturedBody.channel, '#incidents');
      assert.equal(capturedBody.text, 'AlertFlow Direct Test Notification');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('sendSlackNotification branches directly for non-Fastn webhooks', async () => {
    let capturedUrl = null;
    let capturedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => 'ok',
      };
    };

    try {
      const config = { webhook_url: 'https://hooks.slack.com/services/T001/B002/XYZ' };
      const template = { subject: '🔥 Redis CPU Alert', service: 'Redis Cache' };
      const incident = { incident_number: 'INC-101', title: 'High CPU on Redis', severity: 'critical', priority: 'P1' };

      const result = await sendSlackNotification(config, template, incident, 'alert');
      assert.equal(result.success, true);
      assert.equal(capturedUrl, 'https://hooks.slack.com/services/T001/B002/XYZ');
      assert.ok(capturedBody.blocks.length > 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('Direct Gmail OAuth 2.0 Flow', () => {
  const orgId = 'org-default';
  const userId = 'usr-admin-01';

  test('generateAuthUrl creates CSRF state and proper Google OAuth parameters', () => {
    const authData = generateAuthUrl(db, userId, orgId, {
      redirectUri: 'https://alertflow-two.vercel.app/api/connectors/gmail/callback',
    });

    assert.ok(authData.authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.ok(authData.state);
    assert.equal(typeof authData.state, 'string');
    assert.equal(authData.state.length, 64); // 32 bytes hex

    const parsed = new URL(authData.authUrl);
    assert.equal(parsed.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
    assert.equal(parsed.searchParams.get('access_type'), 'offline');
    assert.equal(parsed.searchParams.get('prompt'), 'consent');
    assert.equal(parsed.searchParams.get('state'), authData.state);

    // Verify state record in database
    const stateRow = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(authData.state);
    assert.ok(stateRow);
    assert.equal(stateRow.provider, 'gmail');
    assert.equal(stateRow.user_id, userId);
  });

  test('handleOAuthCallback enforces single-use CSRF validation', async () => {
    const { state } = generateAuthUrl(db, userId, orgId);

    // Call with fake code and mock exchange failure to verify state consumption
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '{"error": "invalid_grant"}',
    });

    try {
      const res1 = await handleOAuthCallback(db, { code: 'bad-code', state });
      assert.equal(res1.success, false);

      // Replay attempt with same state should be rejected immediately as invalid CSRF state
      const res2 = await handleOAuthCallback(db, { code: 'another-code', state });
      assert.equal(res2.success, false);
      assert.match(res2.error, /invalid or expired oauth state/i);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('handleOAuthCallback exchanges tokens, encrypts, and syncs to destinations', async () => {
    const { state, redirectUri } = generateAuthUrl(db, userId, orgId);

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_type: 'offline',
            access_token: 'ya29.test-mock-access-token-direct-integration',
            refresh_token: '1//04test-mock-refresh-token-direct-integration',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'https://www.googleapis.com/auth/gmail.send',
          }),
        };
      }
      if (url.includes('googleapis.com/oauth2/v2/userinfo')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'google-user-998877',
            email: 'oncall-team@alertflow.io',
            name: 'AlertFlow OnCall Lead',
          }),
        };
      }
      return { ok: false, status: 404, text: async () => 'Not found' };
    };

    try {
      const callbackResult = await handleOAuthCallback(db, {
        code: 'valid-mock-authorization-code',
        state,
        redirectUri,
      });

      assert.equal(callbackResult.success, true);
      assert.equal(callbackResult.email, 'oncall-team@alertflow.io');

      // Verify connector in database
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(callbackResult.connectorId);
      assert.ok(connector);
      assert.equal(connector.provider, 'gmail');
      assert.equal(connector.account_email, 'oncall-team@alertflow.io');
      assert.equal(connector.status, 'connected');

      // Confirm tokens are encrypted at rest
      assert.notEqual(connector.encrypted_access_token, 'ya29.test-mock-access-token-direct-integration');
      assert.equal(decryptToken(connector.encrypted_access_token), 'ya29.test-mock-access-token-direct-integration');
      assert.equal(decryptToken(connector.encrypted_refresh_token), '1//04test-mock-refresh-token-direct-integration');

      // Confirm destination table synchronization
      const dest = db.prepare(`SELECT * FROM destinations WHERE type = 'gmail' AND organization_id = ?`).get(orgId);
      assert.ok(dest);
      assert.equal(dest.status, 'connected');
      assert.equal(dest.enabled, 1);
      assert.match(dest.name, /oncall-team@alertflow\.io/);

      // Verify getGmailStatus endpoint helper
      const status = getGmailStatus(db, orgId);
      assert.equal(status.connected, true);
      assert.equal(status.email, 'oncall-team@alertflow.io');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('getValidAccessToken refreshes access token if expired', async () => {
    // Find our connected connector
    const connector = db.prepare(`SELECT * FROM connectors WHERE provider = 'gmail' LIMIT 1`).get();
    assert.ok(connector);

    // Force expiration in DB
    const expiredTime = new Date(Date.now() - 60000).toISOString();
    db.prepare('UPDATE connectors SET token_expires_at = ? WHERE id = ?').run(expiredTime, connector.id);

    let refreshCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        refreshCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ya29.brand-new-refreshed-access-token',
            expires_in: 3600,
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    try {
      const token = await getValidAccessToken(db, connector.id);
      assert.equal(refreshCalled, true);
      assert.equal(token, 'ya29.brand-new-refreshed-access-token');

      // Check DB was updated with new encrypted token
      const updated = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connector.id);
      assert.equal(decryptToken(updated.encrypted_access_token), 'ya29.brand-new-refreshed-access-token');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('buildRfc2822RawEmail constructs RFC 2822 complaint MIME email with base64url encoding', () => {
    const rawBase64Url = buildRfc2822RawEmail({
      from: 'alerts@alertflow.io',
      to: 'engineer@alertflow.io',
      subject: 'Critical: Database Node Failure',
      htmlText: '<h2>Database Node 1 Unresponsive</h2>',
      plainText: 'Database Node 1 Unresponsive',
      messageId: '<test-msg-123@alertflow.io>',
    });

    assert.ok(rawBase64Url);
    assert.equal(typeof rawBase64Url, 'string');
    // Base64url characters only
    assert.match(rawBase64Url, /^[A-Za-z0-9_-]+$/);

    // Decode base64url to verify headers
    const decoded = Buffer.from(rawBase64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.ok(decoded.includes('From: alerts@alertflow.io'));
    assert.ok(decoded.includes('To: engineer@alertflow.io'));
    assert.ok(decoded.includes('Subject: Critical: Database Node Failure'));
    assert.ok(decoded.includes('Content-Type: multipart/alternative'));
    assert.ok(decoded.includes('Database Node 1 Unresponsive'));
  });

  test('sendGmailMessage sends message to Google Gmail API', async () => {
    let capturedUrl = null;
    let capturedAuth = null;
    let capturedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedAuth = options.headers['Authorization'];
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: '18ecc7testmessageid', threadId: '18ecc7testthread' }),
      };
    };

    try {
      const connector = db.prepare(`SELECT * FROM connectors WHERE provider = 'gmail' LIMIT 1`).get();
      const sendResult = await sendGmailMessage(db, connector, {
        to: 'oncall-dev@alertflow.io',
        subject: 'P1 Incident INC-992: Service Disruption',
        htmlText: '<p>Immediate attention required</p>',
      });

      assert.equal(sendResult.success, true);
      assert.equal(sendResult.messageId, '18ecc7testmessageid');
      assert.equal(capturedUrl, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      assert.ok(capturedAuth.startsWith('Bearer ya29.'));
      assert.ok(capturedBody.raw);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('sendGmailNotification formats alert and recovery emails', async () => {
    let sentSubject = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const decoded = Buffer.from(body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const match = decoded.match(/Subject:\s*([^\r\n]+)/);
      if (match) {
        const raw = match[1];
        const rfc2047 = raw.match(/=\?utf-8\?B\?(.*)\?=/i);
        sentSubject = rfc2047 ? Buffer.from(rfc2047[1], 'base64').toString('utf8') : raw;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg-alert-123' }),
      };
    };

    try {
      const incident = {
        title: 'Kubernetes API Server Timeout',
        severity: 'critical',
        incident_number: 'INC-404',
        environment: 'Production',
      };
      const template = { description: 'API server connection timeout' };

      // Test alert dispatch
      const alertRes = await sendGmailNotification(db, {}, template, incident, 'alert');
      assert.equal(alertRes.success, true);
      assert.match(sentSubject, /CRITICAL/);

      // Test recovery dispatch
      const recRes = await sendGmailNotification(db, {}, template, incident, 'recovery');
      assert.equal(recRes.success, true);
      assert.match(sentSubject, /RESOLVED/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('disconnectGmail marks connector disconnected and revokes tokens', async () => {
    const connector = db.prepare(`SELECT * FROM connectors WHERE provider = 'gmail' LIMIT 1`).get();
    assert.ok(connector);

    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200 });

    try {
      const res = await disconnectGmail(db, orgId, connector.id);
      assert.equal(res.success, true);

      const updated = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connector.id);
      assert.equal(updated.status, 'disconnected');

      const dest = db.prepare(`SELECT * FROM destinations WHERE type = 'gmail' AND organization_id = ?`).get(orgId);
      assert.equal(dest.status, 'disconnected');
      assert.equal(dest.enabled, 0);

      const status = getGmailStatus(db, orgId);
      assert.equal(status.connected, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
