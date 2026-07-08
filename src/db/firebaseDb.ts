import { initializeApp, getApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Place, PlaceMenu } from '../types';

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

function getWorkspaceId() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
  return env.VITE_FIREBASE_WORKSPACE_ID || env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
}

function placesCollection(db: Firestore) {
  return collection(db, 'workspaces', getWorkspaceId(), 'places');
}

function collectionsCollection(db: Firestore) {
  return collection(db, 'workspaces', getWorkspaceId(), 'collections');
}

function routesCollection(db: Firestore) {
  return collection(db, 'workspaces', getWorkspaceId(), 'routes');
}

function itinerariesCollection(db: Firestore) {
  return collection(db, 'workspaces', getWorkspaceId(), 'itineraries');
}

function normalizeMenu(menu: unknown): PlaceMenu[] {
  if (!Array.isArray(menu)) return [];
  return menu.map((item) => ({
    name: String((item as PlaceMenu)?.name || item || ''),
    price: String((item as PlaceMenu)?.price || ''),
  }));
}

function normalizePlace(raw: any): Place {
  return {
    id: String(raw.id || `place-${Date.now()}`),
    name: String(raw.name || ''),
    category: raw.category || '관광지/기타',
    address: String(raw.address || ''),
    latitude: Number(raw.latitude || 37.5446),
    longitude: Number(raw.longitude || 127.0559),
    hours: String(raw.hours || ''),
    menu: normalizeMenu(raw.menu),
    reviewSummary: String(raw.reviewSummary || ''),
    screenshotText: String(raw.screenshotText || ''),
    originalImage: raw.originalImage || '',
    googlePlaceId: raw.googlePlaceId || '',
    provider: raw.provider || '',
    photoUrl: raw.photoUrl || '',
    rating: raw.rating ?? null,
    userRatingsTotal: raw.userRatingsTotal ?? null,
    confidence: Number(raw.confidence || 0.85),
    pinColor: raw.pinColor || '#FFFFFF',
    collectionIds: Array.isArray(raw.collectionIds) ? raw.collectionIds : [],
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function serializePlace(place: Place) {
  const normalized = normalizePlace(place);
  return {
    schemaVersion: 1,
    id: normalized.id,
    name: normalized.name,
    category: normalized.category,
    address: normalized.address,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    coordinates: {
      latitude: normalized.latitude,
      longitude: normalized.longitude,
    },
    hours: normalized.hours,
    menu: normalized.menu,
    reviewSummary: normalized.reviewSummary,
    screenshotText: normalized.screenshotText,
    originalImage: normalized.originalImage,
    googlePlaceId: normalized.googlePlaceId,
    provider: normalized.provider,
    photoUrl: normalized.photoUrl,
    rating: normalized.rating,
    userRatingsTotal: normalized.userRatingsTotal,
    confidence: normalized.confidence,
    pinColor: normalized.pinColor,
    collectionIds: normalized.collectionIds,
    createdAt: normalized.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function serializeCollection(item: any) {
  return {
    schemaVersion: 1,
    id: String(item.id || `collection-${Date.now()}`),
    name: String(item.name || '나의 컬렉션'),
    color: String(item.color || '#3182F6'),
    icon: String(item.icon || 'albums-outline'),
    placeIds: Array.isArray(item.placeIds) ? item.placeIds : [],
    places: Array.isArray(item.places) ? item.places.map(serializePlace) : [],
    routes: Array.isArray(item.routes) ? item.routes : [],
    createdAt: item.createdAt || Date.now(),
    updatedAt: new Date().toISOString(),
  };
}

function serializeRoute(route: any) {
  return {
    schemaVersion: 1,
    id: String(route.id || `route-${Date.now()}`),
    title: String(route.title || '스마트 동선'),
    basePlace: route.basePlace ? serializePlace(route.basePlace) : null,
    placeIds: Array.isArray(route.placeIds) ? route.placeIds : [],
    places: Array.isArray(route.places) ? route.places.map(serializePlace) : [],
    visitDate: String(route.visitDate || ''),
    itineraryId: route.itineraryId || '',
    itinerary: Array.isArray(route.itinerary) ? route.itinerary : [],
    provider: route.provider || '',
    createdAt: route.createdAt || Date.now(),
    updatedAt: new Date().toISOString(),
  };
}

function serializeItinerary(itinerary: any) {
  return {
    schemaVersion: 1,
    id: String(itinerary.id || `itinerary-${Date.now()}`),
    routeId: String(itinerary.routeId || ''),
    title: String(itinerary.title || 'AI 추천 일정표'),
    basePlace: itinerary.basePlace ? serializePlace(itinerary.basePlace) : null,
    visitDate: String(itinerary.visitDate || ''),
    region: String(itinerary.region || ''),
    provider: itinerary.provider || '',
    items: Array.isArray(itinerary.items) ? itinerary.items : [],
    placeIds: Array.isArray(itinerary.placeIds) ? itinerary.placeIds : [],
    places: Array.isArray(itinerary.places) ? itinerary.places.map(serializePlace) : [],
    createdAt: itinerary.createdAt || Date.now(),
    updatedAt: new Date().toISOString(),
  };
}

export function isFirebaseDbConfigured() {
  return Boolean(getFirebaseConfig());
}

export async function loadPlacesFromFirestore(): Promise<Place[]> {
  const db = getDb();
  if (!db) return [];

  const snapshot = await getDocs(placesCollection(db));
  const places = snapshot.docs.map((item) => normalizePlace({ id: item.id, ...item.data() }));
  const repairs = snapshot.docs
    .map((item, index) => ({ ref: item.ref, raw: item.data(), place: places[index] }))
    .filter(({ raw }) => raw.schemaVersion !== 1 || !raw.address || !raw.coordinates || !Array.isArray(raw.menu))
    .map(({ ref, place }) => setDoc(ref, serializePlace(place), { merge: true }));

  if (repairs.length) {
    await Promise.all(repairs);
  }

  return places.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

export async function saveCollectionToFirestore(item: any) {
  const db = getDb();
  if (!db) return;

  const nextCollection = serializeCollection(item);
  await setDoc(doc(collectionsCollection(db), nextCollection.id), nextCollection, { merge: true });
}

export async function saveRouteToFirestore(route: any) {
  const db = getDb();
  if (!db) return;

  const nextRoute = serializeRoute(route);
  await setDoc(doc(routesCollection(db), nextRoute.id), nextRoute, { merge: true });
}

export async function saveItineraryToFirestore(itinerary: any) {
  const db = getDb();
  if (!db) return;

  const nextItinerary = serializeItinerary(itinerary);
  await setDoc(doc(itinerariesCollection(db), nextItinerary.id), nextItinerary, { merge: true });
}
