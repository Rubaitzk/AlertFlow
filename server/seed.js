import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path from 'path';

export const DEMO_ORG_ID = 'org-default';

export const DEMO_USERS = [
  {
    id: 'user-ahmed',
    name: 'Ahmed Khan',
    email: 'ahmed@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#6366f1',
    department: 'Backend',
    title: 'Backend Platform Lead',
    tags: ['Node.js', 'Express', 'Distributed Systems', 'REST APIs', 'Incident Lead'],
    status: 'on_call',
    shift: '09:00 - 17:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-james',
    name: 'James Wilson',
    email: 'james@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#06b6d4',
    department: 'Frontend',
    title: 'Staff Frontend Engineer',
    tags: ['React', 'Vite', 'WebSockets', 'UI Performance', 'Design Systems'],
    status: 'on_call',
    shift: '08:00 - 16:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-priya',
    name: 'Priya Sharma',
    email: 'priya@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#8b5cf6',
    department: 'Frontend',
    title: 'Senior Frontend Developer',
    tags: ['React', 'TypeScript', 'Accessibility', 'State Management', 'Tailwind'],
    status: 'available',
    shift: '10:00 - 18:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-omar',
    name: 'Omar Farouk',
    email: 'omar@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#84cc16',
    department: 'DevOps',
    title: 'Principal DevOps & SRE Lead',
    tags: ['Kubernetes', 'Terraform', 'CI/CD', 'AWS', 'Incident Commander', 'On-Call'],
    status: 'on_call',
    shift: '00:00 - 08:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-mike',
    name: 'Mike Torres',
    email: 'mike@demo.alertflow.io',
    role: 'manager',
    avatar_color: '#f59e0b',
    department: 'DevOps',
    title: 'Infrastructure Operations Manager',
    tags: ['Cloud Infrastructure', 'Linux', 'Docker', 'Prometheus', 'Monitoring'],
    status: 'available',
    shift: '09:00 - 17:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-sara',
    name: 'Sara Chen',
    email: 'sara@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#10b981',
    department: 'Backend',
    title: 'Senior Distributed Systems Engineer',
    tags: ['Go', 'Event Streams', 'Kafka', 'PostgreSQL', 'Caching'],
    status: 'available',
    shift: '09:00 - 17:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-bilal',
    name: 'Bilal Ahmad',
    email: 'bilal@demo.alertflow.io',
    role: 'responder',
    avatar_color: '#ec4899',
    department: 'Database',
    title: 'Lead Database Architect',
    tags: ['PostgreSQL', 'Redis', 'Query Optimization', 'High Availability', 'Replication'],
    status: 'on_call',
    shift: '12:00 - 20:00 UTC',
    is_demo: 1,
  },
  {
    id: 'user-elena',
    name: 'Elena Petrov',
    email: 'elena@demo.alertflow.io',
    role: 'manager',
    avatar_color: '#f43f5e',
    department: 'Security',
    title: 'Security Operations Lead',
    tags: ['AppSec', 'OAuth 2.0', 'SOC2', 'Threat Modeling', 'Compliance'],
    status: 'on_call',
    shift: '09:00 - 17:00 UTC',
    is_demo: 1,
  },
];

export const DEMO_TEAMS = [
  { id: 'team-frontend', name: 'Frontend', desc: 'Web applications, CDN, client state, and user interfaces' },
  { id: 'team-backend', name: 'Backend', desc: 'Core backend microservices, authentication, and internal APIs' },
  { id: 'team-devops', name: 'DevOps', desc: 'Cloud infrastructure, CI/CD pipelines, Kubernetes, and telemetry' },
  { id: 'team-database', name: 'Database', desc: 'Relational databases, replication, Redis caching, and storage' },
  { id: 'team-security', name: 'Security', desc: 'Application security, identity access, threat detection, and audits' },
  { id: 'team-payments', name: 'Payments', desc: 'Payment gateway integrations, ledger balance, and billing webhooks' },
];

