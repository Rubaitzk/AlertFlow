import { sendSlackNotification } from './slack.js';
import { sendEmailNotification } from './email.js';
import { sendGmailNotification } from './gmail.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // Exponential backoff

/**
 * Retry a failed delivery with exponential backoff.
 */
export async function retryDelivery(db, deliveryId, destination, template, incident, notificationType) {
  const config = JSON.parse(destination.configuration || '{}');

  for (let attempt = 2; attempt <= MAX_RETRIES; attempt++) {
    // Wait before retrying
    await sleep(RETRY_DELAYS[attempt - 2] || 5000);

    // Update attempt count
    db.prepare('UPDATE deliveries SET attempts = ?, status = ? WHERE id = ?')
      .run(attempt, 'retrying', deliveryId);

    try {
      let result;
      if (destination.type === 'slack') {
        result = await sendSlackNotification(config, template, incident, notificationType);
      } else if (destination.type === 'gmail') {
        result = await sendGmailNotification(db, config, template, incident, notificationType);
      } else if (destination.type === 'email') {
        result = await sendEmailNotification(config, template, incident, notificationType);
      }

      if (result?.success) {
        db.prepare('UPDATE deliveries SET status = ?, delivered_at = ?, attempts = ? WHERE id = ?')
          .run('delivered', new Date().toISOString(), attempt, deliveryId);
        return { success: true, attempts: attempt };
      }
    } catch (err) {
      db.prepare('UPDATE deliveries SET last_error = ?, attempts = ? WHERE id = ?')
        .run(err.message, attempt, deliveryId);
    }
  }

  // All retries failed
  db.prepare('UPDATE deliveries SET status = ? WHERE id = ?').run('failed', deliveryId);
  return { success: false, attempts: MAX_RETRIES };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
