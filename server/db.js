import initSqlJs from 'sql.js/dist/sql-asm.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || (process.env.VERCEL ? path.join('/tmp', 'alertops.db') : path.join(__dirname, 'alertops.db'));

let rawDb = null;
let dbWrapper = null;
let dbReady = null;

/**
 * Compatibility wrapper around sql.js to match better-sqlite3 API.
 * Provides: prepare(sql) → { get(...params), all(...params), run(...params) }
 */
function createWrapper(db) {
  const save = () => {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('[DB] Save error:', e.message);
    }
  };

  // Auto-save periodically
  if (!process.env.VERCEL) {
    const timer = setInterval(save, 5000);
    if (timer.unref) timer.unref();
  }

  return {
    prepare(sql) {
      return {
        run(...params) {
          db.run(sql, params);
          save();
          return { changes: db.getRowsModified() };
        },
        get(...params) {
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const results = [];
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        },
      };
    },
    exec(sql) {
      db.run(sql);
      save();
    },
    pragma(str) {
      // sql.js doesn't support pragma in the same way, ignore
    },
    close() {
      save();
      db.close();
    },
    save,
  };
}

async function initDb() {
  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database');
  }

  rawDb = db;
  dbWrapper = createWrapper(db);
  initSchema();
  seedIfEmpty();
  return dbWrapper;
}

// Promise that resolves when DB is ready
dbReady = initDb();

export async function waitForDb() {
  return dbReady;
}

export function getDb() {
  if (!dbWrapper) {
    throw new Error('Database not initialized yet. Call waitForDb() first.');
  }
  return dbWrapper;
}

