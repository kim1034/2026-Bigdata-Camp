import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

const requiredKeys = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

function getConfig() {
  const env = process.env;
  const ready = requiredKeys.every((key) => Boolean(env[key]));
  if (!ready) return null;

  return {
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
    measurementId: env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

function getDb() {
  const config = getConfig();
  if (!config) return null;
  const app = getApps().length ? getApp() : initializeApp(config);
  return getFirestore(app);
}

function placesCollection(db) {
  const workspaceId = process.env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
  return collection(db, 'workspaces', workspaceId, 'places');
}

function serializePlace(place) {
  const originalImage =
    place.originalImage && place.originalImage.length < 650000 ? place.originalImage : undefined;

  return {
    ...place,
    originalImage,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePlace(raw) {
  return {
    id: String(raw.id || `place-${Date.now()}`),
    name: String(raw.name || ''),
    category: String(raw.category || '카페'),
    address: String(raw.address || ''),
    latitude: Number(raw.latitude || 37.5446),
    longitude: Number(raw.longitude || 127.0559),
    hours: String(raw.hours || ''),
    menu: raw.menu || '',
    reviewSummary: String(raw.reviewSummary || ''),
    screenshotText: String(raw.screenshotText || ''),
    originalImage: raw.originalImage,
    confidence: Number(raw.confidence || 0.85),
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

export function isFirebaseDbConfigured() {
  return Boolean(getConfig());
}

export async function loadPlacesFromFirestore() {
  const db = getDb();
  if (!db) return [];
  const snapshot = await getDocs(query(placesCollection(db), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item) => normalizePlace({ id: item.id, ...item.data() }));
}

export async function savePlaceToFirestore(place) {
  const db = getDb();
  if (!db) return;
  await setDoc(doc(placesCollection(db), place.id), serializePlace(place), { merge: true });
}
