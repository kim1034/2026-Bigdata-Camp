import { initializeApp, getApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  getFirestore,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, type Auth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import type { Place } from '../types';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  bio: string;
  createdAt: string;
  updatedAt: string;
}

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

let authInstance: Auth | null = null;
let persistencePromise: Promise<void> | null = null;

export function getFirebaseAuth(): Auth | null {
  const config = getFirebaseConfig();
  if (!config) return null;

  if (!authInstance) {
    const app = getApps().length ? getApp() : initializeApp(config);
    authInstance = getAuth(app);
    
    // Set persistence to local storage - keeps user logged in after page refresh
    if (!persistencePromise) {
      persistencePromise = setPersistence(authInstance, browserLocalPersistence)
        .catch((error) => {
          console.warn('Failed to set auth persistence:', error);
        });
    }
  }
  return authInstance;
}

function placesCollection(db: Firestore, workspaceId?: string) {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
  const actualWorkspaceId = workspaceId || env.VITE_FIREBASE_WORKSPACE_ID || env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
  return collection(db, 'workspaces', actualWorkspaceId, 'places');
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
    createdAt: place.createdAt || new Date().toISOString(),
    originalImage,
    updatedAt: new Date().toISOString(),
  };
}

export function isFirebaseDbConfigured() {
  return Boolean(getFirebaseConfig());
}

export async function loadPlacesFromFirestore(workspaceId?: string): Promise<Place[]> {
  const db = getDb();
  if (!db) return [];

  const snapshot = await getDocs(placesCollection(db, workspaceId));
  return snapshot.docs
    .map((item) => normalizePlace({ id: item.id, ...item.data() }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function savePlaceToFirestore(place: Place, workspaceId?: string) {
  const db = getDb();
  if (!db) return;

  await setDoc(doc(placesCollection(db, workspaceId), place.id), serializePlace(place), { merge: true });
}

export async function deletePlaceFromFirestore(placeId: string, workspaceId?: string) {
  const db = getDb();
  if (!db) return;

  await deleteDoc(doc(placesCollection(db, workspaceId), placeId));
}

export async function replacePlacesInFirestore(places: Place[], workspaceId?: string) {
  const db = getDb();
  if (!db) return;

  const batch = writeBatch(db);
  const current = await getDocs(placesCollection(db, workspaceId));
  current.docs.forEach((item) => batch.delete(item.ref));
  places.forEach((place) => {
    batch.set(doc(placesCollection(db, workspaceId), place.id), serializePlace(place));
  });
  await batch.commit();
}

// ============ User Profile Functions ============

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getDb();
  if (!db) return null;

  try {
    console.log(`Fetching profile for uid: ${uid}`);
    const userDocRef = doc(db, 'users', uid);
    const userSnapshot = await getDoc(userDocRef);
    
    if (userSnapshot.exists()) {
      console.log(`Profile found for ${uid}:`, userSnapshot.data());
      return userSnapshot.data() as UserProfile;
    }
    console.log(`No profile found for ${uid}`);
    return null;
  } catch (error) {
    console.error('프로필 로드 실패:', error);
    return null;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    console.log(`Saving profile for uid: ${profile.uid}`, profile);
    const userDocRef = doc(db, 'users', profile.uid);
    await setDoc(userDocRef, profile, { merge: true });
    console.log(`✓ 사용자 프로필 저장됨: ${profile.uid}`);
  } catch (error) {
    console.error('프로필 저장 실패:', error);
    throw error;
  }
}