function initSchema() {
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'responder',
      avatar_color TEXT DEFAULT '#6366f1',
      password_hash TEXT,
      salt TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      team_id TEXT,
      environment TEXT DEFAULT 'production',
      status TEXT DEFAULT 'healthy',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS service_dependencies (
      service_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      PRIMARY KEY (service_id, depends_on_id),
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (depends_on_id) REFERENCES services(id)
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      incident_number INTEGER,
      title TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      priority TEXT DEFAULT 'P4',
      status TEXT DEFAULT 'triggered',
      service_id TEXT,
      environment TEXT DEFAULT 'production',
      team_id TEXT,
      assignee_id TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      acknowledged_at TEXT,
      resolved_at TEXT,
      root_cause TEXT,
      impact TEXT,
      resolution TEXT,
      followup TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      event_id TEXT,
      source TEXT,
      event_type TEXT,
      service_id TEXT,
      environment TEXT DEFAULT 'production',
      severity TEXT DEFAULT 'info',
      metric TEXT,
      value TEXT,
      threshold TEXT,
      description TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      metadata TEXT,
      processing_status TEXT DEFAULT 'received',
      incident_id TEXT,
      is_duplicate INTEGER DEFAULT 0,
      is_suppressed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS incident_events (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      user_id TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      metadata TEXT,
      FOREIGN KEY (incident_id) REFERENCES incidents(id)
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      priority INTEGER DEFAULT 100,
      conditions TEXT NOT NULL,
      actions TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS notification_policies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      severity TEXT,
      channels TEXT NOT NULL,
      escalate INTEGER DEFAULT 0,
      escalate_after_minutes INTEGER DEFAULT 5,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS destinations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      enabled INTEGER DEFAULT 1,
      configuration TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      alert_id TEXT,
      incident_id TEXT,
      destination_id TEXT,
      destination_type TEXT,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      is_fallback INTEGER DEFAULT 0,
      sent_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS escalation_policies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS oncall_schedules (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT,
      members TEXT NOT NULL,
      rotation_type TEXT DEFAULT 'daily',
      shift_start TEXT DEFAULT '09:00',
      shift_end TEXT DEFAULT '17:00',
      current_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      services TEXT,
      environments TEXT,
      suppression_policy TEXT DEFAULT 'all',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT,
      object_name TEXT,
      details TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  rawDb.run(`
    CREATE TABLE IF NOT EXISTS app_notifications (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      severity TEXT DEFAULT 'info',
      read INTEGER DEFAULT 0,
      link TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_active_at TEXT DEFAULT (datetime('now')),
      user_agent TEXT,
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migrate existing users table if columns are missing
  migrateUsersTable();

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(organization_id)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_event_id ON alerts(event_id)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_incident ON alerts(incident_id)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_service ON alerts(service_id)',
    'CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(organization_id)',
    'CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)',
    'CREATE INDEX IF NOT EXISTS idx_incidents_service ON incidents(service_id)',
    'CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id)',
    'CREATE INDEX IF NOT EXISTS idx_deliveries_incident ON deliveries(incident_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id)',
    'CREATE INDEX IF NOT EXISTS idx_app_notifications_org ON app_notifications(organization_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_pwd_reset_user_id ON password_reset_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_pwd_reset_token_hash ON password_reset_tokens(token_hash)',
  ];
  for (const idx of indexes) {
    try {
      rawDb.run(idx);
    } catch (e) {
      console.warn('[DB] Index creation warning:', e.message);
    }
  }
}

function migrateUsersTable() {
  try {
    const cols = [];
    const stmt = rawDb.prepare("PRAGMA table_info(users)");
    while (stmt.step()) {
      cols.push(stmt.getAsObject().name);
    }
    stmt.free();

    if (!cols.includes('password_hash')) {
      rawDb.run("ALTER TABLE users ADD COLUMN password_hash TEXT");
    }
    if (!cols.includes('salt')) {
      rawDb.run("ALTER TABLE users ADD COLUMN salt TEXT");
    }
    if (!cols.includes('is_active')) {
      rawDb.run("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1");
    }
    if (!cols.includes('updated_at')) {
      rawDb.run("ALTER TABLE users ADD COLUMN updated_at TEXT");
    }
  } catch (err) {
    console.error('[DB] Error migrating users table:', err.message);
  }
}

function seedIfEmpty() {
  const stmt = rawDb.prepare('SELECT COUNT(*) as c FROM organizations');
  stmt.step();
  const orgCount = stmt.getAsObject().c;
  stmt.free();

  if (orgCount > 0) return;

  const orgId = 'org-default';
  rawDb.run('INSERT INTO organizations (id, name, timezone) VALUES (?, ?, ?)', [orgId, 'Acme Engineering', 'UTC']);

  // Users
  const users = [
    { id: 'user-ahmed', name: 'Ahmed Khan', email: 'ahmed@acme.dev', role: 'admin', color: '#6366f1' },
    { id: 'user-bilal', name: 'Bilal Ahmad', email: 'bilal@acme.dev', role: 'responder', color: '#ec4899' },
    { id: 'user-sara', name: 'Sara Chen', email: 'sara@acme.dev', role: 'responder', color: '#10b981' },
    { id: 'user-mike', name: 'Mike Torres', email: 'mike@acme.dev', role: 'manager', color: '#f59e0b' },
    { id: 'user-priya', name: 'Priya Sharma', email: 'priya@acme.dev', role: 'responder', color: '#8b5cf6' },
    { id: 'user-james', name: 'James Wilson', email: 'james@acme.dev', role: 'responder', color: '#06b6d4' },
    { id: 'user-elena', name: 'Elena Petrov', email: 'elena@acme.dev', role: 'manager', color: '#f43f5e' },
    { id: 'user-omar', name: 'Omar Farouk', email: 'omar@acme.dev', role: 'responder', color: '#84cc16' },
  ];

  for (const u of users) {
    rawDb.run('INSERT INTO users (id, organization_id, name, email, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)',
      [u.id, orgId, u.name, u.email, u.role, u.color]);
  }

  // Teams
  const teams = [
    { id: 'team-backend', name: 'Backend', desc: 'Backend services and APIs' },
    { id: 'team-frontend', name: 'Frontend', desc: 'Frontend applications and CDN' },
    { id: 'team-database', name: 'Database', desc: 'Database infrastructure and performance' },
    { id: 'team-devops', name: 'DevOps', desc: 'Infrastructure, CI/CD, and deployments' },
    { id: 'team-security', name: 'Security', desc: 'Security monitoring and incident response' },
    { id: 'team-payments', name: 'Payments', desc: 'Payment processing and billing' },
  ];

  for (const t of teams) {
    rawDb.run('INSERT INTO teams (id, organization_id, name, description) VALUES (?, ?, ?, ?)', [t.id, orgId, t.name, t.desc]);
  }

  // Team members
  const members = [
    ['team-backend', 'user-ahmed', 'lead'], ['team-backend', 'user-sara', 'member'],
    ['team-frontend', 'user-james', 'lead'], ['team-frontend', 'user-priya', 'member'],
    ['team-database', 'user-bilal', 'lead'], ['team-database', 'user-ahmed', 'member'],
    ['team-devops', 'user-omar', 'lead'], ['team-devops', 'user-mike', 'manager'],
    ['team-security', 'user-elena', 'lead'], ['team-security', 'user-omar', 'member'],
    ['team-payments', 'user-sara', 'lead'], ['team-payments', 'user-priya', 'member'],
  ];

  for (const m of members) {
    rawDb.run('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', m);
  }

  // Services
  const services = [
    { id: 'svc-payments-api', name: 'Payments API', desc: 'Core payment processing service', team: 'team-payments', env: 'production' },
    { id: 'svc-auth', name: 'Authentication', desc: 'OAuth and session management', team: 'team-backend', env: 'production' },
    { id: 'svc-orders-api', name: 'Orders API', desc: 'Order management and fulfillment', team: 'team-backend', env: 'production' },
    { id: 'svc-postgres', name: 'PostgreSQL', desc: 'Primary relational database', team: 'team-database', env: 'production' },
    { id: 'svc-redis', name: 'Redis', desc: 'Cache and session store', team: 'team-database', env: 'production' },
    { id: 'svc-frontend', name: 'Frontend', desc: 'Web application and CDN', team: 'team-frontend', env: 'production' },
    { id: 'svc-infra', name: 'Infrastructure', desc: 'Cloud infrastructure and networking', team: 'team-devops', env: 'production' },
  ];

  for (const s of services) {
    rawDb.run('INSERT INTO services (id, organization_id, name, description, team_id, environment, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.id, orgId, s.name, s.desc, s.team, s.env, 'healthy']);
  }

  // Service dependencies
  const deps = [
    ['svc-payments-api', 'svc-postgres'], ['svc-payments-api', 'svc-auth'], ['svc-payments-api', 'svc-redis'],
    ['svc-orders-api', 'svc-postgres'], ['svc-orders-api', 'svc-auth'], ['svc-orders-api', 'svc-redis'],
    ['svc-auth', 'svc-postgres'], ['svc-auth', 'svc-redis'],
    ['svc-frontend', 'svc-payments-api'], ['svc-frontend', 'svc-orders-api'], ['svc-frontend', 'svc-auth'],
  ];

  for (const d of deps) {
    rawDb.run('INSERT INTO service_dependencies (service_id, depends_on_id) VALUES (?, ?)', d);
  }

  // Alert rules
  const rules = [
    {
      id: 'rule-critical-prod-db', name: 'Critical Production Database',
      desc: 'High severity for critical database events in production', priority: 1,
      conditions: JSON.stringify({ all: [
        { field: 'environment', operator: 'equals', value: 'production' },
        { field: 'service', operator: 'in', value: ['PostgreSQL', 'Redis'] },
        { field: 'severity', operator: 'equals', value: 'critical' },
      ] }),
      actions: JSON.stringify({ severity: 'critical', priority: 'P1', create_incident: true, route_team: 'team-database', escalation_policy: 'esc-prod-critical', notify: true }),
    },
    {
      id: 'rule-critical-prod', name: 'Critical Production Services',
      desc: 'High severity for all critical production events', priority: 2,
      conditions: JSON.stringify({ all: [
        { field: 'environment', operator: 'equals', value: 'production' },
        { field: 'severity', operator: 'equals', value: 'critical' },
      ] }),
      actions: JSON.stringify({ severity: 'critical', priority: 'P1', create_incident: true, notify: true, escalation_policy: 'esc-prod-critical' }),
    },
    {
      id: 'rule-warning-prod', name: 'Production Warnings',
      desc: 'Medium severity for production warnings', priority: 3,
      conditions: JSON.stringify({ all: [
        { field: 'environment', operator: 'equals', value: 'production' },
        { field: 'severity', operator: 'equals', value: 'warning' },
      ] }),
      actions: JSON.stringify({ severity: 'warning', priority: 'P3', create_incident: true, notify: true }),
    },
    {
      id: 'rule-staging', name: 'Staging Alerts',
      desc: 'Low priority for staging alerts', priority: 10,
      conditions: JSON.stringify({ all: [{ field: 'environment', operator: 'equals', value: 'staging' }] }),
      actions: JSON.stringify({ severity: 'warning', priority: 'P4', create_incident: true, notify: false }),
    },
    {
      id: 'rule-default', name: 'Default Rule', desc: 'Catch-all default rule', priority: 100,
      conditions: JSON.stringify({ all: [] }),
      actions: JSON.stringify({ create_incident: true, priority: 'P3', notify: true }),
    },
  ];

  for (const r of rules) {
    rawDb.run('INSERT INTO alert_rules (id, organization_id, name, description, priority, conditions, actions, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [r.id, orgId, r.name, r.desc, r.priority, r.conditions, r.actions, 1]);
  }

  // Escalation policies
  const escalations = [
    {
      id: 'esc-prod-critical', name: 'Production Critical', desc: 'Escalation for critical production incidents',
      steps: JSON.stringify([
        { step: 1, action: 'notify_oncall_primary', wait_minutes: 5, label: 'Notify primary on-call' },
        { step: 2, action: 'notify_oncall_secondary', wait_minutes: 5, label: 'Notify secondary on-call' },
        { step: 3, action: 'notify_manager', wait_minutes: 10, label: 'Notify engineering manager' },
      ]),
    },
    {
      id: 'esc-prod-warning', name: 'Production Warning', desc: 'Escalation for warning-level production incidents',
      steps: JSON.stringify([
        { step: 1, action: 'notify_oncall_primary', wait_minutes: 15, label: 'Notify primary on-call' },
        { step: 2, action: 'notify_manager', wait_minutes: 30, label: 'Notify engineering manager' },
      ]),
    },
  ];

  for (const e of escalations) {
    rawDb.run('INSERT INTO escalation_policies (id, organization_id, name, description, steps, enabled) VALUES (?, ?, ?, ?, ?, ?)',
      [e.id, orgId, e.name, e.desc, e.steps, 1]);
  }

  // On-call schedules
  const oncalls = [
    { id: 'oncall-database', team: 'team-database', name: 'Database On-Call', members: JSON.stringify(['user-bilal', 'user-ahmed']) },
    { id: 'oncall-backend', team: 'team-backend', name: 'Backend On-Call', members: JSON.stringify(['user-ahmed', 'user-sara']) },
    { id: 'oncall-devops', team: 'team-devops', name: 'DevOps On-Call', members: JSON.stringify(['user-omar', 'user-mike']) },
    { id: 'oncall-payments', team: 'team-payments', name: 'Payments On-Call', members: JSON.stringify(['user-sara', 'user-priya']) },
    { id: 'oncall-frontend', team: 'team-frontend', name: 'Frontend On-Call', members: JSON.stringify(['user-james', 'user-priya']) },
    { id: 'oncall-security', team: 'team-security', name: 'Security On-Call', members: JSON.stringify(['user-elena', 'user-omar']) },
  ];

  for (const o of oncalls) {
    rawDb.run('INSERT INTO oncall_schedules (id, team_id, name, members) VALUES (?, ?, ?, ?)', [o.id, o.team, o.name, o.members]);
  }

  // Notification policies
  const notifPolicies = [
    { id: 'np-critical', name: 'Critical Notification Policy', severity: 'critical', channels: JSON.stringify({ slack: true, email: true, in_app: true }) },
    { id: 'np-warning', name: 'Warning Notification Policy', severity: 'warning', channels: JSON.stringify({ slack: true, email: false, in_app: true }) },
    { id: 'np-info', name: 'Info Notification Policy', severity: 'info', channels: JSON.stringify({ slack: false, email: false, in_app: true }) },
  ];

  for (const np of notifPolicies) {
    rawDb.run('INSERT INTO notification_policies (id, organization_id, name, severity, channels) VALUES (?, ?, ?, ?, ?)',
      [np.id, orgId, np.name, np.severity, np.channels]);
  }

  dbWrapper.save();
  console.log('[DB] Seed data inserted successfully');
}

// Helper to get next incident number
export function getNextIncidentNumber() {
  const row = getDb().prepare('SELECT MAX(incident_number) as max_num FROM incidents').get();
  return ((row?.max_num) || 10481) + 1;
}

export default { getDb, getNextIncidentNumber, waitForDb };
