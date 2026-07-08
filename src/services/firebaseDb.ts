import { initializeApp, getApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Place } from '../types';

const FIREBASE_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const;

function readEnv(key: string) {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
  return env[`VITE_${key}`] || env[`EXPO_PUBLIC_${key}`] || '';
}

function getFirebaseConfig(): FirebaseOptions | null {
  const config = {
    apiKey: readEnv('FIREBASE_API_KEY'),
    authDomain: readEnv('FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('FIREBASE_APP_ID'),
    measurementId: readEnv('FIREBASE_MEASUREMENT_ID'),
  };

  const hasRequiredConfig = FIREBASE_KEYS.every((key) => Boolean(config[key]));
  return hasRequiredConfig ? config : null;
}

function getDb(): Firestore | null {
  const config = getFirebaseConfig();
  if (!config) return null;

  const app = getApps().length ? getApp() : initializeApp(config);
  return getFirestore(app);
}

function placesCollection(db: Firestore) {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
  const workspaceId = env.VITE_FIREBASE_WORKSPACE_ID || env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
  return collection(db, 'workspaces', workspaceId, 'places');
}

function normalizePlace(raw: any): Place {
  return {
    id: String(raw.id || `place-${Date.now()}`),
    name: String(raw.name || ''),
    category: raw.category,
    address: String(raw.address || ''),
    latitude: Number(raw.latitude || 37.5446),
    longitude: Number(raw.longitude || 127.0559),
    hours: String(raw.hours || ''),
    menu: Array.isArray(raw.menu) ? raw.menu : [],
    reviewSummary: String(raw.reviewSummary || ''),
    screenshotText: String(raw.screenshotText || ''),
    originalImage: raw.originalImage,
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

function serializePlace(place: Place) {
  const originalImage =
    place.originalImage && place.originalImage.length < 650_000 ? place.originalImage : undefined;

  return {
    ...place,
    originalImage,
    updatedAt: new Date().toISOString(),
  };
}

export function isFirebaseDbConfigured() {
  return Boolean(getFirebaseConfig());
}

export async function loadPlacesFromFirestore(): Promise<Place[]> {
  const db = getDb();
  if (!db) return [];

  const snapshot = await getDocs(query(placesCollection(db), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item) => normalizePlace({ id: item.id, ...item.data() }));
}

export async function savePlaceToFirestore(place: Place) {
  const db = getDb();
  if (!db) return;

  await setDoc(doc(placesCollection(db), place.id), serializePlace(place), { merge: true });
}

export async function deletePlaceFromFirestore(placeId: string) {
  const db = getDb();
  if (!db) return;

  await deleteDoc(doc(placesCollection(db), placeId));
}

export async function replacePlacesInFirestore(places: Place[]) {
  const db = getDb();
  if (!db) return;

  const batch = writeBatch(db);
  const current = await getDocs(placesCollection(db));
  current.docs.forEach((item) => batch.delete(item.ref));
  places.forEach((place) => {
    batch.set(doc(placesCollection(db), place.id), serializePlace(place));
  });
  await batch.commit();
}
