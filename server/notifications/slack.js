import { sendDirectSlackMessage } from '../connectors/slack.js';

/**
 * Slack notification sender with direct Slack API & Incoming Webhook support.
 */
export async function sendSlackNotification(config, template, incident, eventOrType = 'alert', maybeType, options = {}) {
  const notificationType = typeof eventOrType === 'string' ? eventOrType : (maybeType || 'alert');
  const event = typeof eventOrType === 'object' ? eventOrType : null;
  const testMode = options.testMode === true;

  // Primary: configured webhook URL or Slack Bot Token
  let webhookUrl = config.webhook_url;
  const botToken = config.bot_token || process.env.SLACK_BOT_TOKEN;

  // Fallback to environment variables if not specified in config
  if (!webhookUrl && !botToken) {
    webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.FASTN_NOTIFICATION_WEBHOOK_URL;
  }

  if (!webhookUrl && !botToken) {
    return { success: false, error: 'No Slack webhook URL or bot token configured' };
  }

  // Determine if we should simulate failure (for demo purposes)
  if (config.simulate_failure) {
    return { success: false, error: 'Simulated Slack delivery failure' };
  }

  let authHeader = config.auth_header 
    || (config.api_key ? `Bearer ${config.api_key}` : null)
    || (process.env.ALERTOPS_SLACK_CONNECTOR_API_KEY ? `Bearer ${process.env.ALERTOPS_SLACK_CONNECTOR_API_KEY}` : null);
  let extraHeaders = {};

  // Check if user pasted a full curl command into webhook_url
  if (typeof webhookUrl === 'string' && webhookUrl.trim().startsWith('curl')) {
    const urlMatch = webhookUrl.match(/https?:\/\/[^\s"'\\]+/);
    const authMatch = webhookUrl.match(/-H\s+["']Authorization:\s*([^"']+)["']/i);
    const testModeMatch = webhookUrl.match(/-H\s+["'](X-fastn-Test-Mode:\s*[^"']+)["']/i);
    const envMatch = webhookUrl.match(/-H\s+["'](x-fastn-env:\s*[^"']+)["']/i);

    if (urlMatch) webhookUrl = urlMatch[0];
    if (authMatch) authHeader = authMatch[1];
    if (testModeMatch) extraHeaders['X-fastn-Test-Mode'] = 'true';
    if (envMatch) extraHeaders['x-fastn-env'] = 'test';
  }

  const severityEmoji = {
    critical: '🚨',
    warning: '⚠️',
    info: 'ℹ️',
    success: '✅',
  };

  const severityColor = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    success: '#10b981',
  };

  let blocks;

  if (notificationType === 'recovery') {
    blocks = buildRecoverySlackBlocks(incident, template);
  } else if (notificationType === 'escalation') {
    blocks = buildEscalationSlackBlocks(incident, template);
  } else {
    blocks = buildAlertSlackBlocks(incident, template, severityEmoji, severityColor);
  }

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (authHeader) {
    const cleanAuth = authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    headers['Authorization'] = cleanAuth;
  }

  // Only set test-mode headers when explicitly requested (e.g., from the test connection button)
  if (testMode) {
    headers['X-fastn-Test-Mode'] = 'true';
    headers['x-fastn-env'] = 'test';
    console.log('[Slack] Test mode enabled — sending with X-fastn-Test-Mode headers');
  }

  const isRecovery = notificationType === 'recovery';
  const service = event?.service || incident?.service_name || template?.service || 'System';
  const environment = event?.environment || incident?.environment || template?.environment || 'production';
  const priority = incident?.priority || event?.priority || template?.priority || 'P1';
  const incidentNumber = incident?.incident_number ? (String(incident.incident_number).startsWith('INC-') ? incident.incident_number : `INC-${incident.incident_number}`) : 'INC-NEW';
  const incidentId = incident?.id || event?.incident_id || `inc_${Date.now()}`;
  const eventId = event?.event_id || (isRecovery ? `rec_${incidentId}` : incidentId);
  const alertId = event?.alert_id || null;
  const timestamp = new Date().toISOString();
  const slackChannel = config.slack_channel || '#incidents';

  // Direct Slack integration branch (Incoming Webhooks or Bot Token)
  const isFastnWorkflow = typeof webhookUrl === 'string' && webhookUrl.includes('fastn.dev');
  const isDirectSlack = Boolean(botToken || (webhookUrl && (webhookUrl.includes('hooks.slack.com') || !isFastnWorkflow)));

  if (isDirectSlack) {
    const directText = isRecovery
      ? (template?.subject || `✅ [RESOLVED] ${incidentNumber}: ${incident?.title || template?.subject || `${service} — Incident Resolved`}`)
      : (template?.subject || incident?.title || `${service} — ${event?.description || template?.description || 'Incident notification'}`);

    console.log(`[Slack] Direct dispatch: botToken=${Boolean(botToken)} webhook=${webhookUrl ? webhookUrl.substring(0, 40) + '...' : 'none'} channel=${slackChannel} type=${notificationType}`);
    return await sendDirectSlackMessage({
      webhookUrl: isFastnWorkflow ? null : webhookUrl,
      botToken,
      channel: slackChannel,
      text: directText,
      blocks,
      options: { simulateFailure: config.simulate_failure }
    });
  }

  let severity, value, threshold, source, event_type, description, status, title;

  if (isRecovery) {
    event_type = 'recovery';
    value = 'resolved';
    severity = 'resolved';
    status = 'resolved';
    threshold = event?.threshold !== undefined ? String(event.threshold) : 'normal';
    source = event?.source || 'AlertOps Incident Engine';
    const metric = event?.metric || event?.metric_name || 'System Health';
    description = incident?.title ? `Resolved: ${incident.title}` : (template?.description || 'Incident resolved');
    title = incident?.title || template?.subject || `${service} — Incident Resolved`;

    console.log(`[RECOVERY] incident=${incidentId} event_type=recovery status=resolved`);

    // Payload structure supporting both standard Slack webhooks (blocks, text) and Fastn workflows (input)
    const body = {
      blocks,
      text: template?.subject || `✅ [RESOLVED] ${incidentNumber}: ${title}`,
      input: {
        incident_id: incidentNumber,
        title,
        service,
        environment,
        severity,
        priority,
        description,
        status,
        timestamp,
        slack_channel: slackChannel,
        is_outbound_loopback: true, // Tell AlertOps to bypass incident creation and return is_new_incident=true
        value,
        metric,
        source,
        event_id: eventId,
        alert_id: alertId,
        incident_number: incidentNumber,
        threshold,
        event_type,
      },
      value,
      metric,
      source,
      service,
      event_id: eventId,
      alert_id: alertId,
      incident_id: incidentId,
      incident_number: incidentNumber,
      title,
      severity,
      threshold,
      event_type,
      description,
      environment,
      priority,
      status,
    };

    try {
      console.log(`[Slack] RECOVERY dispatch: url=${webhookUrl.substring(0, 60)}... testMode=${testMode} incident=${incidentNumber} payload_keys=${Object.keys(body.input || {}).join(',')}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      console.log(`[Slack] RECOVERY response: status=${response.status} body=${responseText.substring(0, 200)}`);

      if (response.ok) {
        console.log(`[RECOVERY] notification dispatched for incident=${incidentId}`);
        return { success: true };
      } else {
        return { success: false, error: `Slack/Fastn API error: ${response.status} - ${responseText}` };
      }
    } catch (err) {
      console.error(`[Slack] RECOVERY fetch error: ${err.message}`);
      return { success: false, error: `Slack delivery error: ${err.message}` };
    }
  }

  // Normal alert / escalation payload
  severity = (incident?.severity || event?.severity || template?.severity || 'critical');
  status = incident?.status || 'triggered';
  value = event?.value !== undefined ? String(event.value) : 'triggered';
  threshold = event?.threshold !== undefined ? String(event.threshold) : 'threshold_exceeded';
  source = event?.source || 'Infrastructure Monitor';
  const metric = event?.metric || event?.metric_name || 'System Alert';
  event_type = event?.event_type || 'cpu_threshold';
  description = event?.description || template?.description || incident?.title || 'Incident notification';
  title = incident?.title || template?.subject || `${service} — ${description}`;

  // Payload structure supporting both standard Slack webhooks (blocks, text) and Fastn workflows (input)
  const body = {
    blocks,
    text: template?.subject || incident?.title || `${service} — ${description}`,
    input: {
      incident_id: incidentNumber,
      title,
      service,
      environment,
      severity,
      priority,
      description,
      status,
      timestamp,
      slack_channel: slackChannel,
      is_outbound_loopback: true, // Tell AlertOps to bypass incident creation and return is_new_incident=true
      value,
      metric,
      source,
      event_id: eventId,
      alert_id: alertId,
      incident_number: incidentNumber,
      threshold,
      event_type,
    },
    value,
    metric,
    source,
    service,
    event_id: eventId,
    alert_id: alertId,
    incident_id: incidentId,
    incident_number: incidentNumber,
    title,
    severity,
    threshold,
    event_type,
    description,
    environment,
    priority,
    status,
  };

  try {
    console.log(`[Slack] ALERT dispatch: url=${webhookUrl.substring(0, 60)}... testMode=${testMode} type=${notificationType} incident=${incidentNumber} payload_keys=${Object.keys(body.input || {}).join(',')}`);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    console.log(`[Slack] ALERT response: status=${response.status} body=${responseText.substring(0, 200)}`);

    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `Slack/Fastn API error: ${response.status} - ${responseText}` };
    }
  } catch (err) {
    console.error(`[Slack] ALERT fetch error: ${err.message}`);
    return { success: false, error: `Slack delivery error: ${err.message}` };
  }
}

function buildAlertSlackBlocks(incident, template, severityEmoji, severityColor) {
  const emoji = severityEmoji[incident?.severity] || '🔔';
  const color = severityColor[incident?.severity] || '#6366f1';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${template.subject}`, emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Service:*\n${template.service || 'N/A'}` },
        { type: 'mrkdwn', text: `*Environment:*\n${template.environment || 'N/A'}` },
        { type: 'mrkdwn', text: `*Severity:*\n${(incident?.severity || 'info').toUpperCase()}` },
        { type: 'mrkdwn', text: `*Priority:*\n${incident?.priority || 'P3'}` },
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Description:*\n${template.description || 'No description available.'}` }
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `📋 Incident: *INC-${incident?.incident_number || '?'}* | 🕐 ${new Date().toLocaleTimeString()} | AlertOps` }
      ]
    },
    { type: 'divider' },
  ];
}

