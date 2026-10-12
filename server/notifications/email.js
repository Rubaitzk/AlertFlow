import nodemailer from 'nodemailer';

/**
 * Email notification sender using Nodemailer SMTP.
 */
export async function sendEmailNotification(config, template, incident, notificationType = 'alert') {
  const toEmail = config.to_email || config.email;
  if (toEmail && (toEmail.endsWith('@demo.alertflow.io') || toEmail.includes('@demo.') || toEmail.includes('.demo@'))) {
    console.log(`[Email] Suppressing dispatch to demo user: ${toEmail}`);
    return {
      success: true,
      suppressed: true,
      message: `Demo recipient ${toEmail} suppressed to prevent external delivery`,
    };
  }

  if (!config.smtp_host && !config.service) {
    return { success: false, error: 'No SMTP configuration found' };
  }

  const transportConfig = {};

  if (config.service === 'gmail') {
    transportConfig.service = 'gmail';
    transportConfig.auth = {
      user: config.email,
      pass: config.app_password,
    };
  } else {
    transportConfig.host = config.smtp_host;
    transportConfig.port = config.smtp_port || 587;
    transportConfig.secure = config.smtp_secure || false;
    if (config.smtp_user) {
      transportConfig.auth = {
        user: config.smtp_user,
        pass: config.smtp_pass,
      };
    }
  }

  try {
    const transporter = nodemailer.createTransport(transportConfig);

    const severityColors = {
      critical: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
      success: '#10b981',
    };

    let subject, html;

    if (notificationType === 'recovery') {
      subject = `[RESOLVED] ${incident?.title || 'Incident'} — ${incident?.environment || 'Production'}`;
      html = buildRecoveryEmailHtml(incident, template, severityColors);
    } else if (notificationType === 'escalation') {
      subject = `[ESCALATION] ${incident?.title || 'Incident'} — ${incident?.environment || 'Production'}`;
      html = buildEscalationEmailHtml(incident, template, severityColors);
    } else {
      const prefix = incident?.severity === 'critical' ? 'CRITICAL' : incident?.severity === 'warning' ? 'WARNING' : 'INFO';
      subject = `[${prefix}] ${incident?.title || template.subject} — ${template.environment || 'Production'}`;
      html = buildAlertEmailHtml(incident, template, severityColors);
    }

    const toEmail = config.to_email || config.email;
    if (toEmail && (toEmail.endsWith('@demo.alertflow.io') || toEmail.includes('@demo.'))) {
      console.log(`[Email] Suppressing dispatch to demo user: ${toEmail}`);
      return {
        success: true,
        suppressed: true,
        message: `Demo recipient ${toEmail} suppressed to prevent external delivery`,
      };
    }

    const mailOptions = {
      from: config.from_email || config.email || 'alertops@acme.dev',
      to: toEmail,
      subject,
      html,
    };

    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Email delivery error: ${err.message}` };
  }
}

function buildAlertEmailHtml(incident, template, colors) {
  const color = colors[incident?.severity] || colors.info;
  const duration = incident?.started_at ? formatDuration(new Date(incident.started_at), new Date()) : 'N/A';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${color}; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 18px;">
          ${incident?.severity === 'critical' ? '🚨' : '⚠️'} ${(incident?.severity || 'INFO').toUpperCase()} INCIDENT
        </h1>
      </div>
      <div style="background: #1a1a2e; padding: 24px; border: 1px solid #2d2d4a; border-top: none; border-radius: 0 0 8px 8px; color: #e2e8f0;">
        <h2 style="margin: 0 0 16px 0; color: white;">${incident?.title || template.subject}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #94a3b8; width: 120px;">Service</td>
            <td style="padding: 8px 0; color: white;">${template.service || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Environment</td>
            <td style="padding: 8px 0; color: white;">${template.environment || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Severity</td>
            <td style="padding: 8px 0; color: ${color}; font-weight: 600;">${(incident?.severity || 'info').toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Priority</td>
            <td style="padding: 8px 0; color: white;">${incident?.priority || 'P3'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Incident</td>
            <td style="padding: 8px 0; color: white;">INC-${incident?.incident_number || '?'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Status</td>
            <td style="padding: 8px 0; color: white;">${incident?.status || 'Triggered'}</td>
          </tr>
        </table>
        <div style="margin-top: 16px; padding: 12px; background: #0f0f23; border-radius: 6px; border-left: 3px solid ${color};">
          <p style="margin: 0; color: #cbd5e1;">${template.description || 'No description available.'}</p>
        </div>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #2d2d4a; color: #64748b; font-size: 12px;">
          AlertOps — Incident Management
        </div>
      </div>
    </div>
  `;
}

function buildRecoveryEmailHtml(incident, template, colors) {
  const duration = incident?.started_at && incident?.resolved_at
    ? formatDuration(new Date(incident.started_at), new Date(incident.resolved_at))
    : 'N/A';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${colors.success}; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 18px;">✅ RESOLVED</h1>
      </div>
      <div style="background: #1a1a2e; padding: 24px; border: 1px solid #2d2d4a; border-top: none; border-radius: 0 0 8px 8px; color: #e2e8f0;">
        <h2 style="margin: 0 0 16px 0; color: white;">${incident?.title || 'Incident Resolved'}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #94a3b8; width: 120px;">Service</td><td style="padding: 8px 0; color: white;">${template.service || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #94a3b8;">Environment</td><td style="padding: 8px 0; color: white;">${template.environment || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #94a3b8;">Incident</td><td style="padding: 8px 0; color: white;">INC-${incident?.incident_number || '?'}</td></tr>
          <tr><td style="padding: 8px 0; color: #94a3b8;">Duration</td><td style="padding: 8px 0; color: ${colors.success}; font-weight: 600;">${duration}</td></tr>
        </table>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #2d2d4a; color: #64748b; font-size: 12px;">
          AlertOps — Incident Management
        </div>
      </div>
    </div>
  `;
}

function buildEscalationEmailHtml(incident, template, colors) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${colors.warning}; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 18px;">🔺 ESCALATION</h1>
      </div>
      <div style="background: #1a1a2e; padding: 24px; border: 1px solid #2d2d4a; border-top: none; border-radius: 0 0 8px 8px; color: #e2e8f0;">
        <h2 style="margin: 0 0 16px 0; color: white;">${incident?.title || 'Incident Escalated'}</h2>
        <p style="color: #cbd5e1;">This incident was escalated because it was not acknowledged within the required time.</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #94a3b8; width: 120px;">Incident</td><td style="padding: 8px 0; color: white;">INC-${incident?.incident_number || '?'}</td></tr>
          <tr><td style="padding: 8px 0; color: #94a3b8;">Severity</td><td style="padding: 8px 0; color: ${colors[incident?.severity] || colors.warning}; font-weight: 600;">${(incident?.severity || 'warning').toUpperCase()}</td></tr>
          <tr><td style="padding: 8px 0; color: #94a3b8;">Priority</td><td style="padding: 8px 0; color: white;">${incident?.priority || 'P3'}</td></tr>
        </table>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #2d2d4a; color: #64748b; font-size: 12px;">
          AlertOps — Incident Management
        </div>
      </div>
    </div>
  `;
}

function formatDuration(start, end) {
  const diffMs = end - start;
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
