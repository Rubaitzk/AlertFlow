#!/usr/bin/env node
import { getDb, waitForDb } from './db.js';
import { normalizeEmail, validateEmail, validatePassword, hashPassword, DEFAULT_ORG_ID } from './auth.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Bootstrap Administrator Script
 * Usage:
 *   node server/bootstrap-admin.js --email admin@example.com --password "SecurePass123!" --name "Admin Name"
 * Or via environment variables:
 *   ADMIN_BOOTSTRAP_EMAIL=admin@example.com ADMIN_BOOTSTRAP_PASSWORD="SecurePass123!" node server/bootstrap-admin.js
 */
async function bootstrap() {
  await waitForDb();
  const db = getDb();

  // Parse arguments or environment variables
  const args = process.argv.slice(2);
  let email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  let name = process.env.ADMIN_BOOTSTRAP_NAME || 'AlertFlow Administrator';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (arg.startsWith('--email=')) {
      email = arg.split('=', 2)[1];
    } else if (arg === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (arg.startsWith('--password=')) {
      password = arg.split('=', 2)[1];
    } else if (arg === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (arg.startsWith('--name=')) {
      name = arg.split('=', 2)[1];
    }
  }

  if (!email || !password) {
    console.error('Error: Both email and password are required.');
    console.error('Usage: node server/bootstrap-admin.js --email admin@example.com --password "YourStrongPassword123" [--name "Admin Name"]');
    console.error('Or set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD environment variables.');
    process.exit(1);
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    console.error('Error: Invalid email format.');
    process.exit(1);
  }

  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    console.error(`Error: Password validation failed: ${passCheck.error}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  // Check if user already exists
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, role = 'admin', is_active = 1, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, existing.id);

    console.log(`[Bootstrap] Successfully updated existing user "${normalizedEmail}" to role 'admin' with updated credentials.`);
  } else {
    const userId = `user-admin-${uuidv4().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO users (id, organization_id, name, email, role, avatar_color, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', '#6366f1', ?, 1, ?, ?)
    `).run(userId, DEFAULT_ORG_ID, name, normalizedEmail, passwordHash, now, now);

    console.log(`[Bootstrap] Successfully created administrator account "${normalizedEmail}" (ID: ${userId}).`);
  }

  db.save();
  process.exit(0);
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal error:', err.message);
  process.exit(1);
});
