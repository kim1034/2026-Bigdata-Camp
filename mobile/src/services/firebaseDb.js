import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  collection,
  deleteDoc,
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

function collectionsCollection(db) {
  const workspaceId = process.env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
  return collection(db, 'workspaces', workspaceId, 'collections');
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
    pinColor: raw.pinColor,
    collectionIds: Array.isArray(raw.collectionIds) ? raw.collectionIds : [],
  };
}

function serializeCollection(item) {
  return {
    ...item,
    placeIds: Array.isArray(item.placeIds) ? item.placeIds : [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCollection(raw) {
  return {
    id: String(raw.id || `collection-${Date.now()}`),
    name: String(raw.name || '나의 컬렉션'),
    color: String(raw.color || '#3182F6'),
    icon: String(raw.icon || 'albums-outline'),
    placeIds: Array.isArray(raw.placeIds) ? raw.placeIds : [],
    createdAt: raw.createdAt || Date.now(),
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

export async function loadCollectionsFromFirestore() {
  const db = getDb();
  if (!db) return [];
  const snapshot = await getDocs(query(collectionsCollection(db), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((item) => normalizeCollection({ id: item.id, ...item.data() }));
}

export async function saveCollectionToFirestore(item) {
  const db = getDb();
  if (!db) return;
  await setDoc(doc(collectionsCollection(db), item.id), serializeCollection(item), { merge: true });
}

export async function deleteCollectionFromFirestore(collectionId) {
  const db = getDb();
  if (!db) return;
  await deleteDoc(doc(collectionsCollection(db), collectionId));
}
