import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import { getDb, waitForDb } from './db.js';
import { processEvent, addTimelineEvent, addAuditLog, addAppNotification, cancelEscalation } from './engine/pipeline.js';
import { checkRuleConflicts } from './engine/rules.js';
import { v4 as uuidv4 } from 'uuid';
import {
  generateAuthUrl as generateGmailAuthUrl,
  handleOAuthCallback as handleGmailOAuthCallback,
  getGmailStatus,
  disconnectGmail,
  sendGmailMessage,
} from './connectors/gmail.js';
import { sendDirectSlackMessage } from './connectors/slack.js';
import {
  normalizeEmail,
  validateEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  sanitizeUser,
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  cleanExpiredSessions,
  setSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  createPasswordResetToken,
  verifyPasswordResetToken,
  consumePasswordResetToken,
  loginLimiter,
  registerLimiter,
  resetLimiter,
  COOKIE_NAME,
  PASSWORD_MIN_LENGTH,
  DEFAULT_ORG_ID,
} from './auth.js';

const app = express();
const wsClients = new Set();
const activeSessionsToSockets = new Map();
let server = null;
let wss = null;

const PORT = process.env.PORT || 3001;
const ORG_ID = DEFAULT_ORG_ID;

// Allowed frontend origins for CORS and WebSocket handshake
const allowedOrigins = [
  'https://alertflow-two.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : []),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
];

export function isAllowedOrigin(origin) {
  if (!origin) return true; // Direct server-to-server or same-origin
  if (process.env.NODE_ENV !== 'production') return true;
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.hostname;
    if (origin.endsWith('.vercel.app') || originHost === 'localhost' || originHost === '127.0.0.1') {
      return true;
    }
    return allowedOrigins.some(o => o.toLowerCase() === origin.toLowerCase());
  } catch {
    return false;
  }
}

// ==========================================
// WEBSOCKET SERVER WITH AUTHENTICATION
// ==========================================

export function terminateSessionSockets(sessionId) {
  if (!sessionId) return;
  const set = activeSessionsToSockets.get(sessionId);
  if (set) {
    for (const ws of set) {
      try {
        ws.close(1008, 'Session revoked or expired');
      } catch {}
    }
    activeSessionsToSockets.delete(sessionId);
  }
}

