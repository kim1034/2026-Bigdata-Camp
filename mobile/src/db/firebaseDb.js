import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  initializeFirestore,
  setDoc,
  waitForPendingWrites,
} from 'firebase/firestore';

const requiredKeys = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

let activeWorkspaceId = '';

export function setActiveWorkspaceId(workspaceId) {
  activeWorkspaceId = String(workspaceId || '').trim();
}

function getWorkspaceId() {
  return activeWorkspaceId || process.env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
}

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

function withTimeout(promise, label, timeoutMs = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 요청 시간이 초과되었습니다.`)), timeoutMs)
    ),
  ]);
}

function getDb() {
  const config = getConfig();
  if (!config) return null;
  if (getApps().length) return getFirestore(getApp());

  const app = initializeApp(config);
  return initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
}

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error('Firebase 환경변수가 설정되지 않았습니다. mobile/.env의 EXPO_PUBLIC_FIREBASE_* 값을 확인해 주세요.');
  }
  return db;
}

function placesCollection(db) {
  return collection(db, 'workspaces', getWorkspaceId(), 'places');
}

function collectionsCollection(db) {
  return collection(db, 'workspaces', getWorkspaceId(), 'collections');
}

function routesCollection(db) {
  return collection(db, 'workspaces', getWorkspaceId(), 'routes');
}

function itinerariesCollection(db) {
  return collection(db, 'workspaces', getWorkspaceId(), 'itineraries');
}

function safeDocumentId(value) {
  return String(value || 'unknown')
    .replace(/[/.#[\]?]/g, '_')
    .slice(0, 180) || 'unknown';
}

function placeReviewsCollection(db, placeId) {
  return collection(db, 'workspaces', getWorkspaceId(), 'placeReviews', safeDocumentId(placeId), 'reviews');
}

function normalizeMenu(menu) {
  if (Array.isArray(menu)) {
    return menu.map((item) => ({
      name: String(item?.name || item || ''),
      price: String(item?.price || ''),
    }));
  }

  if (typeof menu === 'string' && menu.trim()) {
    return menu
      .split(',')
      .map((name) => ({ name: name.trim(), price: '' }))
      .filter((item) => item.name);
  }

  return [];
}

function normalizePlace(raw) {
  const latitude = Number(raw.latitude ?? raw.lat ?? raw.coordinates?.latitude ?? 37.5446);
  const longitude = Number(raw.longitude ?? raw.lng ?? raw.coordinates?.longitude ?? 127.0559);

  return {
    id: String(raw.id || `place-${Date.now()}`),
    name: String(raw.name || ''),
    category: String(raw.category || '카페'),
    address: String(raw.address || ''),
    latitude: Number.isFinite(latitude) ? latitude : 37.5446,
    longitude: Number.isFinite(longitude) ? longitude : 127.0559,
    hours: String(raw.hours || ''),
    menu: normalizeMenu(raw.menu),
    reviewSummary: String(raw.reviewSummary || ''),
    screenshotText: String(raw.screenshotText || ''),
    originalImage: raw.originalImage || '',
    googlePlaceId: raw.googlePlaceId || raw.placeId || '',
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

function serializePlace(place) {
  const normalized = normalizePlace(place);
  const originalImage =
    normalized.originalImage && normalized.originalImage.length < 650000 ? normalized.originalImage : '';

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
    originalImage,
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

function serializeCollection(item) {
  return {
    schemaVersion: 1,
    id: item.id,
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

function normalizeCollection(raw) {
  return {
    id: String(raw.id || `collection-${Date.now()}`),
    name: String(raw.name || '나의 컬렉션'),
    color: String(raw.color || '#3182F6'),
    icon: String(raw.icon || 'albums-outline'),
    placeIds: Array.isArray(raw.placeIds) ? raw.placeIds : [],
    places: Array.isArray(raw.places) ? raw.places.map(normalizePlace) : [],
    routes: Array.isArray(raw.routes) ? raw.routes : [],
    createdAt: raw.createdAt || Date.now(),
  };
}

function normalizeRoute(raw) {
  return {
    id: String(raw.id || `route-${Date.now()}`),
    title: String(raw.title || '스마트 동선'),
    basePlace: raw.basePlace ? normalizePlace(raw.basePlace) : null,
    placeIds: Array.isArray(raw.placeIds) ? raw.placeIds : [],
    places: Array.isArray(raw.places) ? raw.places.map(normalizePlace) : [],
    visitDate: String(raw.visitDate || ''),
    itineraryId: raw.itineraryId || '',
    itinerary: Array.isArray(raw.itinerary) ? raw.itinerary : [],
    provider: raw.provider || '',
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function serializeRoute(route) {
  const normalized = normalizeRoute(route);
  return {
    schemaVersion: 1,
    id: normalized.id,
    title: normalized.title,
    basePlace: normalized.basePlace ? serializePlace(normalized.basePlace) : null,
    placeIds: normalized.placeIds,
    places: normalized.places.map(serializePlace),
    visitDate: normalized.visitDate,
    itineraryId: normalized.itineraryId,
    itinerary: normalized.itinerary,
    provider: normalized.provider,
    createdAt: normalized.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeItinerary(raw) {
  return {
    id: String(raw.id || `itinerary-${Date.now()}`),
    routeId: String(raw.routeId || ''),
    title: String(raw.title || 'AI 추천 일정표'),
    basePlace: raw.basePlace ? normalizePlace(raw.basePlace) : null,
    visitDate: String(raw.visitDate || ''),
    region: String(raw.region || ''),
    provider: raw.provider || '',
    items: Array.isArray(raw.items) ? raw.items : [],
    placeIds: Array.isArray(raw.placeIds) ? raw.placeIds : [],
    places: Array.isArray(raw.places) ? raw.places.map(normalizePlace) : [],
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function serializeItinerary(itinerary) {
  const normalized = normalizeItinerary(itinerary);
  return {
    schemaVersion: 1,
    id: normalized.id,
    routeId: normalized.routeId,
    title: normalized.title,
    basePlace: normalized.basePlace ? serializePlace(normalized.basePlace) : null,
    visitDate: normalized.visitDate,
    region: normalized.region,
    provider: normalized.provider,
    items: normalized.items,
    placeIds: normalized.placeIds,
    places: normalized.places.map(serializePlace),
    createdAt: normalized.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function serializePlaceReview(review) {
  return {
    id: review.id,
    placeId: review.placeId,
    placeName: review.placeName || '',
    rating: Math.max(1, Math.min(5, Number(review.rating) || 5)),
    comment: String(review.comment || '').trim(),
    createdAt: review.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizePlaceReview(raw) {
  return {
    id: String(raw.id || `review-${Date.now()}`),
    placeId: String(raw.placeId || ''),
    placeName: String(raw.placeName || ''),
    rating: Math.max(1, Math.min(5, Number(raw.rating) || 5)),
    comment: String(raw.comment || ''),
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

export function isFirebaseDbConfigured() {
  return Boolean(getConfig());
}

export async function loadPlacesFromFirestore() {
  const db = requireDb();
  const snapshot = await withTimeout(getDocs(placesCollection(db)), 'Firestore 장소 불러오기');
  const places = snapshot.docs.map((item) => normalizePlace({ id: item.id, ...item.data() }));
  const repairs = snapshot.docs
    .map((item, index) => ({ ref: item.ref, raw: item.data(), place: places[index] }))
    .filter(({ raw }) => raw.schemaVersion !== 1 || !raw.address || !raw.coordinates || !Array.isArray(raw.menu))
    .map(({ ref, place }) => setDoc(ref, serializePlace(place), { merge: true }));

  if (repairs.length) {
    await withTimeout(Promise.all(repairs), 'Firestore 장소 스키마 보정');
    await withTimeout(waitForPendingWrites(db), 'Firestore 장소 스키마 서버 반영');
  }

  return places.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function savePlaceToFirestore(place) {
  const db = requireDb();
  await withTimeout(setDoc(doc(placesCollection(db), place.id), serializePlace(place), { merge: true }), 'Firestore 장소 저장');
  await withTimeout(waitForPendingWrites(db), 'Firestore 장소 서버 반영');
}

export async function loadCollectionsFromFirestore() {
  const db = requireDb();
  const snapshot = await withTimeout(getDocs(collectionsCollection(db)), 'Firestore 컬렉션 불러오기');
  return snapshot.docs
    .map((item) => normalizeCollection({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export async function saveCollectionToFirestore(item) {
  const db = requireDb();
  await withTimeout(setDoc(doc(collectionsCollection(db), item.id), serializeCollection(item), { merge: true }), 'Firestore 컬렉션 저장');
  await withTimeout(waitForPendingWrites(db), 'Firestore 컬렉션 서버 반영');
}

export async function deleteCollectionFromFirestore(collectionId) {
  const db = requireDb();
  await withTimeout(deleteDoc(doc(collectionsCollection(db), collectionId)), 'Firestore 컬렉션 삭제');
  await withTimeout(waitForPendingWrites(db), 'Firestore 컬렉션 삭제 반영');
}

export async function loadRoutesFromFirestore() {
  const db = requireDb();
  const snapshot = await withTimeout(getDocs(routesCollection(db)), 'Firestore 동선 불러오기');
  return snapshot.docs
    .map((item) => normalizeRoute({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export async function saveRouteToFirestore(route) {
  const db = requireDb();
  const nextRoute = serializeRoute(route);
  await withTimeout(setDoc(doc(routesCollection(db), nextRoute.id), nextRoute, { merge: true }), 'Firestore 동선 저장');
  await withTimeout(waitForPendingWrites(db), 'Firestore 동선 서버 반영');
  return normalizeRoute(nextRoute);
}

export async function loadItinerariesFromFirestore() {
  const db = requireDb();
  const snapshot = await withTimeout(getDocs(itinerariesCollection(db)), 'Firestore 일정 불러오기');
  return snapshot.docs
    .map((item) => normalizeItinerary({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export async function saveItineraryToFirestore(itinerary) {
  const db = requireDb();
  const nextItinerary = serializeItinerary(itinerary);
  await withTimeout(setDoc(doc(itinerariesCollection(db), nextItinerary.id), nextItinerary, { merge: true }), 'Firestore 일정 저장');
  await withTimeout(waitForPendingWrites(db), 'Firestore 일정 서버 반영');
  return normalizeItinerary(nextItinerary);
}

export async function loadPlaceReviewsFromFirestore(placeId) {
  const db = requireDb();
  const snapshot = await withTimeout(getDocs(placeReviewsCollection(db, placeId)), 'Firestore 장소 리뷰 불러오기');
  return snapshot.docs
    .map((item) => normalizePlaceReview({ id: item.id, ...item.data() }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function savePlaceReviewToFirestore(placeId, review) {
  const db = requireDb();
  const targetCollection = placeReviewsCollection(db, placeId);
  const targetDoc = doc(targetCollection, review.id || `review-${Date.now()}`);
  const nextReview = serializePlaceReview({
    ...review,
    id: targetDoc.id,
    placeId,
  });

  await withTimeout(setDoc(targetDoc, nextReview, { merge: true }), 'Firestore 장소 리뷰 저장');
  await withTimeout(waitForPendingWrites(db), 'Firestore 장소 리뷰 서버 반영');
  return normalizePlaceReview(nextReview);
}
