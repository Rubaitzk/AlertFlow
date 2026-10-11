/**
 * Direct Slack Connector Integration
 * Supports both Slack Incoming Webhooks (https://hooks.slack.com/services/...)
 * and Slack Bot Tokens (chat.postMessage) without requiring any intermediary.
 */

const SLACK_API_CHAT_POST_MESSAGE = 'https://slack.com/api/chat.postMessage';

/**
 * Sends a message directly to Slack.
 */
export async function sendDirectSlackMessage({ webhookUrl, botToken, channel, text, blocks, options = {} }) {
  if (options.simulateFailure) {
    return { success: false, error: 'Simulated Slack delivery failure' };
  }

  // 1. If a Slack Bot Token (xoxb-...) is provided, use Slack Web API directly
  const token = botToken || (process.env.SLACK_BOT_TOKEN ? process.env.SLACK_BOT_TOKEN.trim() : null);
  const targetChannel = channel || '#incidents';

  if (token && token.startsWith('xox')) {
    try {
      const response = await fetch(SLACK_API_CHAT_POST_MESSAGE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: targetChannel,
          text,
          blocks,
        }),
      });

      const data = await response.json();
      if (!data.ok) {
        return { success: false, error: `Slack API error: ${data.error || 'Failed to send message'}` };
      }

      return { success: true, ts: data.ts, channel: data.channel };
    } catch (err) {
      return { success: false, error: `Slack API connection error: ${err.message}` };
    }
  }

  // 2. Incoming Webhook delivery
  let url = webhookUrl;
  if (!url) {
    url = process.env.SLACK_WEBHOOK_URL;
  }

  if (!url) {
    return { success: false, error: 'No Slack webhook URL or bot token configured' };
  }

  // Clean URL if wrapped in curl or extra quotes
  if (typeof url === 'string' && url.trim().startsWith('curl')) {
    const match = url.match(/https?:\/\/[^\s"'\\]+/);
    if (match) url = match[0];
  }

  try {
    const payload = {
      text,
      blocks,
    };

    // If channel is specified and supported by webhook
    if (channel) {
      payload.channel = channel;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseText = await response.text();

    // Standard Slack Incoming Webhook responds with 200 "ok"
    if (response.ok && (responseText === 'ok' || responseText.includes('"ok":true') || responseText.length === 0)) {
      return { success: true };
    }

    // Try parsing as JSON error
    try {
      const json = JSON.parse(responseText);
      if (json.ok) return { success: true, ts: json.ts };
      return { success: false, error: json.error || `Slack HTTP ${response.status}` };
    } catch {
      return { success: false, error: `Slack delivery failed (${response.status}): ${responseText.substring(0, 100)}` };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Slack webhook request timed out' };
    }
    return { success: false, error: `Slack delivery error: ${err.message}` };
  }
}
