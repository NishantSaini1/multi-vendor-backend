import axios from 'axios';
import { logger } from '../utils/logger';
import type { SendPushResult } from './onesignal';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo accepts at most 100 messages per request.
const BATCH_SIZE = 100;

// The Expo apps (vendor/customer) register an Expo push token in
// NotificationDevice.playerId rather than a OneSignal player id —
// notification.service uses this to route each device to the right sender.
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

export interface ExpoPushOptions {
  // Android notification channel created by the app (controls sound,
  // importance, vibration) — e.g. the vendor app's 'new-orders' siren channel.
  channelId?: string;
  // iOS sound file bundled with the app, or 'default'.
  sound?: string;
}

interface SendExpoPushParams extends ExpoPushOptions {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Same contract as onesignal.sendPush: never throws, returns a result the
// caller records on the Notification for the retry job.
export async function sendExpoPush({ tokens, title, body, data, channelId, sound }: SendExpoPushParams): Promise<SendPushResult> {
  if (tokens.length === 0) return 'skipped';

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    data,
    priority: 'high',
    sound: sound ?? 'default',
    ...(channelId ? { channelId } : {}),
  }));

  try {
    let anyOk = false;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const res = await axios.post(EXPO_PUSH_URL, messages.slice(i, i + BATCH_SIZE), {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      const tickets: { status: string; message?: string }[] = res.data?.data ?? [];
      tickets.forEach((t) => {
        if (t.status === 'ok') anyOk = true;
        else logger.warn({ ticket: t }, 'Expo push ticket error');
      });
    }
    return anyOk ? 'sent' : 'failed';
  } catch (err) {
    logger.error({ err }, 'Expo push notification failed');
    return 'failed';
  }
}
