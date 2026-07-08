import { createHash } from 'node:crypto';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getBackendFirestore } from '../db/firebase';

type PushTokenInput = {
  userId: string;
  token: string;
  platform?: string;
};

type ExpoPushMessage = {
  to: string;
  sound?: 'default';
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

function normalizeUserId(userId: string) {
  return String(userId || '').trim().toLowerCase();
}

function safeTokenId(token: string) {
  return createHash('sha1').update(token).digest('hex');
}

function isExpoPushToken(token: string) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(token || '').trim());
}

export async function registerExpoPushToken(input: PushTokenInput) {
  const userId = normalizeUserId(input.userId);
  const token = String(input.token || '').trim();
  if (!userId) throw new Error('로그인이 필요합니다.');
  if (!isExpoPushToken(token)) throw new Error('Expo Push Token 형식이 올바르지 않습니다.');

  const now = new Date().toISOString();
  const db = getBackendFirestore();
  const tokenRef = doc(db, 'users', userId, 'pushTokens', safeTokenId(token));
  const tokenDoc = {
    id: tokenRef.id,
    token,
    platform: String(input.platform || ''),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(tokenRef, tokenDoc, { merge: true });
  await setDoc(doc(db, 'users', userId), { lastPushTokenAt: now, updatedAt: now }, { merge: true });
  return tokenDoc;
}

async function loadEnabledPushTokens(userId: string) {
  const snapshot = await getDocs(collection(getBackendFirestore(), 'users', normalizeUserId(userId), 'pushTokens'));
  return snapshot.docs
    .map((item) => item.data() as any)
    .filter((item) => item.enabled !== false && isExpoPushToken(item.token))
    .map((item) => String(item.token));
}

async function sendExpoPushMessages(messages: ExpoPushMessage[]) {
  const chunks: ExpoPushMessage[][] = [];
  for (let index = 0; index < messages.length; index += 100) {
    chunks.push(messages.slice(index, index + 100));
  }

  const results = [];
  for (const chunk of chunks) {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    const payload = await response.json().catch(() => ({}));
    results.push({ ok: response.ok, status: response.status, payload });
  }
  return results;
}

export async function sendItinerarySharePushNotifications(input: {
  ownerNickname: string;
  recipientUserIds: string[];
  shareId: string;
  title: string;
}) {
  const recipientUserIds = Array.from(new Set((input.recipientUserIds || []).map(normalizeUserId))).filter(Boolean);
  const tokenGroups = await Promise.all(recipientUserIds.map(loadEnabledPushTokens));
  const tokens = Array.from(new Set(tokenGroups.flat()));
  if (!tokens.length) return { sent: 0, results: [] };

  const body = `${input.ownerNickname || '친구'}님이 일정을 공유했습니다.`;
  const messages = tokens.map((token) => ({
    to: token,
    sound: 'default' as const,
    title: '스팟로그',
    body,
    data: {
      type: 'itineraryShare',
      shareId: input.shareId,
      title: input.title,
    },
  }));

  const results = await sendExpoPushMessages(messages);
  return { sent: messages.length, results };
}