export const DEMO_TEAM_MEMBERS = [
  { team_id: 'team-frontend', user_id: 'user-james', role: 'lead' },
  { team_id: 'team-frontend', user_id: 'user-priya', role: 'member' },
  { team_id: 'team-backend', user_id: 'user-ahmed', role: 'lead' },
  { team_id: 'team-backend', user_id: 'user-sara', role: 'member' },
  { team_id: 'team-devops', user_id: 'user-omar', role: 'lead' },
  { team_id: 'team-devops', user_id: 'user-mike', role: 'manager' },
  { team_id: 'team-database', user_id: 'user-bilal', role: 'lead' },
  { team_id: 'team-database', user_id: 'user-ahmed', role: 'member' },
  { team_id: 'team-security', user_id: 'user-elena', role: 'lead' },
  { team_id: 'team-security', user_id: 'user-omar', role: 'member' },
  { team_id: 'team-payments', user_id: 'user-sara', role: 'lead' },
  { team_id: 'team-payments', user_id: 'user-priya', role: 'member' },
];

export const DEMO_ONCALL = [
  {
    id: 'oncall-frontend',
    team_id: 'team-frontend',
    name: 'Frontend On-Call',
    members: ['user-james', 'user-priya'],
    rotation_type: 'weekly',
    shift_start: '08:00',
    shift_end: '16:00',
    current_index: 0,
  },
  {
    id: 'oncall-backend',
    team_id: 'team-backend',
    name: 'Backend On-Call',
    members: ['user-ahmed', 'user-sara'],
    rotation_type: 'weekly',
    shift_start: '09:00',
    shift_end: '17:00',
    current_index: 0,
  },
  {
    id: 'oncall-devops',
    team_id: 'team-devops',
    name: 'DevOps & SRE On-Call',
    members: ['user-omar', 'user-mike'],
    rotation_type: 'daily',
    shift_start: '00:00',
    shift_end: '08:00',
    current_index: 0,
  },
  {
    id: 'oncall-database',
    team_id: 'team-database',
    name: 'Database On-Call',
    members: ['user-bilal', 'user-ahmed'],
    rotation_type: 'weekly',
    shift_start: '12:00',
    shift_end: '20:00',
    current_index: 0,
  },
  {
    id: 'oncall-security',
    team_id: 'team-security',
    name: 'Security Response On-Call',
    members: ['user-elena', 'user-omar'],
    rotation_type: 'weekly',
    shift_start: '09:00',
    shift_end: '17:00',
    current_index: 0,
  },
  {
    id: 'oncall-payments',
    team_id: 'team-payments',
    name: 'Payments On-Call',
    members: ['user-sara', 'user-priya'],
    rotation_type: 'weekly',
    shift_start: '09:00',
    shift_end: '17:00',
    current_index: 0,
  },
];

export const DEMO_SERVICES = [
  { id: 'svc-frontend', name: 'Frontend Web App', desc: 'React/Vite single-page web app and static assets', team_id: 'team-frontend', env: 'production', status: 'healthy' },
  { id: 'svc-auth', name: 'Authentication Service', desc: 'Session tokens, OAuth 2.0 and identity verification', team_id: 'team-backend', env: 'production', status: 'healthy' },
  { id: 'svc-payments-api', name: 'Payments API', desc: 'Core payment processing and webhooks gateway', team_id: 'team-payments', env: 'production', status: 'degraded' },
  { id: 'svc-orders-api', name: 'Orders API', desc: 'Order fulfillment, inventory dispatch, and lifecycle', team_id: 'team-backend', env: 'production', status: 'healthy' },
  { id: 'svc-postgres', name: 'PostgreSQL Primary', desc: 'Primary relational database cluster and read replicas', team_id: 'team-database', env: 'production', status: 'healthy' },
  { id: 'svc-redis', name: 'Redis Cache Cluster', desc: 'Distributed cache, rate limiter keys, and pub/sub', team_id: 'team-database', env: 'production', status: 'healthy' },
  { id: 'svc-infra', name: 'Kubernetes Infrastructure', desc: 'Cloud clusters, ingress controllers, and nodes', team_id: 'team-devops', env: 'production', status: 'degraded' },
];