if (!process.env.VERCEL) {
  server = http.createServer(app);
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (parsedUrl.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // 1. Origin validation
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        console.warn(`[WS] Rejected connection from untrusted origin: ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      // 2. Session validation via cookie
      const cookieHeader = request.headers.cookie;
      const sessionId = parseSessionCookie(cookieHeader);
      if (!sessionId) {
        console.warn('[WS] Rejected connection: Missing session cookie');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      await waitForDb();
      const db = getDb();
      const sessionResult = getSession(db, sessionId);

      if (!sessionResult || !sessionResult.user) {
        console.warn('[WS] Rejected connection: Invalid or expired session');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = sessionResult.user;
        ws.sessionId = sessionResult.session.id;
        wss.emit('connection', ws, request);
      });
    } catch (err) {
      console.error('[WS] Upgrade handling error:', err.message);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    if (!activeSessionsToSockets.has(ws.sessionId)) {
      activeSessionsToSockets.set(ws.sessionId, new Set());
    }
    activeSessionsToSockets.get(ws.sessionId).add(ws);

    ws.on('close', () => {
      wsClients.delete(ws);
      const set = activeSessionsToSockets.get(ws.sessionId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) activeSessionsToSockets.delete(ws.sessionId);
      }
    });
  });
}

// ==========================================
// CORS & MIDDLEWARE
// ==========================================

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS request rejected: Origin not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-AlertFlow-Client'],
}));

app.use(express.json({ limit: '1mb' }));

// Ensure database is ready before handling requests
app.use(async (req, res, next) => {
  try {
    await waitForDb();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// Periodic session cleanup
setInterval(() => {
  try {
    const db = getDb();
    cleanExpiredSessions(db);
  } catch {}
}, 60 * 60 * 1000).unref();

// CSRF validation for state-changing browser requests
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  // Public webhook ingestion does not use cookies and is exempt from origin check
  if (req.path === '/api/webhook/ingest') {
    return next();
  }

  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden: CSRF validation failed' });
  }
  next();
});

// Session identification middleware (populates req.user and req.session)
app.use((req, res, next) => {
  const sessionId = parseSessionCookie(req.headers.cookie) || (
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  );

  if (sessionId) {
    try {
      const db = getDb();
      const result = getSession(db, sessionId);
      if (result) {
        req.user = result.user;
        req.session = result.session;
      }
    } catch (err) {
      console.error('[Auth] Error looking up session:', err.message);
    }
  }
  next();
});

// Authentication enforcement middleware
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  next();
}

// Role authorization middleware
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required' });
  }
  next();
}

export function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// ==========================================
// HEALTH CHECKS
// ==========================================

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ==========================================
// AUTHENTICATION API
// ==========================================

// Config (public endpoint indicating if registration is enabled)
app.get('/api/auth/config', (req, res) => {
  const registrationEnabled = process.env.ALLOW_REGISTRATION !== 'false';
  res.json({
    registrationEnabled,
    passwordMinLength: PASSWORD_MIN_LENGTH,
  });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const registrationEnabled = process.env.ALLOW_REGISTRATION !== 'false';
  if (!registrationEnabled) {
    return res.status(403).json({ error: 'Public registration is currently disabled' });
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (registerLimiter.isLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
  }

  const { name, email, password } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.error });
  }

  const db = getDb();

  // Check duplicate email
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    registerLimiter.recordAttempt(clientIp);
    return res.status(400).json({ error: 'An account with this email address already exists' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const userId = `user-${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    // Check if this is the very first registered user with password
    const adminCountRow = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND password_hash IS NOT NULL`).get();
    const role = (adminCountRow?.c === 0) ? 'admin' : 'member';

    const avatarColors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f43f5e'];
    const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    db.prepare(`
      INSERT INTO users (id, organization_id, name, email, role, avatar_color, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(userId, ORG_ID, name.trim(), normalizedEmail, role, avatarColor, passwordHash, now, now);

    db.save();

    // Create session for immediate login
    const session = createSession(db, userId, {
      userAgent: req.headers['user-agent'] || '',
      ipAddress: clientIp,
    });
    setSessionCookie(res, session.id);

    const newUser = {
      id: userId,
      organization_id: ORG_ID,
      name: name.trim(),
      email: normalizedEmail,
      role,
      avatar_color: avatarColor,
      created_at: now,
    };

    addAuditLog(db, 'user_registered', 'user', userId, newUser.name, `New user registered: ${newUser.name}`, userId, newUser.name);

    res.status(201).json({
      success: true,
      user: sanitizeUser(newUser),
    });
  } catch (err) {
    console.error('[Auth] Registration error:', err);
    res.status(500).json({ error: 'Registration failed due to a server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (loginLimiter.isLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many failed login attempts. Please try again in 15 minutes.' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = normalizeEmail(email);
  const db = getDb();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  // Generic authentication error message to prevent account enumeration
  const invalidError = 'Invalid email or password';

  if (!user || !user.password_hash || user.is_active === 0) {
    loginLimiter.recordAttempt(clientIp);
    return res.status(401).json({ error: invalidError });
  }

  const isValidPassword = await verifyPassword(password, user.password_hash);
  if (!isValidPassword) {
    loginLimiter.recordAttempt(clientIp);
    return res.status(401).json({ error: invalidError });
  }

  // Success: reset rate limiter
  loginLimiter.reset(clientIp);

  // Invalidate any old session if cookie present
  const oldSessionId = parseSessionCookie(req.headers.cookie);
  if (oldSessionId) {
    deleteSession(db, oldSessionId);
    terminateSessionSockets(oldSessionId);
  }

  // Generate new persistent session
  const session = createSession(db, user.id, {
    userAgent: req.headers['user-agent'] || '',
    ipAddress: clientIp,
  });

  setSessionCookie(res, session.id);

  addAuditLog(db, 'user_login', 'user', user.id, user.name, 'User logged in', user.id, user.name);

  res.json({
    success: true,
    user: sanitizeUser(user),
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const sessionId = parseSessionCookie(req.headers.cookie) || (
    req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
  );

  if (sessionId) {
    try {
      const db = getDb();
      deleteSession(db, sessionId);
      terminateSessionSockets(sessionId);
    } catch (e) {
      console.error('[Auth] Error invalidating session on logout:', e.message);
    }
  }

  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// Current user profile
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  res.json({
    authenticated: true,
    user: sanitizeUser(req.user),
  });
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (resetLimiter.isLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
  }

  const { email } = req.body || {};
  const genericResponse = {
    success: true,
    message: 'If an account exists with this email address, password reset instructions have been sent.',
  };

  if (!email || !validateEmail(email)) {
    return res.json(genericResponse);
  }

  const normalizedEmail = normalizeEmail(email);
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(normalizedEmail);

  if (!user) {
    resetLimiter.recordAttempt(clientIp);
    return res.json(genericResponse);
  }

  try {
    const { rawToken } = createPasswordResetToken(db, user.id);
    db.save();

    const frontendOrigin = req.headers.origin || process.env.FRONTEND_URL || 'https://alertflow-two.vercel.app';
    const resetUrl = `${frontendOrigin}/reset-password?token=${rawToken}`;

    // Check if an email notification destination or SMTP is configured
    const emailDest = db.prepare(`SELECT * FROM destinations WHERE type = 'email' AND enabled = 1`).get();
    let emailSent = false;

    if (emailDest || process.env.SMTP_HOST || process.env.EMAIL_USER) {
      try {
        const { sendEmailNotification } = await import('./notifications/email.js');
        let config = {};
        if (emailDest) {
          config = typeof emailDest.configuration === 'string' ? JSON.parse(emailDest.configuration) : emailDest.configuration;
        } else {
          config = {
            smtp_host: process.env.SMTP_HOST,
            smtp_port: parseInt(process.env.SMTP_PORT, 10) || 587,
            smtp_user: process.env.SMTP_USER,
            smtp_pass: process.env.SMTP_PASS,
            email: process.env.EMAIL_USER,
            from_email: process.env.EMAIL_FROM || 'noreply@alertflow.io',
          };
        }

        const template = {
          subject: 'AlertFlow Password Reset',
          service: 'AlertFlow Auth',
          environment: 'Security',
          description: `A password reset was requested for your AlertFlow account. Click the link to reset your password (valid for 1 hour):\n\n${resetUrl}`,
          severity: 'info',
        };

        await sendEmailNotification({ ...config, to_email: user.email }, template, { title: 'Password Reset', severity: 'info', incident_number: 'AUTH' });
        emailSent = true;
      } catch (err) {
        console.error('[Auth] Error sending reset email:', err.message);
      }
    }

    if (!emailSent) {
      console.log(`[Auth] Password reset token generated for ${user.email} (valid 1 hour). Configure SMTP or Email destination for automated email delivery.`);
    }

    addAuditLog(db, 'password_reset_requested', 'user', user.id, user.name, 'Password reset requested', user.id, user.name);
  } catch (err) {
    console.error('[Auth] Forgot password error:', err.message);
  }

  res.json(genericResponse);
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (resetLimiter.isLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
  }

  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.error });
  }

  const db = getDb();
  const tokenRecord = verifyPasswordResetToken(db, token);
  if (!tokenRecord) {
    resetLimiter.recordAttempt(clientIp);
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const success = consumePasswordResetToken(db, token, passwordHash);

    if (!success) {
      return res.status(400).json({ error: 'Invalid or expired password reset token' });
    }

    db.save();
    addAuditLog(db, 'password_reset_completed', 'user', tokenRecord.user_id, tokenRecord.name, 'Password was reset successfully', tokenRecord.user_id, tokenRecord.name);

    res.json({
      success: true,
      message: 'Your password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed due to a server error' });
  }
});

// ==========================================
// EVENTS / PIPELINE
// ==========================================

// Event simulator / webhook ingestion (authenticated)
app.post('/api/events', requireAuth, async (req, res) => {
  try {
    const result = await processEvent(req.body);
    res.json(result);
  } catch (err) {
    console.error('[API] Event processing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// External webhook endpoint (open for monitoring integrations like Datadog, Grafana)
app.post('/api/webhook/ingest', async (req, res) => {
  try {
    const result = await processEvent(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// DASHBOARD
// ==========================================

app.get('/api/dashboard', requireAuth, (req, res) => {
  const db = getDb();

  const openIncidents = db.prepare(`SELECT COUNT(*) as c FROM incidents WHERE status NOT IN ('resolved') AND organization_id = ?`).get(ORG_ID).c;
  const criticalIncidents = db.prepare(`SELECT COUNT(*) as c FROM incidents WHERE severity = 'critical' AND status NOT IN ('resolved') AND organization_id = ?`).get(ORG_ID).c;

  const today = new Date().toISOString().split('T')[0];
  const alertsToday = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE date(created_at) = ? AND organization_id = ?`).get(today, ORG_ID).c;

  const totalDeliveries = db.prepare(`SELECT COUNT(*) as c FROM deliveries`).get().c;
  const successDeliveries = db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE status = 'delivered'`).get().c;
  const deliverySuccessRate = totalDeliveries > 0 ? Math.round((successDeliveries / totalDeliveries) * 100) : 100;

  // MTTA
  const mttaRow = db.prepare(`
    SELECT AVG((julianday(acknowledged_at) - julianday(started_at)) * 86400) as avg_seconds 
    FROM incidents WHERE acknowledged_at IS NOT NULL AND organization_id = ?
  `).get(ORG_ID);
  const mtta = mttaRow?.avg_seconds ? Math.round(mttaRow.avg_seconds) : null;

  // MTTR
  const mttrRow = db.prepare(`
    SELECT AVG((julianday(resolved_at) - julianday(started_at)) * 86400) as avg_seconds 
    FROM incidents WHERE resolved_at IS NOT NULL AND organization_id = ?
  `).get(ORG_ID);
  const mttr = mttrRow?.avg_seconds ? Math.round(mttrRow.avg_seconds) : null;

  // Alert noise
  const totalAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE organization_id = ?`).get(ORG_ID).c;
  const duplicateAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE is_duplicate = 1 AND organization_id = ?`).get(ORG_ID).c;
  const suppressedAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE is_suppressed = 1 AND organization_id = ?`).get(ORG_ID).c;
  const noiseAlerts = duplicateAlerts + suppressedAlerts;
  const alertNoise = totalAlerts > 0 ? Math.round((noiseAlerts / totalAlerts) * 100) : 0;

  // Escalations
  const escalations = db.prepare(`SELECT COUNT(*) as c FROM incident_events WHERE type = 'escalation'`).get().c;

  // Active incidents
  const activeIncidents = db.prepare(`
    SELECT i.*, s.name as service_name, t.name as team_name, u.name as assignee_name
    FROM incidents i
    LEFT JOIN services s ON i.service_id = s.id
    LEFT JOIN teams t ON i.team_id = t.id
    LEFT JOIN users u ON i.assignee_id = u.id
    WHERE i.status NOT IN ('resolved') AND i.organization_id = ?
    ORDER BY
      CASE i.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
      i.started_at DESC
    LIMIT 20
  `).all(ORG_ID);

  // Service health
  const serviceHealth = db.prepare(`
    SELECT s.*, t.name as team_name,
      (SELECT COUNT(*) FROM incidents WHERE service_id = s.id AND status NOT IN ('resolved')) as open_incidents,
      (SELECT COUNT(*) FROM alerts WHERE service_id = s.id AND date(created_at) = ?) as alerts_today,
      (SELECT MAX(timestamp) FROM alerts WHERE service_id = s.id) as last_event
    FROM services s
    LEFT JOIN teams t ON s.team_id = t.id
    WHERE s.organization_id = ?
    ORDER BY
      CASE s.status WHEN 'down' THEN 1 WHEN 'degraded' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END,
      s.name
  `).all(today, ORG_ID);

  // Recent activity
  const recentActivity = db.prepare(`
    SELECT ie.*, i.incident_number, i.title as incident_title
    FROM incident_events ie
    JOIN incidents i ON ie.incident_id = i.id
    ORDER BY ie.timestamp DESC
    LIMIT 20
  `).all();

  res.json({
    kpis: {
      openIncidents, criticalIncidents, alertsToday, deliverySuccessRate,
      mtta, mttr, alertNoise, escalations,
    },
    activeIncidents,
    serviceHealth,
    recentActivity,
  });
});

// ==========================================
// INCIDENTS
// ==========================================

app.get('/api/incidents', requireAuth, (req, res) => {
  const db = getDb();
  const { status, severity, priority, team, service, environment, search, limit = 50 } = req.query;

  let where = ['i.organization_id = ?'];
  let params = [ORG_ID];

  if (status && status !== 'all') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (severity) { where.push('i.severity = ?'); params.push(severity); }
  if (priority) { where.push('i.priority = ?'); params.push(priority); }
  if (team) { where.push('i.team_id = ?'); params.push(team); }
  if (service) { where.push('i.service_id = ?'); params.push(service); }
  if (environment) { where.push('i.environment = ?'); params.push(environment); }
  if (search) { where.push(`(i.title LIKE ? OR CAST(i.incident_number AS TEXT) LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }

  const incidents = db.prepare(`
    SELECT i.*, s.name as service_name, t.name as team_name, u.name as assignee_name
    FROM incidents i
    LEFT JOIN services s ON i.service_id = s.id
    LEFT JOIN teams t ON i.team_id = t.id
    LEFT JOIN users u ON i.assignee_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE i.status WHEN 'triggered' THEN 1 WHEN 'investigating' THEN 2 WHEN 'acknowledged' THEN 3 WHEN 'mitigating' THEN 4 ELSE 5 END,
      CASE i.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
      i.started_at DESC
    LIMIT ?
  `).all(...params, Number(limit));

  res.json(incidents);
});

app.get('/api/incidents/:id', requireAuth, (req, res) => {
  const db = getDb();
  const incident = db.prepare(`
    SELECT i.*, s.name as service_name, t.name as team_name, u.name as assignee_name
    FROM incidents i
    LEFT JOIN services s ON i.service_id = s.id
    LEFT JOIN teams t ON i.team_id = t.id
    LEFT JOIN users u ON i.assignee_id = u.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  // Timeline
  const timeline = db.prepare(`
    SELECT ie.*, u.name as user_name
    FROM incident_events ie
    LEFT JOIN users u ON ie.user_id = u.id
    WHERE ie.incident_id = ?
    ORDER BY ie.timestamp ASC
  `).all(req.params.id);

  // Related alerts
  const alerts = db.prepare(`
    SELECT a.*, s.name as service_name
    FROM alerts a
    LEFT JOIN services s ON a.service_id = s.id
    WHERE a.incident_id = ?
    ORDER BY a.timestamp DESC
  `).all(req.params.id);

  // Deliveries
  const deliveries = db.prepare(`
    SELECT d.*, dest.name as destination_name
    FROM deliveries d
    LEFT JOIN destinations dest ON d.destination_id = dest.id
    WHERE d.incident_id = ?
    ORDER BY d.created_at DESC
  `).all(req.params.id);

  res.json({ ...incident, timeline, alerts, deliveries });
});

// Incident actions
app.post('/api/incidents/:id/acknowledge', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user?.id || req.body.user_id || 'user-ahmed';
  const now = new Date().toISOString();

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  db.prepare('UPDATE incidents SET status = ?, acknowledged_at = ?, updated_at = ? WHERE id = ?')
    .run('acknowledged', now, now, req.params.id);

  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const userName = req.user?.name || user?.name || 'Unknown';

  addTimelineEvent(db, req.params.id, 'acknowledged', `Acknowledged by ${userName}`);
  cancelEscalation(req.params.id);
  addAuditLog(db, 'incident_acknowledged', 'incident', req.params.id, `INC-${incident.incident_number}`, `Acknowledged by ${userName}`, userId, userName);
  addAppNotification(db, 'incident_acknowledged', 'Incident Acknowledged', `INC-${incident.incident_number} acknowledged by ${userName}`, 'info', `/incidents/${req.params.id}`);

  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  broadcast({ type: 'incident_updated', incident: updated });
  broadcast({ type: 'activity', activity: { type: 'incident_acknowledged', message: `${userName} acknowledged INC-${incident.incident_number}`, timestamp: now } });

  res.json({ success: true, incident: updated });
});

app.post('/api/incidents/:id/resolve', requireAuth, async (req, res) => {
  const db = getDb();
  const userId = req.user?.id || req.body.user_id || 'user-ahmed';
  const { root_cause, impact, resolution, followup } = req.body;
  const now = new Date().toISOString();

  const incident = db.prepare(`
    SELECT i.*, s.name as service_name 
    FROM incidents i 
    LEFT JOIN services s ON i.service_id = s.id 
    WHERE i.id = ?
  `).get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  db.prepare('UPDATE incidents SET status = ?, resolved_at = ?, updated_at = ?, root_cause = ?, impact = ?, resolution = ?, followup = ? WHERE id = ?')
    .run('resolved', now, now, root_cause || null, impact || null, resolution || null, followup || null, req.params.id);

  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const userName = req.user?.name || user?.name || 'Unknown';

  addTimelineEvent(db, req.params.id, 'resolved', `Resolved by ${userName}`);
  cancelEscalation(req.params.id);

  // Update service status
  if (incident.service_id) {
    const otherOpen = db.prepare(`SELECT COUNT(*) as c FROM incidents WHERE service_id = ? AND status NOT IN ('resolved') AND id != ?`).get(incident.service_id, req.params.id);
    if (otherOpen.c === 0) {
      db.prepare('UPDATE services SET status = ? WHERE id = ?').run('healthy', incident.service_id);
    }
  }

  addAuditLog(db, 'incident_resolved', 'incident', req.params.id, `INC-${incident.incident_number}`, `Resolved by ${userName}`, userId, userName);
  addAppNotification(db, 'incident_resolved', 'Incident Resolved', `INC-${incident.incident_number} resolved by ${userName}`, 'success', `/incidents/${req.params.id}`);

  // Send recovery notifications with explicit recovery metadata
  const updatedIncident = db.prepare(`
    SELECT i.*, s.name as service_name 
    FROM incidents i 
    LEFT JOIN services s ON i.service_id = s.id 
    WHERE i.id = ?
  `).get(req.params.id);

  const recoveryEvent = {
    event_id: `rec_${incident.id}_${Date.now()}`,
    event_type: 'recovery',
    status: 'resolved',
    severity: 'resolved',
    value: 'resolved',
    service_id: incident.service_id,
    service: incident.service_name || incident.service || null,
    environment: incident.environment || 'production',
    incident_id: incident.id,
    incident_number: incident.incident_number,
    description: `Incident INC-${incident.incident_number} resolved by ${userName}`,
    source: 'AlertOps Incident Engine',
  };

  console.log(`[RECOVERY] incident=${incident.id} event_type=recovery status=resolved`);
  await dispatchNotifications(db, updatedIncident, recoveryEvent, { notify: true }, 'recovery');
  console.log(`[RECOVERY] notification dispatched for incident=${incident.id}`);

  broadcast({ type: 'incident_updated', incident: updatedIncident });
  broadcast({ type: 'activity', activity: { type: 'incident_resolved', message: `${userName} resolved INC-${incident.incident_number}`, timestamp: now } });

  res.json({ success: true, incident: updatedIncident });
});

app.post('/api/incidents/:id/assign', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user?.id || req.body.user_id || 'user-ahmed';
  const { team_id, assignee_id } = req.body;
  const now = new Date().toISOString();

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const updates = [];
  const params = [];

  if (team_id) { updates.push('team_id = ?'); params.push(team_id); }
  if (assignee_id) { updates.push('assignee_id = ?'); params.push(assignee_id); }
  updates.push('updated_at = ?'); params.push(now);
  params.push(req.params.id);

  db.prepare(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  if (assignee_id) {
    const assignee = db.prepare('SELECT name FROM users WHERE id = ?').get(assignee_id);
    addTimelineEvent(db, req.params.id, 'assigned', `Assigned to ${assignee?.name || 'Unknown'}`, userId);
  }
  if (team_id) {
    const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(team_id);
    addTimelineEvent(db, req.params.id, 'team_assigned', `Reassigned to ${team?.name || 'Unknown'} team`, userId);
  }

  const updated = db.prepare(`SELECT i.*, s.name as service_name, t.name as team_name, u.name as assignee_name FROM incidents i LEFT JOIN services s ON i.service_id = s.id LEFT JOIN teams t ON i.team_id = t.id LEFT JOIN users u ON i.assignee_id = u.id WHERE i.id = ?`).get(req.params.id);
  broadcast({ type: 'incident_updated', incident: updated });

  res.json({ success: true, incident: updated });
});

app.post('/api/incidents/:id/escalate', requireAuth, async (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();

  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  addTimelineEvent(db, req.params.id, 'escalation', 'Manually escalated');
  addAppNotification(db, 'escalation', 'Incident Escalated', `INC-${incident.incident_number} manually escalated`, 'warning', `/incidents/${req.params.id}`);
  await dispatchNotifications(db, incident, null, { notify: true }, 'escalation');

  broadcast({ type: 'activity', activity: { type: 'escalation', message: `INC-${incident.incident_number} manually escalated`, timestamp: now } });
  res.json({ success: true });
});

app.post('/api/incidents/:id/reopen', requireAuth, (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare('UPDATE incidents SET status = ?, resolved_at = NULL, updated_at = ? WHERE id = ?')
    .run('investigating', now, req.params.id);

  addTimelineEvent(db, req.params.id, 'reopened', 'Incident reopened');
  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  broadcast({ type: 'incident_updated', incident: updated });

  res.json({ success: true, incident: updated });
});

app.post('/api/incidents/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user?.id || req.body.user_id || 'user-ahmed';
  const { status } = req.body;
  const now = new Date().toISOString();

  db.prepare('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.id);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const userName = req.user?.name || user?.name || 'Unknown';
  addTimelineEvent(db, req.params.id, 'status_changed', `Status changed to ${status} by ${userName}`, userId);

  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  broadcast({ type: 'incident_updated', incident: updated });
  res.json({ success: true, incident: updated });
});

app.post('/api/incidents/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user?.id || req.body.user_id || 'user-ahmed';
  const { message } = req.body;

  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const userName = req.user?.name || user?.name || 'Unknown';
  addTimelineEvent(db, req.params.id, 'note', `${userName}: ${message}`, userId);

  const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  broadcast({ type: 'incident_updated', incident: updated });
  res.json({ success: true });
});

app.post('/api/incidents/:id/postmortem', requireAuth, (req, res) => {
  const db = getDb();
  const { root_cause, impact, resolution, followup } = req.body;
  const now = new Date().toISOString();

  db.prepare('UPDATE incidents SET root_cause = ?, impact = ?, resolution = ?, followup = ?, updated_at = ? WHERE id = ?')
    .run(root_cause || null, impact || null, resolution || null, followup || null, now, req.params.id);

  res.json({ success: true });
});

// ==========================================
// ALERTS
// ==========================================

app.get('/api/alerts', requireAuth, (req, res) => {
  const db = getDb();
  const { source, severity, service, environment, status, search, limit = 100 } = req.query;

  let where = ['a.organization_id = ?'];
  let params = [ORG_ID];

  if (source) { where.push('a.source = ?'); params.push(source); }
  if (severity) { where.push('a.severity = ?'); params.push(severity); }
  if (service) { where.push('a.service_id = ?'); params.push(service); }
  if (environment) { where.push('a.environment = ?'); params.push(environment); }
  if (status) { where.push('a.processing_status = ?'); params.push(status); }
  if (search) { where.push('(a.description LIKE ? OR a.event_type LIKE ? OR a.event_id LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const alerts = db.prepare(`
    SELECT a.*, s.name as service_name, i.incident_number
    FROM alerts a
    LEFT JOIN services s ON a.service_id = s.id
    LEFT JOIN incidents i ON a.incident_id = i.id
    WHERE ${where.join(' AND ')}
    ORDER BY a.timestamp DESC
    LIMIT ?
  `).all(...params, Number(limit));

  res.json(alerts);
});

// ==========================================
// SERVICES
// ==========================================

app.get('/api/services', requireAuth, (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const services = db.prepare(`
    SELECT s.*, t.name as team_name,
      (SELECT COUNT(*) FROM incidents WHERE service_id = s.id AND status NOT IN ('resolved')) as open_incidents,
      (SELECT COUNT(*) FROM alerts WHERE service_id = s.id AND date(created_at) = ?) as alerts_today
    FROM services s
    LEFT JOIN teams t ON s.team_id = t.id
    WHERE s.organization_id = ?
    ORDER BY s.name
  `).all(today, ORG_ID);

  res.json(services);
});

app.get('/api/services/:id', requireAuth, (req, res) => {
  const db = getDb();
  const service = db.prepare(`
    SELECT s.*, t.name as team_name
    FROM services s LEFT JOIN teams t ON s.team_id = t.id
    WHERE s.id = ?
  `).get(req.params.id);

  if (!service) return res.status(404).json({ error: 'Service not found' });

  const incidents = db.prepare(`SELECT * FROM incidents WHERE service_id = ? ORDER BY started_at DESC LIMIT 20`).all(req.params.id);
  const alerts = db.prepare(`SELECT * FROM alerts WHERE service_id = ? ORDER BY timestamp DESC LIMIT 50`).all(req.params.id);
  const dependencies = db.prepare(`
    SELECT s.* FROM service_dependencies sd
    JOIN services s ON sd.depends_on_id = s.id
    WHERE sd.service_id = ?
  `).all(req.params.id);
  const dependents = db.prepare(`
    SELECT s.* FROM service_dependencies sd
    JOIN services s ON sd.service_id = s.id
    WHERE sd.depends_on_id = ?
  `).all(req.params.id);

  res.json({ ...service, incidents, alerts, dependencies, dependents });
});

// ==========================================
// TEAMS
// ==========================================

app.get('/api/teams', requireAuth, (req, res) => {
  const db = getDb();
  const teams = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
      (SELECT COUNT(*) FROM incidents WHERE team_id = t.id AND status NOT IN ('resolved')) as open_incidents
    FROM teams t WHERE t.organization_id = ?
    ORDER BY t.name
  `).all(ORG_ID);

  // Get members and on-call for each team
  for (const team of teams) {
    team.members = db.prepare(`
      SELECT u.id, u.organization_id, u.name, u.email, u.role, u.avatar_color, tm.role as team_role
      FROM team_members tm JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
    `).all(team.id);

    const oncall = db.prepare(`SELECT * FROM oncall_schedules WHERE team_id = ?`).get(team.id);
    if (oncall) {
      const members = JSON.parse(oncall.members || '[]');
      const currentIdx = oncall.current_index || 0;
      if (members.length > 0) {
        const primaryUser = db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(members[currentIdx % members.length]);
        const secondaryUser = members.length > 1 ? db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(members[(currentIdx + 1) % members.length]) : null;
        team.oncall = { primary: primaryUser, secondary: secondaryUser, schedule: oncall };
      }
    }
  }

  res.json(teams);
});

// ==========================================
// DESTINATIONS
// ==========================================

app.get('/api/destinations', requireAuth, (req, res) => {
  const db = getDb();
  const destinations = db.prepare(`SELECT * FROM destinations WHERE organization_id = ? ORDER BY created_at DESC`).all(ORG_ID);

  // Mask sensitive config
  const masked = destinations.map(d => {
    let config = {};
    try {
      config = typeof d.configuration === 'string' ? JSON.parse(d.configuration) : (d.configuration || {});
      if (typeof config === 'string') config = JSON.parse(config);
    } catch {}
    const safeConfig = { ...config };
    if (safeConfig.webhook_url) safeConfig.webhook_url = maskUrl(safeConfig.webhook_url);
    if (safeConfig.app_password) safeConfig.app_password = '••••••••';
    if (safeConfig.smtp_pass) safeConfig.smtp_pass = '••••••••';
    return { ...d, configuration: JSON.stringify(safeConfig) };
  });

  res.json(masked);
});

app.post('/api/destinations', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { type, name, configuration } = req.body;
  const id = uuidv4();
  const configStr = typeof configuration === 'string' ? configuration : JSON.stringify(configuration || {});

  db.prepare(`INSERT INTO destinations (id, organization_id, type, name, status, enabled, configuration) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ORG_ID, type, name, 'connected', 1, configStr);

  addAuditLog(db, 'destination_connected', 'destination', id, name, `${type} destination connected`, req.user?.id, req.user?.name);
  addAppNotification(db, 'destination_connected', 'Destination Connected', `${name} (${type}) connected successfully`, 'success');

  res.json({ success: true, id });
});

app.put('/api/destinations/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, configuration, enabled } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (configuration !== undefined) { 
    updates.push('configuration = ?'); 
    params.push(typeof configuration === 'string' ? configuration : JSON.stringify(configuration || {})); 
  }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  params.push(req.params.id);

  db.prepare(`UPDATE destinations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/destinations/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const dest = db.prepare('SELECT * FROM destinations WHERE id = ?').get(req.params.id);

  db.prepare('DELETE FROM destinations WHERE id = ?').run(req.params.id);
  addAuditLog(db, 'destination_disconnected', 'destination', req.params.id, dest?.name, `${dest?.type} destination disconnected`, req.user?.id, req.user?.name);

  res.json({ success: true });
});

app.get('/api/debug/db', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM destinations').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/destinations/:id/test', requireAuth, async (req, res) => {
  const db = getDb();
  const dest = db.prepare('SELECT * FROM destinations WHERE id = ?').get(req.params.id);
  if (!dest) return res.status(404).json({ error: 'Destination not found' });

  let config = {};
  try {
    config = typeof dest.configuration === 'string' ? JSON.parse(dest.configuration) : (dest.configuration || {});
    if (typeof config === 'string') config = JSON.parse(config);
  } catch {}
  const template = {
    subject: '🔔 AlertOps Test Notification',
    service: 'AlertOps',
    environment: 'Test',
    description: 'This is a test notification from AlertOps to verify your destination configuration.',
    severity: 'info',
    priority: 'P4',
    incident_id: 'TEST',
  };

  const testIncident = {
    incident_number: 'TEST',
    title: 'Test Notification',
    severity: 'info',
    priority: 'P4',
    environment: 'Test',
  };

  try {
    let result;
    if (dest.type === 'slack') {
      const { sendSlackNotification } = await import('./notifications/slack.js');
      result = await sendSlackNotification(config, template, testIncident, 'alert', undefined, { testMode: true });
    } else if (dest.type === 'email') {
      const { sendEmailNotification } = await import('./notifications/email.js');
      result = await sendEmailNotification(config, template, testIncident, 'alert');
    } else if (dest.type === 'gmail') {
      const { sendGmailNotification } = await import('./notifications/gmail.js');
      result = await sendGmailNotification(db, config, template, testIncident, 'alert');
    }

    if (result?.success) {
      db.prepare('UPDATE destinations SET last_success_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
      res.json({ success: true, message: 'Test notification sent successfully' });
    } else {
      res.json({ success: false, error: result?.error || 'Test failed' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

function maskUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname;
    return `${u.origin}/${path.substring(1, 12)}...`;
  } catch {
    return url.substring(0, 30) + '...';
  }
}

// ==========================================
// CONNECTORS (DIRECT GMAIL & SLACK)
// ==========================================

// List all connectors for organization (masked, no secrets)
app.get('/api/connectors', requireAuth, (req, res) => {
  const db = getDb();
  const orgId = req.user?.organization_id || ORG_ID;
  const connectors = db.prepare(`
    SELECT id, organization_id, provider, name, account_id, account_email, status, last_error, metadata, created_at, updated_at
    FROM connectors
    WHERE organization_id = ?
    ORDER BY created_at DESC
  `).all(orgId);

  res.json(connectors);
});

// Gmail connector status
app.get('/api/connectors/gmail/status', requireAuth, (req, res) => {
  const db = getDb();
  const orgId = req.user?.organization_id || ORG_ID;
  const status = getGmailStatus(db, orgId);
  res.json({
    ...status,
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

// Generate Gmail OAuth authorization URL
app.get('/api/connectors/gmail/auth-url', requireAuth, (req, res) => {
  const db = getDb();
  const orgId = req.user?.organization_id || ORG_ID;
  try {
    const { authUrl, state, redirectUri } = generateGmailAuthUrl(
      db,
      req.user.id,
      orgId,
      { redirectUri: req.query.redirect_uri }
    );
    res.json({ authUrl, state, redirectUri });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OAuth 2.0 callback endpoint for Google
app.get('/api/connectors/gmail/callback', async (req, res) => {
  const db = getDb();
  const { code, state, error } = req.query;
  const frontendBase = process.env.FRONTEND_URL || 'https://alertflow-two.vercel.app';

  if (error) {
    console.error(`[Gmail OAuth] Callback error received: ${error}`);
    return res.redirect(`${frontendBase}/destinations?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${frontendBase}/destinations?error=${encodeURIComponent('Missing OAuth code or state parameter')}`);
  }

  try {
    const result = await handleGmailOAuthCallback(db, {
      code,
      state,
      redirectUri: req.query.redirect_uri,
    });

    if (!result.success) {
      console.error(`[Gmail OAuth] Exchange failed: ${result.error}`);
      return res.redirect(`${frontendBase}/destinations?error=${encodeURIComponent(result.error || 'Failed to authenticate Gmail')}`);
    }

    addAuditLog(
      db,
      'connector_connected',
      'connector',
      result.connector.id,
      result.connector.name,
      `Gmail connector connected for ${result.connector.account_email}`,
      result.connector.created_by_user_id || 'system',
      'OAuth'
    );
    addAppNotification(
      db,
      'connector_connected',
      'Gmail Connected',
      `Gmail account (${result.connector.account_email}) connected successfully`,
      'success'
    );

    res.redirect(`${frontendBase}/destinations?connected=gmail`);
  } catch (err) {
    console.error(`[Gmail OAuth] Exception in callback: ${err.message}`);
    res.redirect(`${frontendBase}/destinations?error=${encodeURIComponent(err.message)}`);
  }
});

// Disconnect Gmail connector
app.post('/api/connectors/gmail/disconnect', requireAuth, requireAdmin, async (req, res) => {
  const db = getDb();
  const orgId = req.user?.organization_id || ORG_ID;
  try {
    const result = await disconnectGmail(db, orgId, req.body?.connector_id);
    addAuditLog(
      db,
      'connector_disconnected',
      'connector',
      req.body?.connector_id || 'gmail',
      'Gmail',
      'Gmail connector disconnected',
      req.user?.id,
      req.user?.name
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Gmail connector sending
app.post('/api/connectors/gmail/test', requireAuth, async (req, res) => {
  const db = getDb();
  const orgId = req.user?.organization_id || ORG_ID;

  const connector = db.prepare(`
    SELECT * FROM connectors
    WHERE organization_id = ? AND provider = 'gmail' AND status = 'connected'
    ORDER BY updated_at DESC LIMIT 1
  `).get(orgId);

  if (!connector) {
    return res.status(400).json({ error: 'No active Gmail connector connected. Please connect Gmail first.' });
  }

  const recipient = req.body?.to || req.user?.email || connector.account_email;

  try {
    const result = await sendGmailMessage(db, connector, {
      to: recipient,
      subject: req.body?.subject || '🔔 AlertFlow Direct Gmail Connector Test',
      plainText: req.body?.message || 'This is a test notification from AlertFlow confirming direct Gmail API connectivity.',
      htmlText: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; overflow: hidden; color: #f8fafc;">
          <div style="background: #10b981; padding: 16px 20px;">
            <h3 style="margin: 0; color: #ffffff; font-size: 16px;">✅ AlertFlow Direct Connector Active</h3>
          </div>
          <div style="padding: 20px;">
            <p style="margin: 0 0 16px 0; color: #e2e8f0; font-size: 14px;">This test message confirms your Gmail account (<strong>${connector.account_email}</strong>) is connected directly to AlertFlow without intermediaries.</p>
            <p style="margin: 0; color: #64748b; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
          </div>
        </div>
      `,
    });

    if (result.success) {
      db.prepare(`UPDATE connectors SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), connector.id);
      db.save();
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ==========================================
// ALERT RULES
// ==========================================

app.get('/api/rules', requireAuth, (req, res) => {
  const db = getDb();
  const rules = db.prepare(`SELECT * FROM alert_rules WHERE organization_id = ? ORDER BY priority ASC`).all(ORG_ID);
  res.json(rules);
});

app.post('/api/rules', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, description, priority, conditions, actions, enabled = true } = req.body;
  const id = uuidv4();

  db.prepare(`INSERT INTO alert_rules (id, organization_id, name, description, priority, conditions, actions, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ORG_ID, name, description, priority || 50, JSON.stringify(conditions), JSON.stringify(actions), enabled ? 1 : 0);

  addAuditLog(db, 'rule_created', 'alert_rule', id, name, `Rule created: ${name}`, req.user?.id, req.user?.name);
  res.json({ success: true, id });
});

app.put('/api/rules/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, description, priority, conditions, actions, enabled } = req.body;
  const now = new Date().toISOString();

  const updates = ['updated_at = ?'];
  const params = [now];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
  if (conditions !== undefined) { updates.push('conditions = ?'); params.push(JSON.stringify(conditions)); }
  if (actions !== undefined) { updates.push('actions = ?'); params.push(JSON.stringify(actions)); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  params.push(req.params.id);

  db.prepare(`UPDATE alert_rules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  addAuditLog(db, 'rule_updated', 'alert_rule', req.params.id, name, `Rule updated`, req.user?.id, req.user?.name);
  res.json({ success: true });
});

app.delete('/api/rules/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const rule = db.prepare('SELECT name FROM alert_rules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  addAuditLog(db, 'rule_deleted', 'alert_rule', req.params.id, rule?.name, `Rule deleted`, req.user?.id, req.user?.name);
  res.json({ success: true });
});

app.get('/api/rules/:id/conflicts', requireAuth, (req, res) => {
  const db = getDb();
  const conflicts = checkRuleConflicts(db, req.params.id);
  res.json(conflicts);
});

// ==========================================
// ESCALATION POLICIES
// ==========================================

app.get('/api/escalation-policies', requireAuth, (req, res) => {
  const db = getDb();
  const policies = db.prepare(`SELECT * FROM escalation_policies WHERE organization_id = ? ORDER BY name`).all(ORG_ID);
  res.json(policies);
});

app.post('/api/escalation-policies', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, description, steps, enabled = true } = req.body;
  const id = uuidv4();

  db.prepare(`INSERT INTO escalation_policies (id, organization_id, name, description, steps, enabled) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, ORG_ID, name, description, JSON.stringify(steps), enabled ? 1 : 0);

  addAuditLog(db, 'escalation_policy_created', 'escalation_policy', id, name, `Escalation policy created`, req.user?.id, req.user?.name);
  res.json({ success: true, id });
});

app.put('/api/escalation-policies/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, description, steps, enabled } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (steps !== undefined) { updates.push('steps = ?'); params.push(JSON.stringify(steps)); }
  if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  params.push(req.params.id);

  db.prepare(`UPDATE escalation_policies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// ==========================================
// ON-CALL
// ==========================================

app.get('/api/oncall', requireAuth, (req, res) => {
  const db = getDb();
  const schedules = db.prepare(`
    SELECT oc.*, t.name as team_name
    FROM oncall_schedules oc
    JOIN teams t ON oc.team_id = t.id
    ORDER BY t.name
  `).all();

  const result = schedules.map(oc => {
    const members = JSON.parse(oc.members || '[]');
    const currentIdx = oc.current_index || 0;

    const resolvedMembers = members.map(uid => db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(uid)).filter(Boolean);

    const primary = resolvedMembers[currentIdx % resolvedMembers.length] || null;
    const secondary = resolvedMembers.length > 1 ? resolvedMembers[(currentIdx + 1) % resolvedMembers.length] : null;

    return {
      ...oc,
      resolved_members: resolvedMembers,
      primary,
      secondary,
    };
  });

  res.json(result);
});

// ==========================================
// MAINTENANCE WINDOWS
// ==========================================

app.get('/api/maintenance', requireAuth, (req, res) => {
  const db = getDb();
  const windows = db.prepare(`SELECT * FROM maintenance_windows WHERE organization_id = ? ORDER BY start_time DESC`).all(ORG_ID);
  res.json(windows);
});

app.post('/api/maintenance', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, start_time, end_time, services, environments, suppression_policy = 'all' } = req.body;
  const id = uuidv4();

  db.prepare(`INSERT INTO maintenance_windows (id, organization_id, name, start_time, end_time, services, environments, suppression_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ORG_ID, name, start_time, end_time, JSON.stringify(services || []), JSON.stringify(environments || []), suppression_policy);

  addAuditLog(db, 'maintenance_created', 'maintenance_window', id, name, `Maintenance window created: ${name}`, req.user?.id, req.user?.name);
  res.json({ success: true, id });
});

app.delete('/api/maintenance/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM maintenance_windows WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==========================================
// ANALYTICS
// ==========================================

app.get('/api/analytics', requireAuth, (req, res) => {
  const db = getDb();

  const totalAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE organization_id = ?`).get(ORG_ID).c;
  const criticalAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE severity = 'critical' AND organization_id = ?`).get(ORG_ID).c;
  const warningAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE severity = 'warning' AND organization_id = ?`).get(ORG_ID).c;
  const infoAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE severity = 'info' AND organization_id = ?`).get(ORG_ID).c;

  const totalIncidents = db.prepare(`SELECT COUNT(*) as c FROM incidents WHERE organization_id = ?`).get(ORG_ID).c;
  const resolvedIncidents = db.prepare(`SELECT COUNT(*) as c FROM incidents WHERE status = 'resolved' AND organization_id = ?`).get(ORG_ID).c;
  const escalations = db.prepare(`SELECT COUNT(*) as c FROM incident_events WHERE type = 'escalation'`).get().c;

  const duplicateAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE is_duplicate = 1 AND organization_id = ?`).get(ORG_ID).c;
  const suppressedAlerts = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE is_suppressed = 1 AND organization_id = ?`).get(ORG_ID).c;

  const failedDeliveries = db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE status = 'failed'`).get().c;
  const totalDeliveries = db.prepare(`SELECT COUNT(*) as c FROM deliveries`).get().c;
  const successDeliveries = db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE status = 'delivered'`).get().c;

  // MTTA
  const mttaRow = db.prepare(`SELECT AVG((julianday(acknowledged_at) - julianday(started_at)) * 86400) as avg_seconds FROM incidents WHERE acknowledged_at IS NOT NULL AND organization_id = ?`).get(ORG_ID);
  const mtta = mttaRow?.avg_seconds ? Math.round(mttaRow.avg_seconds) : null;

  // MTTR
  const mttrRow = db.prepare(`SELECT AVG((julianday(resolved_at) - julianday(started_at)) * 86400) as avg_seconds FROM incidents WHERE resolved_at IS NOT NULL AND organization_id = ?`).get(ORG_ID);
  const mttr = mttrRow?.avg_seconds ? Math.round(mttrRow.avg_seconds) : null;

  // Incidents by service
  const incidentsByService = db.prepare(`
    SELECT s.name, COUNT(i.id) as count
    FROM incidents i JOIN services s ON i.service_id = s.id
    WHERE i.organization_id = ?
    GROUP BY s.name ORDER BY count DESC
  `).all(ORG_ID);

  // Incidents by severity
  const incidentsBySeverity = db.prepare(`
    SELECT severity, COUNT(*) as count FROM incidents WHERE organization_id = ? GROUP BY severity
  `).all(ORG_ID);

  // Incidents by team
  const incidentsByTeam = db.prepare(`
    SELECT t.name, COUNT(i.id) as count
    FROM incidents i JOIN teams t ON i.team_id = t.id
    WHERE i.organization_id = ?
    GROUP BY t.name ORDER BY count DESC
  `).all(ORG_ID);

  // Alerts by day (last 7 days)
  const alertsByDay = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM alerts WHERE organization_id = ? AND created_at > datetime('now', '-7 days')
    GROUP BY date(created_at) ORDER BY day
  `).all(ORG_ID);

  const alertNoise = totalAlerts > 0 ? Math.round(((duplicateAlerts + suppressedAlerts) / totalAlerts) * 100) : 0;

  res.json({
    totalAlerts, criticalAlerts, warningAlerts, infoAlerts,
    totalIncidents, resolvedIncidents, escalations,
    duplicateAlerts, suppressedAlerts, failedDeliveries,
    totalDeliveries, successDeliveries,
    mtta, mttr, alertNoise,
    incidentsByService, incidentsBySeverity, incidentsByTeam, alertsByDay,
    resolutionRate: totalIncidents > 0 ? Math.round((resolvedIncidents / totalIncidents) * 100) : 0,
    escalationRate: totalIncidents > 0 ? Math.round((escalations / totalIncidents) * 100) : 0,
    deliverySuccessRate: totalDeliveries > 0 ? Math.round((successDeliveries / totalDeliveries) * 100) : 100,
  });
});

// ==========================================
// AUDIT LOG
// ==========================================

app.get('/api/audit-log', requireAuth, (req, res) => {
  const db = getDb();
  const { action, object_type, limit = 100 } = req.query;

  let where = ['organization_id = ?'];
  let params = [ORG_ID];

  if (action) { where.push('action = ?'); params.push(action); }
  if (object_type) { where.push('object_type = ?'); params.push(object_type); }

  const logs = db.prepare(`
    SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY timestamp DESC LIMIT ?
  `).all(...params, Number(limit));

  res.json(logs);
});

// ==========================================
// SEARCH
// ==========================================

app.get('/api/search', requireAuth, (req, res) => {
  const db = getDb();
  const { q } = req.query;
  if (!q) return res.json({ incidents: [], alerts: [], services: [], teams: [], rules: [] });

  const term = `%${q}%`;

  const incidents = db.prepare(`
    SELECT i.*, s.name as service_name FROM incidents i LEFT JOIN services s ON i.service_id = s.id
    WHERE i.title LIKE ? OR CAST(i.incident_number AS TEXT) LIKE ? LIMIT 10
  `).all(term, term);

  const alerts = db.prepare(`
    SELECT a.*, s.name as service_name FROM alerts a LEFT JOIN services s ON a.service_id = s.id
    WHERE a.description LIKE ? OR a.event_id LIKE ? LIMIT 10
  `).all(term, term);

  const services = db.prepare(`SELECT * FROM services WHERE name LIKE ? LIMIT 10`).all(term);
  const teams = db.prepare(`SELECT * FROM teams WHERE name LIKE ? LIMIT 10`).all(term);
  const rules = db.prepare(`SELECT * FROM alert_rules WHERE name LIKE ? LIMIT 10`).all(term);

  res.json({ incidents, alerts, services, teams, rules });
});

// ==========================================
// NOTIFICATIONS (in-app)
// ==========================================

app.get('/api/notifications', requireAuth, (req, res) => {
  const db = getDb();
  const notifications = db.prepare(`
    SELECT * FROM app_notifications WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(ORG_ID);
  const unreadCount = db.prepare(`
    SELECT COUNT(*) as c FROM app_notifications WHERE organization_id = ? AND read = 0
  `).get(ORG_ID).c;

  res.json({ notifications, unreadCount });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare(`UPDATE app_notifications SET read = 1 WHERE organization_id = ?`).run(ORG_ID);
  res.json({ success: true });
});

// ==========================================
// USERS (Sanitized safe profiles)
// ==========================================

app.get('/api/users', requireAuth, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, organization_id, name, email, role, avatar_color, created_at
    FROM users WHERE organization_id = ?
  `).all(ORG_ID);
  res.json(users);
});

// ==========================================
// NOTIFICATION POLICIES
// ==========================================

app.get('/api/notification-policies', requireAuth, (req, res) => {
  const db = getDb();
  const policies = db.prepare(`SELECT * FROM notification_policies WHERE organization_id = ?`).all(ORG_ID);
  res.json(policies);
});

// ==========================================
// Start server
// ==========================================

async function start() {
  await waitForDb();
  console.log('[Server] Database initialized');

  // Automatic admin bootstrap from environment variables if provided
  if (process.env.ADMIN_BOOTSTRAP_EMAIL && process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    try {
      const email = normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
      const name = process.env.ADMIN_BOOTSTRAP_NAME || 'AlertFlow Administrator';
      const existing = getDb().prepare('SELECT id FROM users WHERE email = ?').get(email);
      const hash = await hashPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD);
      const now = new Date().toISOString();

      if (existing) {
        getDb().prepare(`
          UPDATE users
          SET password_hash = ?, role = 'admin', is_active = 1, updated_at = ?
          WHERE id = ?
        `).run(hash, now, existing.id);
        console.log(`[Server] Bootstrap admin updated: ${email}`);
      } else {
        const id = `user-admin-${uuidv4().slice(0, 8)}`;
        getDb().prepare(`
          INSERT INTO users (id, organization_id, name, email, role, avatar_color, password_hash, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'admin', '#6366f1', ?, 1, ?, ?)
        `).run(id, ORG_ID, name, email, hash, now, now);
        console.log(`[Server] Bootstrap admin created: ${email}`);
      }
      getDb().save();
    } catch (e) {
      console.error('[Server] Failed to auto-bootstrap admin:', e.message);
    }
  }

  if (server) {
    server.listen(PORT, () => {
      console.log(`\n  🚨 AlertOps Server running on http://localhost:${PORT}`);
      console.log(`  📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
      console.log(`  🔗 Webhook endpoint: http://localhost:${PORT}/api/webhook/ingest\n`);
    });
  }
}

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
}

export { server, wss, start };
export default app;

