const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const unauthorizedListeners = new Set();

export function onUnauthorized(callback) {
  unauthorizedListeners.add(callback);
  return () => unauthorizedListeners.delete(callback);
}

function notifyUnauthorized() {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {}
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-AlertFlow-Client': '1',
    ...(options.headers || {}),
  };

  const config = {
    credentials: 'include',
    ...options,
    headers,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));

    // Notify auth context on 401 Unauthorized for session expiration (except on /auth/me or /auth/login)
    if (res.status === 401 && !path.startsWith('/auth/me') && !path.startsWith('/auth/login')) {
      notifyUnauthorized();
    }

    const error = new Error(err.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = err;
    throw error;
  }

  return res.json();
}

export const api = {
  // Authentication
  login: (credentials) => request('/auth/login', { method: 'POST', body: credentials }),
  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }),
  getMe: () => request('/auth/me'),
  getAuthConfig: () => request('/auth/config'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (data) => request('/auth/reset-password', { method: 'POST', body: data }),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Events
  sendEvent: (event) => request('/events', { method: 'POST', body: event }),

  // Incidents
  getIncidents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/incidents${qs ? '?' + qs : ''}`);
  },
  getIncident: (id) => request(`/incidents/${id}`),
  acknowledgeIncident: (id, data = {}) => request(`/incidents/${id}/acknowledge`, { method: 'POST', body: data }),
  resolveIncident: (id, data = {}) => request(`/incidents/${id}/resolve`, { method: 'POST', body: data }),
  assignIncident: (id, data) => request(`/incidents/${id}/assign`, { method: 'POST', body: data }),
  escalateIncident: (id) => request(`/incidents/${id}/escalate`, { method: 'POST', body: {} }),
  reopenIncident: (id) => request(`/incidents/${id}/reopen`, { method: 'POST', body: {} }),
  updateIncidentStatus: (id, status) => request(`/incidents/${id}/status`, { method: 'POST', body: { status } }),
  addIncidentNote: (id, message) => request(`/incidents/${id}/notes`, { method: 'POST', body: { message } }),
  updatePostmortem: (id, data) => request(`/incidents/${id}/postmortem`, { method: 'POST', body: data }),

  // Alerts
  getAlerts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/alerts${qs ? '?' + qs : ''}`);
  },

  // Services
  getServices: () => request('/services'),
  getService: (id) => request(`/services/${id}`),

  // Teams
  getTeams: () => request('/teams'),

  // Destinations
  getDestinations: () => request('/destinations'),
  createDestination: (data) => request('/destinations', { method: 'POST', body: data }),
  updateDestination: (id, data) => request(`/destinations/${id}`, { method: 'PUT', body: data }),
  deleteDestination: (id) => request(`/destinations/${id}`, { method: 'DELETE' }),
  testDestination: (id) => request(`/destinations/${id}/test`, { method: 'POST', body: {} }),

  // Rules
  getRules: () => request('/rules'),
  createRule: (data) => request('/rules', { method: 'POST', body: data }),
  updateRule: (id, data) => request(`/rules/${id}`, { method: 'PUT', body: data }),
  deleteRule: (id) => request(`/rules/${id}`, { method: 'DELETE' }),
  getRuleConflicts: (id) => request(`/rules/${id}/conflicts`),

  // Escalation policies
  getEscalationPolicies: () => request('/escalation-policies'),
  createEscalationPolicy: (data) => request('/escalation-policies', { method: 'POST', body: data }),
  updateEscalationPolicy: (id, data) => request(`/escalation-policies/${id}`, { method: 'PUT', body: data }),

  // On-call
  getOnCall: () => request('/oncall'),

  // Maintenance
  getMaintenance: () => request('/maintenance'),
  createMaintenance: (data) => request('/maintenance', { method: 'POST', body: data }),
  deleteMaintenance: (id) => request(`/maintenance/${id}`, { method: 'DELETE' }),

  // Analytics
  getAnalytics: () => request('/analytics'),

  // Audit log
  getAuditLog: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit-log${qs ? '?' + qs : ''}`);
  },

  // Search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // Notifications
  getNotifications: () => request('/notifications'),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST', body: {} }),

  // Users
  getUsers: () => request('/users'),

  // Notification policies
  getNotificationPolicies: () => request('/notification-policies'),
};

// WebSocket connection
let ws = null;
let wsListeners = new Set();
let reconnectTimer = null;
let shouldReconnect = true;

export function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  shouldReconnect = true;
  clearTimeout(reconnectTimer);

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const configuredWsHost = import.meta.env.VITE_WS_HOST;
  const wsHost = configuredWsHost || (isLocal
    ? `${window.location.hostname}:${window.location.port}`
    : 'alertflow-backend-production.up.railway.app');

  const protocol = isLocal && window.location.protocol !== 'https:' ? 'ws' : 'wss';

  try {
    ws = new WebSocket(`${protocol}://${wsHost}/ws`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const listener of wsListeners) {
          listener(data);
        }
      } catch {}
    };

    ws.onclose = (event) => {
      ws = null;
      if (shouldReconnect && event.code !== 1008) {
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch (err) {
    console.error('[WS] Connection error:', err);
  }
}

export function disconnectWebSocket() {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  if (ws) {
    try {
      ws.close(1000, 'User logged out');
    } catch {}
    ws = null;
  }
}

export function onWsMessage(listener) {
  wsListeners.add(listener);
  return () => wsListeners.delete(listener);
}