export const DEMO_INCIDENTS = [
  {
    id: 'inc-demo-10484',
    incident_number: 10484,
    organization_id: DEMO_ORG_ID,
    title: 'Kubernetes Worker Node High Memory Pressure',
    impact: 'Node k8s-worker-prod-04 exceeded 92% memory threshold triggering pod evictions on ingress layer.',
    root_cause: 'Memory leak in ingress controller sidecar',
    severity: 'critical',
    priority: 'P1',
    status: 'triggered',
    service_id: 'svc-infra',
    team_id: 'team-devops',
    assignee_id: 'user-omar',
    environment: 'production',
    started_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    acknowledged_at: null,
    resolved_at: null,
  },
  {
    id: 'inc-demo-10483',
    incident_number: 10483,
    organization_id: DEMO_ORG_ID,
    title: 'Production CDN Cache Invalidation Latency',
    impact: 'Edge CDN edge nodes reporting 4500ms TTFB on asset cache updates affecting dashboard loading.',
    root_cause: 'Upstream edge purge API rate limiting',
    severity: 'warning',
    priority: 'P2',
    status: 'investigating',
    service_id: 'svc-frontend',
    team_id: 'team-frontend',
    assignee_id: 'user-james',
    environment: 'production',
    started_at: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    resolved_at: null,
  },
  {
    id: 'inc-demo-10482',
    incident_number: 10482,
    organization_id: DEMO_ORG_ID,
    title: 'Payments Gateway Elevated 502 Rate on Webhook Handshake',
    impact: 'Downstream payment provider reported timeout surges; fallback circuit breaker activated.',
    root_cause: 'Network partition on payment provider east region gateway',
    severity: 'critical',
    priority: 'P1',
    status: 'mitigating',
    service_id: 'svc-payments-api',
    team_id: 'team-backend',
    assignee_id: 'user-ahmed',
    environment: 'production',
    started_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
    resolved_at: null,
  },
  {
    id: 'inc-demo-10481',
    incident_number: 10481,
    organization_id: DEMO_ORG_ID,
    title: 'PostgreSQL Connection Pool Saturation on Replica 02',
    impact: 'Connection pool exhausted by long-running reporting query. Query terminated and pool resized.',
    root_cause: 'Unindexed analytics scan executed on production read replica',
    resolution: 'Terminated offending PID, added composite index, bumped connection pool limit to 250.',
    severity: 'critical',
    priority: 'P1',
    status: 'resolved',
    service_id: 'svc-postgres',
    team_id: 'team-database',
    assignee_id: 'user-bilal',
    environment: 'production',
    started_at: new Date(Date.now() - 360 * 60 * 1000).toISOString(),
    acknowledged_at: new Date(Date.now() - 350 * 60 * 1000).toISOString(),
    resolved_at: new Date(Date.now() - 310 * 60 * 1000).toISOString(),
  },
];

/**
 * Safely and idempotently seeds or updates the demo dataset without overwriting
 * or modifying real user accounts or active credentials.
 */
