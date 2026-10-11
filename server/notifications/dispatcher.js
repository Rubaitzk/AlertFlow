import { v4 as uuidv4 } from 'uuid';
import { sendSlackNotification } from './slack.js';
import { sendEmailNotification } from './email.js';
import { sendGmailNotification } from './gmail.js';
import { getNotificationTemplate } from './templates.js';
import { retryDelivery } from './retry.js';

/**
 * Dispatch notifications to all configured destinations.
 * Tracks each delivery independently.
 */
export async function dispatchNotifications(db, incident, event, actions, notificationType = 'alert') {
  const destinations = db.prepare(`
    SELECT * FROM destinations
    WHERE organization_id = 'org-default' AND enabled = 1 AND status = 'connected'
  `).all();

  if (destinations.length === 0) {
    console.log('[Notifications] No connected destinations configured');
    return [{ type: 'none', status: 'skipped', error: 'No destinations configured' }];
  }

  // Get notification policy for this severity (for recovery, use incident severity)
  const severity = incident?.severity || event?.severity || 'info';
  const policy = db.prepare(`
    SELECT * FROM notification_policies
    WHERE organization_id = 'org-default' AND severity = ? AND enabled = 1
  `).get(severity);

  const channels = policy ? JSON.parse(policy.channels) : { slack: true, email: true, in_app: true };

  const results = [];

  for (const dest of destinations) {
    // Check if this channel type is enabled for this severity
    if (dest.type === 'slack' && !channels.slack) continue;
    if ((dest.type === 'email' || dest.type === 'gmail') && !channels.email) continue;

    const deliveryId = uuidv4();
    const template = getNotificationTemplate(notificationType, incident, event);
    const eventId = event?.event_id || (notificationType === 'recovery' && incident?.id ? `rec_${incident.id}` : null);

    // Record delivery attempt
    db.prepare(`
      INSERT INTO deliveries (id, alert_id, incident_id, destination_id, destination_type, status, attempts, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(deliveryId, eventId, incident?.id || null, dest.id, dest.type, 'sending', 1, new Date().toISOString());

    try {
      let result;
      let config = {};
      try {
        config = typeof dest.configuration === 'string' ? JSON.parse(dest.configuration) : (dest.configuration || {});
        if (typeof config === 'string') config = JSON.parse(config);
      } catch {}

      if (dest.type === 'slack') {
        result = await sendSlackNotification(config, template, incident, event, notificationType);
      } else if (dest.type === 'gmail') {
        result = await sendGmailNotification(db, config, template, incident, notificationType);
      } else if (dest.type === 'email') {
        result = await sendEmailNotification(config, template, incident, notificationType);
      }

      if (result?.success) {
        db.prepare(`
          UPDATE deliveries SET status = 'delivered', delivered_at = ? WHERE id = ?
        `).run(new Date().toISOString(), deliveryId);

        db.prepare(`
          UPDATE destinations SET last_success_at = ? WHERE id = ?
        `).run(new Date().toISOString(), dest.id);

        results.push({ delivery_id: deliveryId, destination_type: dest.type, status: 'delivered' });
      } else {
        throw new Error(result?.error || 'Delivery failed');
      }
    } catch (err) {
      console.error(`[Notifications] ${dest.type} delivery failed:`, err.message);

      db.prepare(`
        UPDATE deliveries SET status = 'failed', last_error = ?, attempts = 1 WHERE id = ?
      `).run(err.message, deliveryId);

      db.prepare(`
        UPDATE destinations SET last_failure_at = ? WHERE id = ?
      `).run(new Date().toISOString(), dest.id);

      // Attempt retry
      const retryResult = await retryDelivery(db, deliveryId, dest, template, incident, notificationType);

      if (retryResult.success) {
        results.push({ delivery_id: deliveryId, destination_type: dest.type, status: 'delivered', retried: true });
      } else {
        // Try fallback
        const fallbackResult = await tryFallback(db, dest, destinations, template, incident, event, notificationType);
        results.push({
          delivery_id: deliveryId,
          destination_type: dest.type,
          status: 'failed',
          error: err.message,
          fallback: fallbackResult,
        });
      }
    }
  }

  return results;
}

async function tryFallback(db, failedDest, allDestinations, template, incident, event, notificationType) {
  // Find a destination of a different type as fallback
  const fallback = allDestinations.find(d => d.type !== failedDest.type && d.enabled && d.status === 'connected');
  if (!fallback) return null;

  const deliveryId = uuidv4();

  db.prepare(`
    INSERT INTO deliveries (id, alert_id, incident_id, destination_id, destination_type, status, attempts, is_fallback, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deliveryId, event?.event_id || null, incident?.id || null, fallback.id, fallback.type, 'sending', 1, 1, new Date().toISOString());

  try {
    let result;
    const config = JSON.parse(fallback.configuration || '{}');

    if (fallback.type === 'slack') {
      result = await sendSlackNotification(config, template, incident, event, notificationType);
    } else if (fallback.type === 'gmail') {
      result = await sendGmailNotification(db, config, template, incident, notificationType);
    } else if (fallback.type === 'email') {
      result = await sendEmailNotification(config, template, incident, notificationType);
    }

    if (result?.success) {
      db.prepare(`
        UPDATE deliveries SET status = 'delivered', delivered_at = ? WHERE id = ?
      `).run(new Date().toISOString(), deliveryId);
      return { type: fallback.type, status: 'delivered', delivery_id: deliveryId };
    }
  } catch (err) {
    db.prepare(`
      UPDATE deliveries SET status = 'failed', last_error = ? WHERE id = ?
    `).run(err.message, deliveryId);
  }

  return null;
}
