import { sendGmailMessage, getGmailStatus } from '../connectors/gmail.js';

/**
 * Dispatches incident notification through direct Gmail API.
 */
export async function sendGmailNotification(db, config, template, incident, notificationType = 'alert') {
  const targetEmail = config.to_email || config.recipient;
  if (targetEmail && (targetEmail.endsWith('@demo.alertflow.io') || targetEmail.includes('@demo.') || targetEmail.includes('.demo@'))) {
    console.log(`[Gmail] Suppressing dispatch to demo user: ${targetEmail}`);
    return {
      success: true,
      suppressed: true,
      message: `Demo recipient ${targetEmail} suppressed to prevent external delivery`,
    };
  }

  // Find connected Gmail account
  const organizationId = incident?.organization_id || 'org-default';
  
  let connector = null;
  if (config.connector_id) {
    connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(config.connector_id);
  } else if (config.email) {
    connector = db.prepare(`
      SELECT * FROM connectors
      WHERE organization_id = ? AND provider = 'gmail' AND account_email = ? AND status = 'connected'
    `).get(organizationId, config.email.toLowerCase().trim());
  }

  if (!connector) {
    connector = db.prepare(`
      SELECT * FROM connectors
      WHERE organization_id = ? AND provider = 'gmail' AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId);
  }

  if (!connector) {
    return {
      success: false,
      error: 'No active Gmail OAuth connector found. Please connect your Gmail account in Destinations.',
    };
  }

  const severityColors = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    success: '#10b981',
  };

  let subject, html;
  const env = incident?.environment || template?.environment || 'Production';

  if (notificationType === 'recovery') {
    subject = `[RESOLVED] ${incident?.title || 'Incident'} — ${env}`;
    html = buildRecoveryHtml(incident, template, severityColors);
  } else if (notificationType === 'escalation') {
    subject = `[ESCALATION] ${incident?.title || 'Incident'} — ${env}`;
    html = buildEscalationHtml(incident, template, severityColors);
  } else {
    const prefix = incident?.severity === 'critical' ? 'CRITICAL' : incident?.severity === 'warning' ? 'WARNING' : 'INFO';
    subject = `[${prefix}] ${incident?.title || template?.subject || 'Incident'} — ${env}`;
    html = buildAlertHtml(incident, template, severityColors);
  }

  const to = config.to_email || config.recipient || connector.account_email;

  if (to && (to.endsWith('@demo.alertflow.io') || to.includes('@demo.'))) {
    console.log(`[Gmail] Suppressing dispatch to demo user: ${to}`);
    return {
      success: true,
      suppressed: true,
      message: `Demo recipient ${to} suppressed to prevent external delivery`,
    };
  }

  const result = await sendGmailMessage(db, connector, {
    to,
    subject,
    htmlText: html,
    plainText: template?.description || incident?.title || 'Incident notification from AlertFlow',
  });

  return result;
}

function buildAlertHtml(incident, template, colors) {
  const color = colors[incident?.severity] || colors.info;
  const service = incident?.service_name || template?.service || 'Infrastructure';
  const incidentNumber = incident?.incident_number ? `INC-${incident.incident_number}` : 'INC-ALERT';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 12px; overflow: hidden; border: 1px solid #1e293b; color: #f8fafc;">
      <div style="background: ${color}; padding: 18px 24px;">
        <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;">
          🚨 ${(incident?.severity || 'CRITICAL').toUpperCase()} INCIDENT: ${incidentNumber}
        </h2>
      </div>
      <div style="padding: 24px;">
        <h3 style="margin: 0 0 12px 0; color: #ffffff; font-size: 16px;">${incident?.title || template?.subject || 'Service Disruption'}</h3>
        <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 14px; line-height: 1.5;">${template?.description || 'An alert triggered an incident in AlertFlow requiring engineering response.'}</p>
        
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; width: 120px;">Service</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600;">${service}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Severity</td>
            <td style="padding: 8px 0; color: ${color}; font-weight: 700;">${(incident?.severity || 'critical').toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Priority</td>
            <td style="padding: 8px 0; color: #f8fafc;">${incident?.priority || 'P1'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Status</td>
            <td style="padding: 8px 0; color: #f8fafc; text-transform: uppercase;">${incident?.status || 'TRIGGERED'}</td>
          </tr>
        </table>

        <div style="text-align: center; margin-top: 16px;">
          <a href="https://alertflow-two.vercel.app/incidents" style="display: inline-block; background: #6366f1; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; font-size: 13px;">
            View in AlertFlow Dashboard →
          </a>
        </div>
      </div>
    </div>
  `;
}

function buildRecoveryHtml(incident, template, colors) {
  const service = incident?.service_name || template?.service || 'Infrastructure';
  const incidentNumber = incident?.incident_number ? `INC-${incident.incident_number}` : 'INC-RESOLVED';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 12px; overflow: hidden; border: 1px solid #1e293b; color: #f8fafc;">
      <div style="background: #10b981; padding: 18px 24px;">
        <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700;">
          ✅ INCIDENT RESOLVED: ${incidentNumber}
        </h2>
      </div>
      <div style="padding: 24px;">
        <h3 style="margin: 0 0 12px 0; color: #ffffff; font-size: 16px;">${incident?.title || 'Service Recovered'}</h3>
        <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 14px;">Telemetry has returned to nominal levels. The incident has been marked as resolved.</p>
        <p style="font-size: 13px; color: #64748b;">Service: <strong style="color: #f8fafc;">${service}</strong></p>
      </div>
    </div>
  `;
}

function buildEscalationHtml(incident, template, colors) {
  return buildAlertHtml(incident, template, colors);
}