export function seedDemoData(db, options = {}) {
  const orgId = options.organizationId || DEMO_ORG_ID;
  const now = new Date().toISOString();

  // 1. Ensure default organization exists
  const existingOrg = db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId);
  if (!existingOrg) {
    db.prepare('INSERT INTO organizations (id, name, timezone, created_at) VALUES (?, ?, ?, ?)')
      .run(orgId, 'AlertFlow Engineering', 'UTC', now);
  }

  // 2. Upsert Demo Personnel (idempotent, never overwrite real users with password_hash)
  for (const u of DEMO_USERS) {
    const existing = db.prepare('SELECT id, is_demo, password_hash FROM users WHERE id = ?').get(u.id);
    const tagsJson = JSON.stringify(u.tags);

    if (existing) {
      // If user exists and is a demo user (or legacy pre-auth demo user with no password), update metadata safely
      if (existing.is_demo === 1 || !existing.password_hash) {
        db.prepare(`
          UPDATE users
          SET name = ?,
              email = ?,
              role = ?,
              avatar_color = ?,
              is_demo = 1,
              department = ?,
              title = ?,
              tags = ?,
              status = ?,
              shift = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          u.name,
          u.email,
          u.role,
          u.avatar_color,
          u.department,
          u.title,
          tagsJson,
          u.status,
          u.shift,
          now,
          u.id
        );
      }
    } else {
      // Insert new demo personnel record
      db.prepare(`
        INSERT INTO users (
          id, organization_id, name, email, role, avatar_color,
          password_hash, is_active, is_demo, department, title, tags, status, shift,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        u.id,
        orgId,
        u.name,
        u.email,
        u.role,
        u.avatar_color,
        u.department,
        u.title,
        tagsJson,
        u.status,
        u.shift,
        now,
        now
      );
    }
  }

  // 3. Upsert Demo Teams
  for (const t of DEMO_TEAMS) {
    const existingTeam = db.prepare('SELECT id FROM teams WHERE id = ?').get(t.id);
    if (existingTeam) {
      db.prepare('UPDATE teams SET name = ?, description = ? WHERE id = ?').run(t.name, t.desc, t.id);
    } else {
      db.prepare('INSERT INTO teams (id, organization_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(t.id, orgId, t.name, t.desc, now);
    }
  }

  // 4. Upsert Team Memberships (clear previous demo assignments and re-link cleanly)
  for (const m of DEMO_TEAM_MEMBERS) {
    const existing = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(m.team_id, m.user_id);
    if (existing) {
      db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(m.role, m.team_id, m.user_id);
    } else {
      db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(m.team_id, m.user_id, m.role);
    }
  }

  // 5. Upsert On-Call Schedules
  for (const o of DEMO_ONCALL) {
    const existing = db.prepare('SELECT id FROM oncall_schedules WHERE id = ?').get(o.id);
    const membersJson = JSON.stringify(o.members);
    if (existing) {
      db.prepare(`
        UPDATE oncall_schedules
        SET team_id = ?, name = ?, members = ?, rotation_type = ?, shift_start = ?, shift_end = ?, current_index = ?
        WHERE id = ?
      `).run(o.team_id, o.name, membersJson, o.rotation_type, o.shift_start, o.shift_end, o.current_index, o.id);
    } else {
      db.prepare(`
        INSERT INTO oncall_schedules (id, team_id, name, members, rotation_type, shift_start, shift_end, current_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(o.id, o.team_id, o.name, membersJson, o.rotation_type, o.shift_start, o.shift_end, o.current_index, now);
    }
  }

  // 6. Upsert Demo Services
  for (const s of DEMO_SERVICES) {
    const existing = db.prepare('SELECT id FROM services WHERE id = ?').get(s.id);
    if (existing) {
      db.prepare('UPDATE services SET name = ?, description = ?, team_id = ?, environment = ?, status = ? WHERE id = ?')
        .run(s.name, s.desc, s.team_id, s.env, s.status, s.id);
    } else {
      db.prepare('INSERT INTO services (id, organization_id, name, description, team_id, environment, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.id, orgId, s.name, s.desc, s.team_id, s.env, s.status, now);
    }
  }

  // 7. Upsert Demo Incidents
  for (const inc of DEMO_INCIDENTS) {
    const existing = db.prepare('SELECT id FROM incidents WHERE id = ?').get(inc.id);
    if (existing) {
      db.prepare(`
        UPDATE incidents
        SET title = ?, impact = ?, root_cause = ?, resolution = ?, severity = ?, priority = ?, status = ?,
            service_id = ?, team_id = ?, assignee_id = ?, environment = ?, updated_at = ?
        WHERE id = ?
      `).run(
        inc.title,
        inc.impact || null,
        inc.root_cause || null,
        inc.resolution || null,
        inc.severity,
        inc.priority,
        inc.status,
        inc.service_id,
        inc.team_id,
        inc.assignee_id,
        inc.environment,
        now,
        inc.id
      );
    } else {
      db.prepare(`
        INSERT INTO incidents (
          id, incident_number, organization_id, title, impact, root_cause, resolution, severity, priority,
          status, service_id, team_id, assignee_id, environment, started_at, acknowledged_at, resolved_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        inc.id,
        inc.incident_number,
        orgId,
        inc.title,
        inc.impact || null,
        inc.root_cause || null,
        inc.resolution || null,
        inc.severity,
        inc.priority,
        inc.status,
        inc.service_id,
        inc.team_id,
        inc.assignee_id,
        inc.environment,
        inc.started_at,
        inc.acknowledged_at,
        inc.resolved_at,
        now,
        now
      );
    }
  }

  db.save();
  console.log('[Seed] Demo dataset successfully seeded/updated idempotently.');
  return {
    success: true,
    usersCount: DEMO_USERS.length,
    teamsCount: DEMO_TEAMS.length,
    oncallCount: DEMO_ONCALL.length,
    incidentsCount: DEMO_INCIDENTS.length,
  };
}

// Allow direct execution via CLI
if (process.argv[1] && import.meta.url === `file:///${path.resolve(process.argv[1]).replace(/\\/g, '/')}`) {
  const { getDb, waitForDb } = await import('./db.js');
  await waitForDb();
  seedDemoData(getDb());
}