function buildRecoverySlackBlocks(incident, template) {
  const duration = incident?.started_at && incident?.resolved_at
    ? formatDuration(new Date(incident.started_at), new Date(incident.resolved_at))
    : 'N/A';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `✅ RESOLVED — ${incident?.title || 'Incident'}`, emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Service:*\n${template.service || 'N/A'}` },
        { type: 'mrkdwn', text: `*Environment:*\n${template.environment || 'N/A'}` },
        { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
        { type: 'mrkdwn', text: `*Incident:*\nINC-${incident?.incident_number || '?'}` },
      ]
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `✅ Resolved at ${new Date().toLocaleTimeString()} | AlertOps` }
      ]
    },
    { type: 'divider' },
  ];
}

function buildEscalationSlackBlocks(incident, template) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🔺 ESCALATION — ${incident?.title || 'Incident'}`, emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `Incident *INC-${incident?.incident_number || '?'}* has been escalated because it was not acknowledged within the required time.` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Severity:*\n${(incident?.severity || 'info').toUpperCase()}` },
        { type: 'mrkdwn', text: `*Priority:*\n${incident?.priority || 'P3'}` },
      ]
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `🔺 Escalated at ${new Date().toLocaleTimeString()} | AlertOps` }
      ]
    },
    { type: 'divider' },
  ];
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
