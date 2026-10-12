import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, 'test_demo_data.db');

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';

const { getDb, waitForDb } = await import('../server/db.js');
const { seedDemoData, DEMO_USERS, DEMO_TEAMS, DEMO_ONCALL } = await import('../server/seed.js');
const { hashPassword, verifyPassword } = await import('../server/auth.js');
const { sendGmailNotification } = await import('../server/notifications/gmail.js');
const { sendEmailNotification } = await import('../server/notifications/email.js');

describe('AlertFlow Demo Dataset and Preservation Test Suite', () => {
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

  test('Seed function executes idempotently without duplicate records', () => {
    // First seed
    const res1 = seedDemoData(db);
    assert.equal(res1.success, true);
    assert.equal(res1.usersCount, DEMO_USERS.length);

    const usersCount1 = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_demo = 1').get().c;
    const teamsCount1 = db.prepare('SELECT COUNT(*) as c FROM teams').get().c;
    const oncallCount1 = db.prepare('SELECT COUNT(*) as c FROM oncall_schedules').get().c;
    const incidentsCount1 = db.prepare('SELECT COUNT(*) as c FROM incidents').get().c;

    assert.equal(usersCount1, DEMO_USERS.length);
    assert.equal(teamsCount1, DEMO_TEAMS.length);
    assert.equal(oncallCount1, DEMO_ONCALL.length);

    // Second seed (idempotency check)
    const res2 = seedDemoData(db);
    assert.equal(res2.success, true);

    const usersCount2 = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_demo = 1').get().c;
    const teamsCount2 = db.prepare('SELECT COUNT(*) as c FROM teams').get().c;
    const oncallCount2 = db.prepare('SELECT COUNT(*) as c FROM oncall_schedules').get().c;
    const incidentsCount2 = db.prepare('SELECT COUNT(*) as c FROM incidents').get().c;

    assert.equal(usersCount2, usersCount1, 'User count should not increase on re-seed');
    assert.equal(teamsCount2, teamsCount1, 'Team count should not increase on re-seed');
    assert.equal(oncallCount2, oncallCount1, 'Oncall count should not increase on re-seed');
    assert.equal(incidentsCount2, incidentsCount1, 'Incident count should not increase on re-seed');
  });

  test('Existing real user account and password hash are preserved during seeding', async () => {
    const realEmail = 'rubait2006@gmail.com';
    const realHash = await hashPassword('SecureRealPass123!');
    const realId = 'user-real-ali';
    const now = new Date().toISOString();

    // Insert real user account
    db.prepare(`
      INSERT INTO users (id, organization_id, name, email, role, avatar_color, password_hash, is_active, is_demo, created_at, updated_at)
      VALUES (?, 'org-default', 'Ali Rubait', ?, 'member', '#6366f1', ?, 1, 0, ?, ?)
    `).run(realId, realEmail, realHash, now, now);

    // Re-run seed
    seedDemoData(db);

    // Verify real user is untouched
    const realUser = db.prepare('SELECT * FROM users WHERE id = ?').get(realId);
    assert.ok(realUser, 'Real user must exist');
    assert.equal(realUser.email, realEmail);
    assert.equal(realUser.name, 'Ali Rubait');
    assert.equal(realUser.password_hash, realHash, 'Real user password hash must NOT be overwritten');
    assert.equal(realUser.is_demo, 0, 'Real user must NOT be marked as demo');

    const isValid = await verifyPassword('SecureRealPass123!', realUser.password_hash);
    assert.equal(isValid, true, 'Real user password must verify successfully');
  });

  test('Demo users cannot authenticate and have null password_hash', () => {
    const demoUsers = db.prepare('SELECT * FROM users WHERE is_demo = 1').all();
    assert.ok(demoUsers.length > 0);

    for (const user of demoUsers) {
      assert.equal(user.password_hash, null, `Demo user ${user.email} must have null password_hash`);
      assert.equal(user.is_demo, 1, `Demo user ${user.email} must have is_demo = 1`);
      assert.ok(user.department, `Demo user ${user.email} must have a department`);
      assert.ok(user.title, `Demo user ${user.email} must have a title`);
      assert.ok(user.tags, `Demo user ${user.email} must have tags`);
    }
  });

  test('Demo users span required departments: Frontend, Backend, DevOps', () => {
    const depts = db.prepare('SELECT DISTINCT department FROM users WHERE is_demo = 1').all().map(r => r.department);
    assert.ok(depts.includes('Frontend'), 'Must include Frontend demo engineers');
    assert.ok(depts.includes('Backend'), 'Must include Backend demo engineers');
    assert.ok(depts.includes('DevOps'), 'Must include DevOps demo engineers');
  });

  test('Demo email notifications are suppressed safely to prevent external dispatch', async () => {
    // Gmail suppression test
    const gmailResult = await sendGmailNotification(
      db,
      { to_email: 'ahmed@demo.alertflow.io' },
      { subject: 'Test Alert', description: 'Test alert body' },
      { id: 'inc-test', severity: 'critical', title: 'Test Alert' },
      'alert'
    );
    assert.equal(gmailResult.success, true);
    assert.equal(gmailResult.suppressed, true);
    assert.match(gmailResult.message, /suppressed/i);

    // SMTP suppression test
    const emailResult = await sendEmailNotification(
      { to_email: 'omar@demo.alertflow.io', smtp_host: 'localhost' },
      { subject: 'Test Alert' },
      { id: 'inc-test', severity: 'warning', title: 'Test Alert' },
      'alert'
    );
    assert.equal(emailResult.success, true);
    assert.equal(emailResult.suppressed, true);
  });
});
