import axios from 'axios';
import { env } from './env';
import { logger } from '../utils/logger';

const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';

export function isOneSignalConfigured(): boolean {
  return Boolean(env.ONESIGNAL_APP_ID && env.ONESIGNAL_API_KEY);
}

interface SendPushParams {
  playerIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type SendPushResult = 'sent' | 'skipped' | 'failed';

// Sends a push via OneSignal's REST API (no server SDK needed for this —
// it's a single authenticated POST). Deliberately never throws: a push
// failure (OneSignal down, bad credentials, a stale player id) must never
// break the caller's underlying operation (order creation, payment
// confirmation, ...) — the in-app Notification record, written separately
// in notification.service, is the source of truth regardless of whether the
// push itself lands. The returned result lets the caller record push
// status (see Notification.pushStatus) for the retry job to act on later —
// this module itself stays provider-specific and knows nothing about that
// domain model.
export async function sendPush({ playerIds, title, body, data }: SendPushParams): Promise<SendPushResult> {
  if (!isOneSignalConfigured()) {
    logger.warn('OneSignal not configured; push notification skipped (in-app record still created)');
    return 'skipped';
  }
  if (playerIds.length === 0) return 'skipped';

  try {
    await axios.post(
      ONESIGNAL_API_URL,
      {
        app_id: env.ONESIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings: { en: title },
        contents: { en: body },
        ...(data ? { data } : {}),
      },
      {
        headers: {
          // OneSignal's REST API key, sent as a Basic-scheme bearer value
          // (this is the long-standing convention for their Notifications
          // endpoint — not actual HTTP Basic user:pass encoding).
          Authorization: `Basic ${env.ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
    return 'sent';
  } catch (err) {
    logger.error({ err }, 'OneSignal push notification failed');
    return 'failed';
  }
}
