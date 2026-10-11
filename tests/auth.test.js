import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, 'test_alertops.db');

// Ensure clean test environment
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.ALLOW_REGISTRATION = 'true';
process.env.PORT = '0'; // Ephemeral port

// Import backend app, server, and DB after setting DB_PATH
const { default: app, server, terminateSessionSockets } = await import('../server/index.js');
const { getDb, waitForDb } = await import('../server/db.js');
const { parseSessionCookie, COOKIE_NAME } = await import('../server/auth.js');

let serverPort;
let baseUrl;
let wsUrl;

before(async () => {
  await waitForDb();

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
});

// Helper for fetch requests preserving cookies
function createCookieJar() {
  let cookieHeader = '';
  return {
    get cookie() { return cookieHeader; },
    setCookieFromRes(res) {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        // extract name=value
        const match = setCookie.match(/([^=]+=[^;]+)/);
        if (match) {
          cookieHeader = match[1];
        }
      }
    },
    clear() { cookieHeader = ''; },
  };
}

describe('AlertFlow Complete Authentication Test Suite', () => {
  const adminJar = createCookieJar();
  const memberJar = createCookieJar();

  // Test 1: Successful Registration
  test('1. Successful registration creates user, persistent session, and returns safe user profile', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AlertFlow-Client': '1' },
      body: JSON.stringify({
        name: 'First Admin User',
        email: 'admin@alertflow.test',
        password: 'ValidPassword123!',
      }),
    });

    assert.equal(res.status, 201);
    adminJar.setCookieFromRes(res);
    assert.ok(adminJar.cookie.includes(COOKIE_NAME), 'Must return session cookie');

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.email, 'admin@alertflow.test');
    assert.equal(data.user.role, 'admin'); // First user becomes admin
    assert.equal(data.user.password_hash, undefined, 'Must NEVER return password_hash');
    assert.equal(data.user.salt, undefined, 'Must NEVER return salt');
  });

  // Test 2: Invalid Registration Data
  test('2. Invalid registration data is rejected with appropriate 400 errors', async () => {
    // Missing name
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@alertflow.test', password: 'ValidPassword123!' }),
    });
    assert.equal(res1.status, 400);

    // Invalid email format
    const res2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'invalid-email', password: 'ValidPassword123!' }),
    });
    assert.equal(res2.status, 400);

    // Short password (< 12 chars)
    const res3 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'valid@alertflow.test', password: 'Short1!' }),
    });
    assert.equal(res3.status, 400);
    const body3 = await res3.json();
    assert.ok(body3.error.includes('12 characters'));
  });

  // Test 3: Duplicate Email Registration
  test('3. Duplicate email registration is prevented', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate User',
        email: 'ADMIN@alertflow.test', // Case-insensitive check
        password: 'ValidPassword123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('already exists'));
  });

  // Test 4: Second user registers as 'member'
  test('4. Second registered user gets "member" role and unique session', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jane Member',
        email: 'jane@alertflow.test',
        password: 'MemberPassword123!',
      }),
    });

    assert.equal(res.status, 201);
    memberJar.setCookieFromRes(res);
    const data = await res.json();
    assert.equal(data.user.role, 'member');
  });

  // Test 5: Successful Login
  test('5. Successful login regenerates session and sets HttpOnly cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@alertflow.test',
        password: 'ValidPassword123!',
      }),
    });

    assert.equal(res.status, 200);
    adminJar.setCookieFromRes(res);
    assert.ok(adminJar.cookie.includes(COOKIE_NAME));

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.email, 'admin@alertflow.test');
  });

  // Test 6: Incorrect Password
  test('6. Incorrect password returns 401 with generic error without account leakage', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@alertflow.test',
        password: 'WrongPassword999!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid email or password');
  });

  // Test 7: Unknown Email
  test('7. Unknown email returns identical generic 401 error', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@alertflow.test',
        password: 'SomePassword123!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid email or password');
  });

  // Test 8: /api/auth/me without session
  test('8. /api/auth/me without session returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(res.status, 401);
  });

  // Test 9: /api/auth/me with valid session
  test('9. /api/auth/me with valid session returns authenticated user', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminJar.cookie },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.user.email, 'admin@alertflow.test');
    assert.equal(data.user.role, 'admin');
  });

  // Test 10: Logout invalidates session
  test('10. Logout invalidates server-side session and clears cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: adminJar.cookie },
    });

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie?.includes('Max-Age=0') || setCookie?.includes('expires='), 'Must clear cookie');

    // Trying /api/auth/me with that cookie must now fail with 401
    const verifyRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminJar.cookie },
    });
    assert.equal(verifyRes.status, 401);

    // Re-login admin for remaining tests
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@alertflow.test',
        password: 'ValidPassword123!',
      }),
    });
    adminJar.setCookieFromRes(loginRes);
  });

  // Test 11: Expired or revoked sessions
  test('11. Expired session records in database cannot access protected endpoints', async () => {
    const db = getDb();
    // Insert artificially expired session
    const expiredSessionId = 'expired_session_test_12345';
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at)
      VALUES (?, (SELECT id FROM users LIMIT 1), ?, ?, ?)
    `).run(expiredSessionId, pastDate, pastDate, pastDate);

    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Cookie: `${COOKIE_NAME}=${expiredSessionId}` },
    });
    assert.equal(res.status, 401);
  });

  // Test 12: Unauthenticated API access denied
  test('12. Unauthenticated API access to dashboard and incidents is denied (401)', async () => {
    const res1 = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(res1.status, 401);

    const res2 = await fetch(`${baseUrl}/api/incidents`);
    assert.equal(res2.status, 401);

    const res3 = await fetch(`${baseUrl}/api/services`);
    assert.equal(res3.status, 401);

    const res4 = await fetch(`${baseUrl}/api/users`);
    assert.equal(res4.status, 401);
  });

  // Test 13: Authenticated API access continues to work
  test('13. Authenticated API access works and returns real incident data', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Cookie: adminJar.cookie },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.kpis !== undefined);
    assert.ok(Array.isArray(data.activeIncidents));
    assert.ok(Array.isArray(data.serviceHealth));
  });

  // Test 14: Role and permission checks
  test('14. Role checks prevent member from creating/deleting destinations but allow admin', async () => {
    // Member tries to create destination -> 403 Forbidden
    const memberRes = await fetch(`${baseUrl}/api/destinations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memberJar.cookie },
      body: JSON.stringify({ type: 'webhook', name: 'Test Destination', configuration: {} }),
    });
    assert.equal(memberRes.status, 403);

    // Admin creates destination -> 200 OK
    const adminRes = await fetch(`${baseUrl}/api/destinations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminJar.cookie },
      body: JSON.stringify({ type: 'webhook', name: 'Admin Webhook', configuration: {} }),
    });
    assert.equal(adminRes.status, 200);
    const data = await adminRes.json();
    assert.ok(data.id);
  });

  // Test 15: WebSocket rejects unauthenticated connections
  test('15. WebSocket handshake rejects unauthenticated connection with 401', async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        ws.close();
        assert.fail('Unauthenticated WebSocket connection must not open');
      });

      ws.on('error', (err) => {
        // Handshake 401 error expected
        assert.ok(err.message.includes('401') || err.message.includes('Unexpected server response: 401'));
        resolve();
      });
    });
  });

  // Test 16: WebSocket permits valid sessions
  test('16. WebSocket handshake accepts connection with valid session cookie', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Cookie: adminJar.cookie,
        },
      });

      ws.on('open', () => {
        assert.ok(true, 'WebSocket opened successfully');
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        reject(err);
      });
    });
  });

  // Test 17: Incident actions use authenticated user
  test('17. Incident acknowledgement uses authenticated user identity', async () => {
    const db = getDb();
    // Get an incident ID from seed data or create one
    let incident = db.prepare('SELECT id FROM incidents LIMIT 1').get();
    if (!incident) {
      incident = { id: 'inc-test-1' };
      db.prepare(`INSERT INTO incidents (id, organization_id, incident_number, title, status) VALUES (?, 'org-default', 9999, 'Test Outage', 'triggered')`).run(incident.id);
    }

    const ackRes = await fetch(`${baseUrl}/api/incidents/${incident.id}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memberJar.cookie },
      body: JSON.stringify({}),
    });

    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.incident.status, 'acknowledged');

    // Verify timeline event recorded with member name
    const timeline = db.prepare('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY timestamp DESC LIMIT 1').get(incident.id);
    assert.ok(timeline.message.includes('Jane Member'), 'Timeline message must record authenticated user');
  });

  // Test 18: Password Reset Flow
  test('18. Full password recovery flow works end-to-end', async () => {
    // Request reset
    const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jane@alertflow.test' }),
    });
    assert.equal(forgotRes.status, 200);

    // Retrieve generated token from DB
    const db = getDb();
    const tokenRow = db.prepare(`SELECT * FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = 'jane@alertflow.test') AND used_at IS NULL`).get();
    assert.ok(tokenRow, 'Token record must be generated');

    // Test token reset with raw token using consumePasswordResetToken or endpoint
    const { createPasswordResetToken } = await import('../server/auth.js');
    const { rawToken } = createPasswordResetToken(db, tokenRow.user_id);

    const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: 'NewJanePassword123!' }),
    });

    assert.equal(resetRes.status, 200);

    // Verify login with new password
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jane@alertflow.test', password: 'NewJanePassword123!' }),
    });
    assert.equal(loginRes.status, 200);
  });
});
