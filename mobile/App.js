import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Image,
  PanResponder,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { GoogleMapWebView } from './src/components/GoogleMapWebView';
import { categories } from './src/data/places';
import {
  deleteCollectionFromFirestore,
  isFirebaseDbConfigured,
  loadCollectionsFromFirestore,
  loadPlaceReviewsFromFirestore,
  loadPlacesFromFirestore,
  saveCollectionToFirestore,
  saveItineraryToFirestore,
  savePlaceReviewToFirestore,
  savePlaceToFirestore,
  saveRouteToFirestore,
  setActiveWorkspaceId,
} from './src/db/firebaseDb';
import { buildRoute } from './src/utils/inference';
import { styles } from './src/styles';

const ROUTE_SELECT_RADIUS = 118;
const ROUTE_BASE_RADIUS_METERS = 1500;
const ROUTE_TAP_MOVE_THRESHOLD = 11;
const ROUTE_PAN_SENSITIVITY = 1.65;
const ROUTE_PAN_MIN_DELTA = 0.8;
const ROUTE_PINCH_ZOOM_SENSITIVITY = 1.25;
const ROUTE_ZOOM_MIN_DELTA = 0.012;
const DETAIL_MINI_HEIGHT = 106;
const DETAIL_EXPAND_THRESHOLD = -360;
const DETAIL_DRAG_LIMIT = -430;
const DETAIL_FAST_FLICK_MIN_DRAG = -90;
const DETAIL_FAST_FLICK_VELOCITY = -2.4;
const EXPO_PUSH_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '97ee4776-149b-40aa-b7b9-f96989472fb1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const collectionIconOptions = [
  'albums-outline',
  'cafe-outline',
  'restaurant-outline',
  'bed-outline',
  'camera-outline',
  'heart-outline',
  'sparkles-outline',
  'map-outline',
];

const collectionColorOptions = ['#3182F6', '#00A86B', '#FF7A00', '#8B5CF6', '#FF3B30', '#111827'];

const collectionVisibilityOptions = [
  { key: 'private', label: '나만 보기', icon: 'lock-closed-outline', description: '내 계정에서만 볼 수 있어요.' },
  { key: 'friends', label: '친구 공개', icon: 'people-outline', description: '친구에게 공유 가능한 컬렉션으로 표시돼요.' },
];

const routeExploreModes = [
  { key: 'WALK', label: '도보', icon: 'walk-outline' },
  { key: 'BICYCLE', label: '자전거', icon: 'bicycle-outline' },
  { key: 'TRANSIT', label: '대중교통', icon: 'bus-outline' },
];

function Glass({ children, style }) {
  return (
    <BlurView intensity={82} tint="light" style={[styles.glass, style]}>
      {children}
    </BlurView>
  );
}

function iconForCategory(category) {
  return categories.find((item) => item.label === category)?.icon || 'location-outline';
}

function colorForCategory(category) {
  return categories.find((item) => item.label === category)?.color || '#3182F6';
}

function glyphForIcon(icon) {
  const glyphs = {
    'albums-outline': '▦',
    'cafe-outline': '☕',
    'restaurant-outline': '♨',
    'bed-outline': '⌂',
    'camera-outline': '◎',
    'heart-outline': '♥',
    'sparkles-outline': '✦',
    'map-outline': '⌖',
    'leaf-outline': '●',
    'location-outline': '•',
  };
  return glyphs[icon] || '•';
}

function normalizeCategoryLabel(category) {
  const raw = String(category || '').trim();
  const text = raw.toLowerCase();
  if (!text) return '관광지';
  if (text.includes('카페') || text.includes('cafe') || text.includes('bakery')) return '카페';
  if (text.includes('맛집') || text.includes('식당') || text.includes('음식') || text.includes('restaurant') || text.includes('food')) return '맛집';
  if (text.includes('숙박') || text.includes('펜션') || text.includes('호텔') || text.includes('lodging') || text.includes('hotel')) return '숙박';
  if (text.includes('관광') || text.includes('명소') || text.includes('체험') || text.includes('기타') || text.includes('tour') || text.includes('attraction')) return '관광지';
  return categories.some((item) => item.label === raw && raw !== '전체') ? raw : '관광지';
}

function enrichPlace(place) {
  const category = normalizeCategoryLabel(place.category ?? place.categoryLabel ?? place.type ?? place.placeType);
  const markerIcon = place.pinIcon || iconForCategory(category);
  return {
    ...place,
    category,
    color: place.pinColor || colorForCategory(category),
    icon: markerIcon,
    glyph: glyphForIcon(markerIcon),
  };
}

function normalizeMenu(menu) {
  if (Array.isArray(menu)) {
    return menu.map((item) => `${item.name}${item.price ? ` ${item.price}` : ''}`).join(', ');
  }
  return String(menu || '');
}

function normalizeExtractedPlace(payload, fallbackImage) {
  const source = payload?.place || payload || {};
  return {
    ...source,
    menu: normalizeMenu(source.menu),
    originalImage: fallbackImage,
  };
}

function compactRoutePlace(place) {
  const latitude = Number(place.latitude ?? place.lat);
  const longitude = Number(place.longitude ?? place.lng);
  return {
    id: place.id,
    name: place.name,
    category: normalizeCategoryLabel(place.category ?? place.categoryLabel ?? place.type ?? place.placeType),
    address: place.address,
    latitude: Number.isFinite(latitude) ? latitude : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
  };
}

function compactCollectionPlace(place) {
  return {
    ...compactRoutePlace(place),
    hours: place.hours || '',
    menu: normalizeMenu(place.menu),
    reviewSummary: place.reviewSummary || '',
    confidence: Number(place.confidence || 0.85),
    googlePlaceId: place.googlePlaceId,
    provider: place.provider,
    photoUrl: place.photoUrl,
    rating: place.rating ?? null,
    userRatingsTotal: place.userRatingsTotal ?? null,
    pinColor: place.pinColor,
    pinIcon: place.pinIcon,
    collectionIds: Array.isArray(place.collectionIds) ? place.collectionIds : [],
  };
}

function compactItineraryItem(item) {
  return {
    time: item.time,
    activity: item.activity,
    duration: item.duration,
    hoursCheck: item.hoursCheck,
    tip: item.tip,
    transitToNext: item.transitToNext || null,
    place: item.place ? compactRoutePlace(item.place) : null,
  };
}

function buildCollectionRouteSnapshot({ basePlace, routePlaces, visitDate, itinerary, provider }) {
  const orderedPlaces = routePlaces.filter(Boolean);
  const baseName = basePlace?.name || '기준점';
  return {
    id: `route-${Date.now()}`,
    title: `${baseName} 기준 스마트 동선`,
    basePlace: basePlace ? compactRoutePlace(basePlace) : null,
    placeIds: orderedPlaces.map((place) => place.id),
    places: orderedPlaces.map(compactRoutePlace),
    visitDate: visitDate || '',
    itinerary: Array.isArray(itinerary) ? itinerary.map(compactItineraryItem) : [],
    provider: provider || '',
    createdAt: Date.now(),
  };
}

function buildItinerarySnapshot({ routeSnapshot, basePlace, routePlaces, visitDate, itinerary, provider, region }) {
  const orderedPlaces = routePlaces.filter(Boolean);
  const baseName = basePlace?.name || routeSnapshot?.basePlace?.name || '기준점';
  return {
    id: `itinerary-${Date.now()}`,
    routeId: routeSnapshot?.id || '',
    title: `${baseName} 기준 AI 추천 일정표`,
    basePlace: basePlace ? compactRoutePlace(basePlace) : routeSnapshot?.basePlace || null,
    visitDate: visitDate || '',
    region: region || '',
    provider: provider || '',
    items: Array.isArray(itinerary) ? itinerary.map(compactItineraryItem) : [],
    placeIds: orderedPlaces.map((place) => place.id),
    places: orderedPlaces.map(compactRoutePlace),
    createdAt: Date.now(),
  };
}

function touchCenter(touches) {
  if (!touches?.length) return null;
  const total = touches.reduce(
    (sum, touch) => ({
      x: sum.x + touch.pageX,
      y: sum.y + touch.pageY,
    }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / touches.length,
    y: total.y / touches.length,
  };
}

function touchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function placeCoordinate(place) {
  const lat = Number(place?.latitude ?? place?.lat);
  const lng = Number(place?.longitude ?? place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function calculateDistanceMeters(from, to) {
  const fromPoint = placeCoordinate(from);
  const toPoint = placeCoordinate(to);
  if (!fromPoint || !toPoint) return 0;
  const earthRadius = 6371000;
  const dLat = ((toPoint.lat - fromPoint.lat) * Math.PI) / 180;
  const dLng = ((toPoint.lng - fromPoint.lng) * Math.PI) / 180;
  const lat1 = (fromPoint.lat * Math.PI) / 180;
  const lat2 = (toPoint.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatMoveDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km`;
  return `${Math.round(meters)}m`;
}

function todayDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0];
}

function weekendDateString() {
  const date = new Date();
  const day = date.getDay();
  const daysToSaturday = (6 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + daysToSaturday);
  return date.toISOString().split('T')[0];
}

function timeText(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addMinutes(date, minutes) {
  date.setMinutes(date.getMinutes() + minutes);
}

function firstMenuName(menu) {
  if (Array.isArray(menu) && menu[0]) return menu[0].name || String(menu[0]);
  return String(menu || '').split(',')[0].trim() || '대표 메뉴';
}

function getRegionOfAddress(address) {
  const text = String(address || '').trim();
  if (!text) return '기타 지역';
  const parts = text.split(/\s+/).filter(Boolean);
  return (
    parts.find((part) => part.endsWith('구')) ||
    parts.find((part) => part.endsWith('동') || part.endsWith('읍') || part.endsWith('면')) ||
    parts.find((part) => part.endsWith('시') || part.endsWith('군')) ||
    parts[0] ||
    '기타 지역'
  );
}

function categoryKind(category) {
  const text = String(category || '');
  if (text.includes('카페')) return 'cafe';
  if (text.includes('맛집') || text.includes('식당') || text.includes('음식')) return 'food';
  if (text.includes('숙박') || text.includes('숙소') || text.includes('펜션') || text.includes('호텔')) return 'stay';
  if (text.includes('관광') || text.includes('공원') || text.includes('명소')) return 'attraction';
  return 'place';
}

function itineraryActivityForPlace(place) {
  const kind = categoryKind(place?.category);
  if (kind === 'food') {
    return {
      activity: '정갈한 식사와 대표 메뉴 즐기기',
      duration: '1시간 20분',
      durationMinutes: 80,
      tip: `대표 메뉴 ${firstMenuName(place?.menu)}은(는) 웨이팅이 있을 수 있으니 피크 시간을 피해 방문해 보세요.`,
    };
  }
  if (kind === 'cafe') {
    return {
      activity: '카페 타임 & 디저트 힐링',
      duration: '1시간',
      durationMinutes: 60,
      tip: `${firstMenuName(place?.menu)}와 함께 쉬어가기 좋은 타이밍입니다.`,
    };
  }
  if (kind === 'stay') {
    return {
      activity: '체크인 및 휴식',
      duration: '1시간',
      durationMinutes: 60,
      tip: '숙소 기준 동선의 출발점으로 두고 주변 스팟을 짧은 이동거리 순서로 묶었습니다.',
    };
  }
  return {
    activity: '여유로운 명소 관람 및 주변 산책',
    duration: '1시간 30분',
    durationMinutes: 90,
    tip: '동선 중간에 배치하면 이동 피로를 줄이고 주변까지 자연스럽게 둘러볼 수 있어요.',
  };
}
function buildNearestRoute(basePlace, sourcePlaces, limit = 6) {
  if (!placeCoordinate(basePlace)) return [];
  const remaining = sourcePlaces
    .filter((place) => place?.id !== basePlace?.id && placeCoordinate(place))
    .map((place) => ({ ...place, distanceFromBase: calculateDistanceMeters(basePlace, place) }))
    .sort((a, b) => a.distanceFromBase - b.distanceFromBase)
    .slice(0, limit);
  const ordered = [];
  let current = basePlace;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((place, index) => {
      const distance = calculateDistanceMeters(current, place);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

function routePlacesInsideBaseCircle(basePlace, sourcePlaces, radiusMeters = ROUTE_BASE_RADIUS_METERS) {
  if (!placeCoordinate(basePlace)) return [];
  const candidates = sourcePlaces
    .filter((place) => place?.id !== basePlace?.id && placeCoordinate(place))
    .map((place) => ({ ...place, distanceFromBase: calculateDistanceMeters(basePlace, place) }))
    .filter((place) => place.distanceFromBase <= radiusMeters);

  return buildNearestRoute(basePlace, candidates, candidates.length || 6);
}

function buildSmartItinerary(basePlace, orderedPlaces) {
  const currentTime = new Date();
  currentTime.setHours(10, 30, 0, 0);

  return orderedPlaces.map((place, index) => {
    const preset = itineraryActivityForPlace(place);
    const time = timeText(currentTime);
    const nextPlace = orderedPlaces[index + 1];
    let transitToNext = null;

    if (nextPlace) {
      const distance = calculateDistanceMeters(place, nextPlace);
      const isWalk = distance < 900;
      const speedMetersPerMinute = isWalk ? 70 : 420;
      const minutes = Math.max(2, Math.round(distance / speedMetersPerMinute));
      transitToNext = {
        type: isWalk ? 'walk' : 'car',
        duration: minutes,
        distance,
        text: `${isWalk ? '도보' : '차량'} 이동 ${minutes}분 (${formatMoveDistance(distance)})`,
      };
      addMinutes(currentTime, preset.durationMinutes + minutes);
    }

    return {
      place,
      time,
      activity: preset.activity,
      duration: preset.duration,
      hoursCheck: place.hours || '영업시간 확인 필요',
      tip:
        index === 0 && basePlace
          ? `"${basePlace.name}"에서 가장 가까운 스팟부터 시작하도록 배치했습니다. ${preset.tip}`
          : preset.tip,
      transitToNext,
    };
  });
}

function buildItineraryFromGemini(geminiItinerary, orderedPlaces) {
  const steps = Array.isArray(geminiItinerary?.steps) ? geminiItinerary.steps : [];
  if (!steps.length) return null;

  return steps.map((step, index) => {
    const place =
      orderedPlaces[index] || {
        id: `gemini-step-${index}`,
        name: step.placeName || `STEP ${index + 1}`,
        category: step.category || '장소',
        address: '',
        hours: step.hoursStatus || '영업시간 확인 필요',
      };
    return {
      place: {
        ...place,
        name: step.placeName || place.name,
        category: step.category || place.category,
      },
      time: step.time || `${String(10 + index).padStart(2, '0')}:30`,
      activity: step.activity || '추천 활동',
      duration: step.duration || '1시간',
      hoursCheck: step.hoursStatus || place.hours || '영업시간 확인 필요',
      tip: step.tip || 'AI가 이동 거리와 방문 흐름을 기준으로 추천한 순서입니다.',
      transitToNext: step.moveToNext
        ? {
            type: String(step.moveToNext).includes('도보') ? 'walk' : 'car',
            text: String(step.moveToNext),
          }
        : null,
    };
  });
}

function categoryFromGoogleTypes(types = []) {
  if (types.some((type) => ['cafe', 'bakery'].includes(type))) return categories[1]?.label || 'Cafe';
  if (types.some((type) => ['restaurant', 'food', 'meal_takeaway', 'market', 'grocery_or_supermarket'].includes(type))) {
    return categories[2]?.label || 'Food';
  }
  if (types.some((type) => ['lodging'].includes(type))) return categories[3]?.label || 'Stay';
  return categories[4]?.label || categories[1]?.label || 'Place';
}

function detailPlaceKey(place) {
  return String(place?.googlePlaceId || place?.id || 'unknown');
}

function googlePhotoUrl(photo) {
  if (photo?.url) return photo.url;
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!apiBase || !photo?.reference) return '';
  const baseUrl = apiBase.replace(/\/$/, '');
  return `${baseUrl}/api/places/google-photo?reference=${encodeURIComponent(photo.reference)}&maxWidth=900`;
}

function ratingStars(rating) {
  const nextRating = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return Array.from({ length: 5 }, (_, index) => (index < nextRating ? 'star' : 'star-outline'));
}

function defaultWorkspaceId() {
  return process.env.EXPO_PUBLIC_FIREBASE_WORKSPACE_ID || 'default';
}

function genderLabel(value) {
  const labels = {
    female: '여성',
    male: '남성',
    other: '기타',
    none: '선택 안 함',
  };
  return labels[value] || labels.none;
}

export default function App() {
  const mapRef = useRef(null);
  const detailDragY = useRef(new Animated.Value(0)).current;
  const detailDragExpandedRef = useRef(false);
  const routeGestureModeRef = useRef('idle');
  const singleTouchRef = useRef(null);
  const twoFingerAnchorRef = useRef(null);
  const pinchDistanceRef = useRef(0);
  const routePanFrameRef = useRef(false);
  const routePanDeltaRef = useRef({ x: 0, y: 0 });
  const routeZoomFrameRef = useRef(false);
  const routeZoomDeltaRef = useRef(0);
  const pushTokenRegisteredForRef = useRef('');
  const [tab, setTab] = useState('map');
  const [authUser, setAuthUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('idle');
  const [authMessage, setAuthMessage] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authDraft, setAuthDraft] = useState({
    userId: '',
    password: '',
    nickname: '',
    age: '',
    gender: 'none',
  });
  const [friendTarget, setFriendTarget] = useState('');
  const [friendStatus, setFriendStatus] = useState('idle');
  const [friendMessage, setFriendMessage] = useState('');
  const [friendHub, setFriendHub] = useState({
    friends: [],
    incoming: [],
    outgoing: [],
    inbox: [],
    publicCollections: [],
  });
  const [friendPublicCollectionOpen, setFriendPublicCollectionOpen] = useState(null);
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [detailSheetVisible, setDetailSheetVisible] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState('photos');
  const [googlePlaceDetails, setGooglePlaceDetails] = useState({
    status: 'idle',
    photos: [],
    reviews: [],
    message: '',
  });
  const [userReviews, setUserReviews] = useState([]);
  const [reviewDraft, setReviewDraft] = useState({ rating: 5, comment: '' });
  const [reviewSaving, setReviewSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [extracting, setExtracting] = useState(false);
  const [extractStep, setExtractStep] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [extractResult, setExtractResult] = useState(null);
  const [verification, setVerification] = useState(null);
  const [routePlaces, setRoutePlaces] = useState([]);
  const [toast, setToast] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [mapStatus, setMapStatus] = useState({ status: 'idle', message: '' });
  const [routeInfo, setRouteInfo] = useState({ status: 'idle', durationText: '', distanceText: '' });
  const [routeExplore, setRouteExplore] = useState({
    status: 'idle',
    selectedMode: '',
    routes: [],
    message: '',
  });
  const [transitRealtime, setTransitRealtime] = useState({
    status: 'idle',
    message: '',
    buses: [],
    subwayMessage: '',
  });
  const [routeSelectMode, setRouteSelectMode] = useState(false);
  const [routeSearchOpen, setRouteSearchOpen] = useState(false);
  const [routeBaseQuery, setRouteBaseQuery] = useState('');
  const [routeBasePlace, setRouteBasePlace] = useState(null);
  const [routeScheduleOpen, setRouteScheduleOpen] = useState(false);
  const [routeScheduleDate, setRouteScheduleDate] = useState(weekendDateString());
  const [routeScheduleLoading, setRouteScheduleLoading] = useState(false);
  const [routeScheduleProvider, setRouteScheduleProvider] = useState('');
  const [aiSelectedRegion, setAiSelectedRegion] = useState('');
  const [aiSelectedDate, setAiSelectedDate] = useState(todayDateString());
  const [aiGeneratedItinerary, setAiGeneratedItinerary] = useState(null);
  const [collections, setCollections] = useState([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [collectionPickerPlace, setCollectionPickerPlace] = useState(null);
  const [collectionPickerRoute, setCollectionPickerRoute] = useState(null);
  const [collectionCreatorOpen, setCollectionCreatorOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState({
    name: '',
    icon: collectionIconOptions[0],
    color: collectionColorOptions[0],
    visibility: 'private',
  });
  const currentWorkspaceId = authUser?.workspaceId || defaultWorkspaceId();
  const collectionById = useMemo(
    () => new Map(collections.filter((item) => item?.id).map((item) => [item.id, item])),
    [collections]
  );

  function pinVisualForCollectionIds(collectionIds) {
    const firstCollection = (Array.isArray(collectionIds) ? collectionIds : [])
      .map((id) => collectionById.get(id))
      .find(Boolean);
    return firstCollection
      ? { pinColor: firstCollection.color || '#3182F6', pinIcon: firstCollection.icon || 'albums-outline' }
      : { pinColor: '#FFFFFF', pinIcon: '' };
  }

  function applyCollectionPinVisual(place, collectionIds = place?.collectionIds) {
    const visual = pinVisualForCollectionIds(collectionIds);
    return {
      ...place,
      ...visual,
      collectionIds: Array.isArray(collectionIds) ? collectionIds : [],
    };
  }

  const visiblePlaces = useMemo(() => {
    return places.filter((place) => {
      const categoryMatched = category === '전체' || place.category === category;
      const text = `${place.name} ${place.address} ${place.category}`.toLowerCase();
      const queryMatched = !query.trim() || text.includes(query.trim().toLowerCase());
      return categoryMatched && queryMatched;
    });
  }, [places, category, query]);

  const mapPlaces = useMemo(
    () => visiblePlaces.map((place) => enrichPlace(applyCollectionPinVisual(place))),
    [visiblePlaces, collections]
  );
  const mapSelectedPlace = useMemo(
    () => (selectedPlace ? enrichPlace(applyCollectionPinVisual(selectedPlace)) : null),
    [selectedPlace, collections]
  );
  const selectedCollection = useMemo(
    () => collections.find((item) => item.id === selectedCollectionId) || collections[0] || null,
    [collections, selectedCollectionId]
  );
  const selectedCollectionPlaces = useMemo(() => {
    if (!selectedCollection) return [];
    const snapshots = Array.isArray(selectedCollection.places) ? selectedCollection.places : [];
    const snapshotById = new Map(snapshots.filter((place) => place?.id).map((place) => [place.id, place]));
    const livePlaceById = new Map(places.map((place) => [place.id, place]));
    const placeIds = Array.isArray(selectedCollection.placeIds) ? selectedCollection.placeIds : [];
    const ids = placeIds.length ? placeIds : snapshots.map((place) => place.id).filter(Boolean);

    return Array.from(new Set(ids)).map(
      (placeId) =>
        livePlaceById.get(placeId) ||
        snapshotById.get(placeId) || {
          id: placeId,
          name: '저장된 장소',
          category: '동기화 필요',
          address: '장소 원본 데이터를 불러오지 못했어요.',
          missing: true,
        }
    );
  }, [places, selectedCollection]);
  const selectedCollectionRoutes = useMemo(() => {
    if (!selectedCollection) return [];
    return Array.isArray(selectedCollection.routes) ? selectedCollection.routes : [];
  }, [selectedCollection]);
  const routeSearchResults = useMemo(() => {
    const text = routeBaseQuery.trim().toLowerCase();
    const source = places.filter((place) => placeCoordinate(place));
    if (!text) return source.slice(0, 8);
    return source
      .filter((place) => `${place.name} ${place.address} ${place.category}`.toLowerCase().includes(text))
      .slice(0, 8);
  }, [places, routeBaseQuery]);
  const routeSelectionResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => routeSelectMode,
        onMoveShouldSetPanResponder: () => routeSelectMode,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches || [];
          if (touches.length >= 2) {
            routeGestureModeRef.current = 'pinch';
            singleTouchRef.current = null;
            twoFingerAnchorRef.current = touchCenter(touches);
            pinchDistanceRef.current = touchDistance(touches);
            return;
          }

          routeGestureModeRef.current = 'tap-candidate';
          const firstTouch = touches[0];
          singleTouchRef.current = {
            startX: firstTouch?.locationX ?? event.nativeEvent.locationX,
            startY: firstTouch?.locationY ?? event.nativeEvent.locationY,
            lastPageX: firstTouch?.pageX ?? event.nativeEvent.pageX,
            lastPageY: firstTouch?.pageY ?? event.nativeEvent.pageY,
            moved: false,
          };
        },
        onPanResponderMove: (event) => {
          const touches = event.nativeEvent.touches || [];
          if (touches.length >= 2) {
            routeGestureModeRef.current = 'pinch';
            singleTouchRef.current = null;
            const nextDistance = touchDistance(touches);
            const prevDistance = pinchDistanceRef.current || nextDistance;
            if (nextDistance > 0 && prevDistance > 0) {
              const zoomDelta = Math.log2(nextDistance / prevDistance) * ROUTE_PINCH_ZOOM_SENSITIVITY;
              if (Math.abs(zoomDelta) >= ROUTE_ZOOM_MIN_DELTA) {
                routeZoomDeltaRef.current += zoomDelta;
                if (!routeZoomFrameRef.current) {
                  routeZoomFrameRef.current = true;
                  requestAnimationFrame(() => {
                    const delta = routeZoomDeltaRef.current;
                    routeZoomDeltaRef.current = 0;
                    routeZoomFrameRef.current = false;
                    mapRef.current?.zoomBy(delta);
                  });
                }
              }
            }
            pinchDistanceRef.current = nextDistance;
            twoFingerAnchorRef.current = touchCenter(touches);
            return;
          }

          const touch = touches[0];
          const current = singleTouchRef.current;
          if (!touch || !current) return;

          const totalDistance = Math.hypot(
            event.nativeEvent.locationX - current.startX,
            event.nativeEvent.locationY - current.startY
          );
          if (totalDistance > ROUTE_TAP_MOVE_THRESHOLD) {
            routeGestureModeRef.current = 'pan';
            current.moved = true;
          }

          if (routeGestureModeRef.current === 'pan') {
            const dx = (current.lastPageX - touch.pageX) * ROUTE_PAN_SENSITIVITY;
            const dy = (current.lastPageY - touch.pageY) * ROUTE_PAN_SENSITIVITY;
            current.lastPageX = touch.pageX;
            current.lastPageY = touch.pageY;

            if (Math.abs(dx) >= ROUTE_PAN_MIN_DELTA || Math.abs(dy) >= ROUTE_PAN_MIN_DELTA) {
              routePanDeltaRef.current = {
                x: routePanDeltaRef.current.x + dx,
                y: routePanDeltaRef.current.y + dy,
              };
              if (!routePanFrameRef.current) {
                routePanFrameRef.current = true;
                requestAnimationFrame(() => {
                  const delta = routePanDeltaRef.current;
                  routePanDeltaRef.current = { x: 0, y: 0 };
                  routePanFrameRef.current = false;
                  mapRef.current?.panBy(delta.x, delta.y);
                });
              }
            }
          }
        },
        onPanResponderRelease: (event) => {
          const current = singleTouchRef.current;
          if (routeGestureModeRef.current === 'tap-candidate' && current && !current.moved) {
            setDetailSheetVisible(false);
            if (routeBasePlace) {
              const nextRoute = routePlacesInsideBaseCircle(routeBasePlace, places);
              setRoutePlaces(nextRoute);
              focusRouteBaseCircle(routeBasePlace);
              showToast(`기준 원 안의 저장 장소 ${nextRoute.length}곳을 선택했어요`);
            } else {
              setRouteSearchOpen(true);
              showToast('먼저 기준 장소를 선택해 주세요');
            }
          }
          routeGestureModeRef.current = 'idle';
          singleTouchRef.current = null;
          twoFingerAnchorRef.current = null;
          pinchDistanceRef.current = 0;
          routePanDeltaRef.current = { x: 0, y: 0 };
          routePanFrameRef.current = false;
          routeZoomDeltaRef.current = 0;
          routeZoomFrameRef.current = false;
        },
        onPanResponderTerminate: () => {
          routeGestureModeRef.current = 'idle';
          singleTouchRef.current = null;
          twoFingerAnchorRef.current = null;
          pinchDistanceRef.current = 0;
          routePanDeltaRef.current = { x: 0, y: 0 };
          routePanFrameRef.current = false;
          routeZoomDeltaRef.current = 0;
          routeZoomFrameRef.current = false;
        },
      }),
    [places, routeBasePlace, routeSelectMode]
  );
  function resetDetailDragPosition() {
    detailDragExpandedRef.current = false;
    Animated.spring(detailDragY, {
      toValue: 0,
      useNativeDriver: false,
      tension: 190,
      friction: 18,
    }).start();
  }

  function expandDetailFromDrag() {
    detailDragExpandedRef.current = true;
    detailDragY.stopAnimation();
    setDetailExpanded(true);
  }

  function collapseDetailToMini() {
    detailDragExpandedRef.current = false;
    detailDragY.setValue(0);
    setDetailExpanded(false);
  }

  function shouldExpandDetail(gestureState, dragY) {
    const nextY = Math.max(DETAIL_DRAG_LIMIT, Math.min(0, Number(dragY) || 0));
    const isPastThreshold = nextY <= DETAIL_EXPAND_THRESHOLD;
    const isVeryFastFlick = nextY <= DETAIL_FAST_FLICK_MIN_DRAG && gestureState.vy <= DETAIL_FAST_FLICK_VELOCITY;
    return isPastThreshold || isVeryFastFlick;
  }

  const detailSheetResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          detailSheetVisible &&
          !detailExpanded &&
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderGrant: () => {
          detailDragExpandedRef.current = false;
          detailDragY.stopAnimation();
        },
        onPanResponderMove: (_event, gestureState) => {
          if (detailExpanded || detailDragExpandedRef.current) return;
          const nextY = Math.max(DETAIL_DRAG_LIMIT, Math.min(0, gestureState.dy));
          detailDragY.setValue(nextY);
          if (shouldExpandDetail(gestureState, nextY)) {
            expandDetailFromDrag();
          }
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (detailDragExpandedRef.current) return;
          if (shouldExpandDetail(gestureState, gestureState.dy)) {
            expandDetailFromDrag();
            return;
          }
          resetDetailDragPosition();
        },
        onPanResponderTerminate: () => {
          if (!detailDragExpandedRef.current) {
            resetDetailDragPosition();
          }
        },
      }),
    [detailDragY, detailExpanded, detailSheetVisible]
  );
  const detailMiniHeight = detailDragY.interpolate({
    inputRange: [DETAIL_DRAG_LIMIT, 0],
    outputRange: [DETAIL_MINI_HEIGHT + Math.abs(DETAIL_DRAG_LIMIT), DETAIL_MINI_HEIGHT],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    let isMounted = true;
    setActiveWorkspaceId(currentWorkspaceId);

    async function hydrateWorkspace() {
      if (!isFirebaseDbConfigured()) return;

      try {
        const [remotePlaces, remoteCollections] = await Promise.all([
          loadPlacesFromFirestore(),
          loadCollectionsFromFirestore(),
        ]);

        if (!isMounted) return;

        setPlaces(remotePlaces);
        if (remotePlaces.length > 0) {
          setSelectedPlace(remotePlaces[0]);
          setDetailSheetVisible(true);
          setDetailExpanded(false);
          setRoutePlaces(buildRoute(remotePlaces.slice(0, 4)));
        } else {
          setSelectedPlace(null);
          setDetailSheetVisible(false);
          setRoutePlaces([]);
        }

        if (remoteCollections.length > 0) {
          setCollections(remoteCollections);
          setSelectedCollectionId(remoteCollections[0].id);
        } else {
          setCollections([]);
          setSelectedCollectionId(null);
        }
      } catch (error) {
        console.warn('Failed to hydrate workspace', error);
        if (isMounted) {
          setMapStatus({
            status: 'firebase-error',
            message: error instanceof Error ? error.message : 'Firestore 데이터를 불러오지 못했습니다.',
          });
        }
      }
    }

    hydrateWorkspace();

    return () => {
      isMounted = false;
    };
  }, [currentWorkspaceId]);

  useEffect(() => {
    let isMounted = true;

    async function hydratePlaces() {
      if (!isFirebaseDbConfigured()) {
        if (isMounted) setMapStatus({ status: 'firebase-missing', message: 'Firebase 설정이 없어 DB 동기화를 건너뜁니다.' });
        return;
      }
      try {
        const remotePlaces = await loadPlacesFromFirestore();
        if (isMounted && remotePlaces.length > 0) {
          setPlaces(remotePlaces);
          setSelectedPlace(remotePlaces[0]);
          setDetailSheetVisible(true);
          setDetailExpanded(false);
          setRoutePlaces(buildRoute(remotePlaces.slice(0, 4)));
        }
        const remoteCollections = await loadCollectionsFromFirestore();
        if (isMounted && remoteCollections.length > 0) {
          setCollections(remoteCollections);
          setSelectedCollectionId(remoteCollections[0].id);
        }
      } catch (error) {
        console.warn('Failed to load Firestore places', error);
        if (isMounted) {
          setMapStatus({
            status: 'firebase-error',
            message: error instanceof Error ? error.message : 'Firestore 데이터를 불러오지 못했습니다.',
          });
        }
      }
    }

    async function loadLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (isMounted) setMapStatus({ status: 'location-denied', message: '위치 권한이 꺼져 있어요.' });
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (isMounted) {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      }
    }

    hydratePlaces();
    loadLocation().catch(() => {
      if (isMounted) setMapStatus({ status: 'location-error', message: '현재 위치를 가져오지 못했어요.' });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const placeKey = detailPlaceKey(selectedPlace);

    setDetailTab('photos');
    setReviewDraft({ rating: 5, comment: '' });
    setUserReviews([]);

    async function loadGoogleDetails() {
      if (!selectedPlace) {
        setGooglePlaceDetails({ status: 'idle', photos: [], reviews: [], message: '' });
        return;
      }

      const fallbackPhotos = selectedPlace.photoUrl ? [{ url: selectedPlace.photoUrl }] : [];
      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
      if (!apiBase) {
        setGooglePlaceDetails({
          status: fallbackPhotos.length ? 'ready' : 'unavailable',
          photos: fallbackPhotos,
          reviews: [],
          message: 'API 서버 주소가 필요합니다.',
        });
        return;
      }

      setGooglePlaceDetails({ status: 'loading', photos: fallbackPhotos, reviews: [], message: 'Google 사진과 리뷰를 불러오는 중...' });
      try {
        const detailParams = new URLSearchParams();
        if (selectedPlace.googlePlaceId) {
          detailParams.set('placeId', selectedPlace.googlePlaceId);
        } else {
          detailParams.set('name', selectedPlace.name || '');
          detailParams.set('address', selectedPlace.address || '');
          const coordinate = placeCoordinate(selectedPlace);
          if (coordinate) {
            detailParams.set('lat', String(coordinate.lat));
            detailParams.set('lng', String(coordinate.lng));
          }
        }

        const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/places/google-details?${detailParams.toString()}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || 'Google 장소 상세 정보를 불러오지 못했습니다.');
        }

        if (!isMounted || placeKey !== detailPlaceKey(selectedPlace)) return;
        setGooglePlaceDetails({
          status: 'ready',
          photos: Array.isArray(payload.photos) && payload.photos.length ? payload.photos : fallbackPhotos,
          reviews: Array.isArray(payload.reviews) ? payload.reviews : [],
          rating: payload.rating,
          userRatingsTotal: payload.userRatingsTotal,
          url: payload.url,
          message: '',
        });

        if (payload.googlePlaceId && !selectedPlace.googlePlaceId) {
          const enrichedPlace = {
            ...selectedPlace,
            googlePlaceId: payload.googlePlaceId,
            rating: payload.rating ?? selectedPlace.rating,
            userRatingsTotal: payload.userRatingsTotal ?? selectedPlace.userRatingsTotal,
          };
          setSelectedPlace((current) =>
            current?.id === selectedPlace.id ? { ...current, ...enrichedPlace } : current
          );
          setPlaces((current) =>
            current.map((place) => (place.id === selectedPlace.id ? { ...place, ...enrichedPlace } : place))
          );
          savePlaceToFirestore(enrichedPlace).catch((error) => {
            console.warn('Failed to persist resolved googlePlaceId', error);
          });
        }
      } catch (error) {
        if (!isMounted) return;
        setGooglePlaceDetails({
          status: fallbackPhotos.length ? 'ready' : 'error',
          photos: fallbackPhotos,
          reviews: [],
          message: error instanceof Error ? error.message : 'Google 장소 상세 정보를 불러오지 못했습니다.',
        });
      }
    }

    async function loadUserReviews() {
      if (!selectedPlace || !isFirebaseDbConfigured()) return;
      try {
        const reviews = await loadPlaceReviewsFromFirestore(placeKey);
        if (isMounted && placeKey === detailPlaceKey(selectedPlace)) {
          setUserReviews(reviews);
        }
      } catch (error) {
        console.warn('Failed to load place reviews', error);
      }
    }

    loadGoogleDetails();
    loadUserReviews();

    return () => {
      isMounted = false;
    };
  }, [selectedPlace?.id, selectedPlace?.googlePlaceId, selectedPlace?.photoUrl]);

  useEffect(() => {
    if (authUser?.userId) {
      loadFriendHub();
    }
  }, [authUser?.userId]);

  useEffect(() => {
    if (!authUser?.userId) return;
    if (pushTokenRegisteredForRef.current === authUser.userId) return;

    let cancelled = false;
    async function syncPushToken() {
      try {
        const token = await getExpoPushTokenForDevice();
        if (!token || cancelled) return;
        await requestApiJson(
          '/api/notifications/push-token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: authUser.userId,
              token,
              platform: Platform.OS,
            }),
          },
          '푸시 토큰 등록 실패:'
        );
        pushTokenRegisteredForRef.current = authUser.userId;
      } catch (error) {
        console.warn('Push token registration failed', error);
      }
    }

    syncPushToken();
    return () => {
      cancelled = true;
    };
  }, [authUser?.userId]);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1700);
  }

  async function readApiJson(response, fallbackMessage) {
    const text = await response.text();
    if (!text) {
      throw new Error(`${fallbackMessage} 서버 응답이 비어 있습니다. (${response.status})`);
    }

    try {
      return JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').slice(0, 120);
      throw new Error(`${fallbackMessage} JSON 응답이 아닙니다. (${response.status}) ${preview}`);
    }
  }

  function apiBaseUrl() {
    return process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || '';
  }

  async function requestApiJson(path, options = {}, fallbackMessage = 'API 요청 실패:') {
    const apiBase = apiBaseUrl();
    if (!apiBase) {
      throw new Error('EXPO_PUBLIC_API_BASE_URL이 필요합니다.');
    }
    const response = await fetch(`${apiBase}${path}`, options);
    const payload = await readApiJson(response, fallbackMessage);
    if (!response.ok) {
      throw new Error(payload?.message || fallbackMessage);
    }
    return payload;
  }

  async function getExpoPushTokenForDevice() {
    const currentPermission = await Notifications.getPermissionsAsync();
    let finalStatus = currentPermission.status;
    if (finalStatus !== 'granted') {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermission.status;
    }

    if (finalStatus !== 'granted') {
      showToast('푸시 알림 권한이 꺼져 있어요');
      return '';
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PUSH_PROJECT_ID,
    });
    return token.data;
  }

  function updateAuthDraft(key, value) {
    setAuthDraft((current) => ({ ...current, [key]: value }));
  }

  function applyAuthSuccess(payload, message) {
    setAuthUser(payload.user);
    setActiveWorkspaceId(payload.workspaceId || payload.user?.workspaceId || defaultWorkspaceId());
    setAuthStatus('ready');
    setAuthMessage(message);
    showToast(message);
  }

  async function submitPasswordAuth() {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!apiBase) {
      setAuthStatus('error');
      setAuthMessage('EXPO_PUBLIC_API_BASE_URL이 필요합니다.');
      showToast('API 서버 주소를 설정해 주세요');
      return;
    }

    const userId = authDraft.userId.trim().toLowerCase();
    const password = authDraft.password;
    const nickname = authDraft.nickname.trim();
    const age = Number(authDraft.age);

    if (!userId || !password) {
      setAuthStatus('error');
      setAuthMessage('아이디와 비밀번호를 입력해 주세요.');
      return;
    }

    if (authMode === 'register' && (!nickname || !authDraft.age)) {
      setAuthStatus('error');
      setAuthMessage('닉네임과 나이를 입력해 주세요.');
      return;
    }

    setAuthStatus('loading');
    setAuthMessage(authMode === 'register' ? '회원가입 중...' : '로그인 중...');

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body =
        authMode === 'register'
          ? {
              userId,
              password,
              nickname,
              age,
              gender: authDraft.gender,
            }
          : {
              userId,
              password,
            };

      const response = await fetch(`${apiBase.replace(/\/$/, '')}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readApiJson(response, authMode === 'register' ? '회원가입 실패:' : '로그인 실패:');

      if (!response.ok) {
        throw new Error(payload?.message || (authMode === 'register' ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.'));
      }

      applyAuthSuccess(payload, authMode === 'register' ? '회원가입 완료' : '로그인 완료');
      setAuthDraft((current) => ({ ...current, password: '' }));
    } catch (error) {
      console.warn('Password auth failed', error);
      setAuthStatus('error');
      setAuthMessage(error instanceof Error ? error.message : '인증에 실패했습니다.');
      showToast(authMode === 'register' ? '회원가입 실패' : '로그인 실패');
    }
  }

  function signOutPasswordUser() {
    setAuthUser(null);
    pushTokenRegisteredForRef.current = '';
    setAuthStatus('idle');
    setAuthMessage('로그아웃되었습니다.');
    setFriendHub({ friends: [], incoming: [], outgoing: [], inbox: [], publicCollections: [] });
    setFriendTarget('');
    setFriendMessage('');
    setActiveWorkspaceId(defaultWorkspaceId());
    showToast('로그아웃 완료');
  }

  async function loadFriendHub() {
    if (!authUser?.userId) return;
    setFriendStatus('loading');
    try {
      const userId = encodeURIComponent(authUser.userId);
      const [friendsPayload, requestsPayload, inboxPayload, publicCollectionsPayload] = await Promise.all([
        requestApiJson(`/api/friends?userId=${userId}`, {}, '친구 목록 불러오기 실패:'),
        requestApiJson(`/api/friends/requests?userId=${userId}`, {}, '친구 요청 불러오기 실패:'),
        requestApiJson(`/api/share/inbox?userId=${userId}`, {}, '공유함 불러오기 실패:'),
        requestApiJson(`/api/friends/public-collections?userId=${userId}`, {}, '친구 공개 컬렉션 불러오기 실패:'),
      ]);
      setFriendHub({
        friends: friendsPayload.friends || [],
        incoming: requestsPayload.incoming || [],
        outgoing: requestsPayload.outgoing || [],
        inbox: inboxPayload.items || [],
        publicCollections: publicCollectionsPayload.collections || [],
      });
      setFriendMessage('');
      setFriendStatus('ready');
    } catch (error) {
      console.warn('Friend hub failed', error);
      setFriendStatus('error');
      setFriendMessage(error instanceof Error ? error.message : '친구 정보를 불러오지 못했습니다.');
    }
  }

  async function sendFriendRequestFromSettings() {
    if (!authUser?.userId) {
      showToast('로그인이 필요해요');
      return;
    }
    const target = friendTarget.trim();
    if (!target) {
      setFriendMessage('친구 아이디 또는 친구 코드를 입력해 주세요.');
      return;
    }

    setFriendStatus('loading');
    try {
      await requestApiJson(
        '/api/friends/request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromUserId: authUser.userId, target }),
        },
        '친구 요청 실패:'
      );
      setFriendTarget('');
      showToast('친구 요청을 보냈어요');
      await loadFriendHub();
    } catch (error) {
      setFriendStatus('error');
      setFriendMessage(error instanceof Error ? error.message : '친구 요청에 실패했습니다.');
    }
  }

  async function respondFriendRequestFromSettings(requestId, action) {
    if (!authUser?.userId) return;
    setFriendStatus('loading');
    try {
      await requestApiJson(
        `/api/friends/requests/${encodeURIComponent(requestId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: authUser.userId }),
        },
        action === 'accept' ? '친구 요청 수락 실패:' : '친구 요청 거절 실패:'
      );
      showToast(action === 'accept' ? '친구가 추가됐어요' : '친구 요청을 거절했어요');
      await loadFriendHub();
    } catch (error) {
      setFriendStatus('error');
      setFriendMessage(error instanceof Error ? error.message : '친구 요청 처리에 실패했습니다.');
    }
  }

  async function removeFriendFromSettings(friendUserId) {
    if (!authUser?.userId) return;
    setFriendStatus('loading');
    try {
      await requestApiJson(
        `/api/friends/${encodeURIComponent(friendUserId)}?userId=${encodeURIComponent(authUser.userId)}`,
        { method: 'DELETE' },
        '친구 삭제 실패:'
      );
      showToast('친구를 삭제했어요');
      await loadFriendHub();
    } catch (error) {
      setFriendStatus('error');
      setFriendMessage(error instanceof Error ? error.message : '친구 삭제에 실패했습니다.');
    }
  }

  function currentItinerarySharePayload() {
    if (!aiGeneratedItinerary?.length) return null;
    const base = routeBasePlace || resolveRouteBasePlace();
    const orderedPlaces = routePlaces.length ? routePlaces : base ? routePlacesInsideBaseCircle(base, places) : [];
    const snapshot = buildItinerarySnapshot({
      routeSnapshot: createCurrentRouteSnapshot(),
      basePlace: base,
      routePlaces: orderedPlaces,
      visitDate: routeScheduleDate,
      itinerary: aiGeneratedItinerary,
      provider: routeScheduleProvider,
      region: aiSelectedRegion || getRegionOfAddress(base?.address),
    });
    return {
      type: 'itinerary',
      targetId: snapshot.id,
      title: snapshot.title,
      payload: snapshot,
    };
  }

  async function shareCurrentItineraryWithFriend(friend) {
    if (!authUser?.userId) return;
    const share = currentItinerarySharePayload();
    if (!share) {
      showToast('먼저 AI 일정표를 생성해 주세요');
      return;
    }

    setFriendStatus('loading');
    try {
      await requestApiJson(
        '/api/share',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerUserId: authUser.userId,
            sharedWithUserIds: [friend.userId],
            type: share.type,
            targetId: share.targetId,
            title: share.title,
            payload: share.payload,
            permission: 'view',
          }),
        },
        '친구 공유 실패:'
      );
      showToast(`${friend.nickname || friend.userId}님에게 일정을 공유했어요`);
      await loadFriendHub();
    } catch (error) {
      setFriendStatus('error');
      setFriendMessage(error instanceof Error ? error.message : '친구 공유에 실패했습니다.');
    }
  }

  function openFriendPublicCollection(collection) {
    setFriendPublicCollectionOpen(collection);
    setTab('collections');
    showToast(`${collection.ownerNickname || '친구'}님의 컬렉션을 열었어요`);
  }

  function closeFriendPublicCollection() {
    setFriendPublicCollectionOpen(null);
    setTab('collections');
  }

  function openFriendPublicPlace(place) {
    if (!place?.name) return;
    const nextPlace = {
      ...place,
      id: place.id || `friend-place-${Date.now()}`,
      pinColor: place.pinColor || colorForCategory(place.category),
    };
    setSelectedPlace(nextPlace);
    setDetailSheetVisible(true);
    setDetailExpanded(false);
    setFriendPublicCollectionOpen(null);
    setTab('map');
    focusMapOnPlace(nextPlace);
  }

  async function saveUserPlaceReview() {
    if (!selectedPlace) return;

    const comment = reviewDraft.comment.trim();
    if (!comment) {
      showToast('리뷰 댓글을 입력해 주세요');
      return;
    }

    setReviewSaving(true);
    try {
      const savedReview = await savePlaceReviewToFirestore(detailPlaceKey(selectedPlace), {
        placeName: selectedPlace.name,
        rating: reviewDraft.rating,
        comment,
        createdAt: new Date().toISOString(),
      });
      setUserReviews((current) => [savedReview, ...current]);
      setReviewDraft({ rating: 5, comment: '' });
      showToast('내 리뷰를 저장했어요');
    } catch (error) {
      console.warn('Failed to save place review', error);
      showToast(error instanceof Error ? error.message : '리뷰 저장에 실패했어요');
    } finally {
      setReviewSaving(false);
    }
  }

  function focusMapOnPlace(place, zoom = 16) {
    if (!placeCoordinate(place)) return;
    [220, 720].forEach((delay) => {
      setTimeout(() => {
        mapRef.current?.focusPlace(place, zoom);
      }, delay);
    });
  }

  function focusRouteBaseCircle(place) {
    if (!placeCoordinate(place)) return;
    [180, 620].forEach((delay) => {
      setTimeout(() => {
        mapRef.current?.showRouteBaseCircle(place, ROUTE_BASE_RADIUS_METERS);
      }, delay);
    });
  }

  function fitMapToRoutePlaces(nextPlaces, padding = 110) {
    const coordinates = nextPlaces.map(placeCoordinate).filter(Boolean);
    if (coordinates.length === 0) return;
    [280, 850].forEach((delay) => {
      setTimeout(() => {
        mapRef.current?.fitCoordinates(coordinates, padding);
      }, delay);
    });
  }

  async function pickScreenshot() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('사진 접근 권한이 필요해요');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.82,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const imagePayload = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri;
    setUploadedImage(imagePayload);
    triggerCaptureExtraction(imagePayload);
  }

  async function triggerCaptureExtraction(imagePayload, promptHint = '') {
    setExtracting(true);
    setExtractResult(null);
    setVerification(null);

    const steps = [
      '스크린샷 이미지를 서버로 전송 중...',
      'Gemini가 이미지 속 텍스트와 장소 단서를 분석 중...',
      '장소명, 주소, 카테고리, 좌표를 JSON으로 정리 중...',
      '검증 폼에 분석 결과를 채우는 중...',
    ];

    let stepIndex = 0;
    setExtractStep(steps[stepIndex]);
    const interval = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      setExtractStep(steps[stepIndex]);
    }, 1000);

    try {
      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
      if (!apiBase) throw new Error('EXPO_PUBLIC_API_BASE_URL이 비어 있습니다.');

      const response = await Promise.race([
        fetch(`${apiBase.replace(/\/$/, '')}/api/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imagePayload, promptHint }),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('server timeout')), 20000)),
      ]);

      const payload = await response.json();

      if (!response.ok) {
        showToast(payload?.error || '장소 분석에 실패했어요. 다시 시도해주세요.');
        setUploadedImage(null);
        return;
      }

      const result = normalizeExtractedPlace(payload, imagePayload);
      setExtractResult(result);
      setVerification(result);
      showToast('이미지 분석 완료');
    } catch (error) {
      console.warn('Extract request failed', error);
      showToast('서버에 연결할 수 없어요. PC 서버 실행과 Wi-Fi 연결을 확인해주세요.');
      setUploadedImage(null);
    } finally {
      clearInterval(interval);
      setExtracting(false);
    }
  }

  function saveExtracted() {
    const source = verification || extractResult;
    if (!source?.name) return;

    const nextPlace = {
      ...source,
      id: `place-${Date.now()}`,
      category: normalizeCategoryLabel(source.category ?? source.categoryLabel ?? source.type ?? source.placeType),
      latitude: Number(source.latitude) || 37.5446,
      longitude: Number(source.longitude) || 127.0559,
      confidence: source.confidence || 0.9,
      screenshotText: source.screenshotText || '',
      originalImage: source.originalImage || uploadedImage,
      pinColor: '#FFFFFF',
      collectionIds: [],
    };

    setPlaces((current) => [nextPlace, ...current]);
    savePlaceToFirestore(nextPlace)
      .then(() => showToast(`${nextPlace.name} DB 저장 완료`))
      .catch((error) => {
        console.warn('Failed to save place to Firestore', error);
        showToast('지도에는 저장했지만 DB 저장은 실패했어요');
      });
    setSelectedPlace(nextPlace);
    setDetailSheetVisible(true);
    setDetailExpanded(false);
    setUploadedImage(null);
    setExtractResult(null);
    setVerification(null);
    setTab('map');
    focusMapOnPlace(nextPlace);
    showToast(`${nextPlace.name} 지도 등록 완료 · DB 저장 중`);
    setTimeout(() => {
      Alert.alert(
        '컬렉션에 저장하겠습니까?',
        `${nextPlace.name}을 컬렉션에 같이 담을 수 있어요.`,
        [
          {
            text: '아니오',
            style: 'cancel',
            onPress: () => showToast('흰색 핀으로 지도에만 등록했어요'),
          },
          {
            text: '예',
            onPress: () => openCollectionPicker(nextPlace),
          },
        ]
      );
    }, 320);
  }

  function openCollectionPicker(place) {
    if (collections.length === 0) {
      setCollectionPickerPlace(place);
      createCollection();
      return;
    }
    setCollectionPickerPlace(place);
  }

  function openRouteCollectionPicker(routeSnapshot) {
    if (!routeSnapshot?.places?.length) {
      showToast('저장할 동선이 없어요');
      return;
    }

    setRouteSelectMode(false);
    setRouteSearchOpen(false);
    if (collections.length === 0) {
      setCollectionPickerRoute(routeSnapshot);
      createCollection();
      return;
    }

    setCollectionPickerRoute(routeSnapshot);
  }

  function addPlaceToCollection(place, collectionId) {
    const nextCategory = normalizeCategoryLabel(place.category ?? place.categoryLabel ?? place.type ?? place.placeType);
    const targetCollection = collections.find((collection) => collection.id === collectionId);
    const nextVisual = {
      pinColor: targetCollection?.color || colorForCategory(nextCategory),
      pinIcon: targetCollection?.icon || iconForCategory(nextCategory),
    };
    const nextPlace = {
      ...place,
      category: nextCategory,
      ...nextVisual,
      collectionIds: Array.from(new Set([...(place.collectionIds || []), collectionId])),
    };
    const placeSnapshot = compactCollectionPlace(nextPlace);
    const mergeCollectionPlace = (collection) => {
      const currentPlaceIds = Array.isArray(collection.placeIds) ? collection.placeIds : [];
      const currentPlaces = Array.isArray(collection.places) ? collection.places : [];
      return {
        ...collection,
        placeIds: currentPlaceIds.includes(place.id) ? currentPlaceIds : [place.id, ...currentPlaceIds],
        places: [placeSnapshot, ...currentPlaces.filter((item) => item.id !== place.id)],
      };
    };
    const nextCollection = targetCollection ? mergeCollectionPlace(targetCollection) : null;
    setCollections((current) =>
      current.map((collection) =>
        collection.id === collectionId ? mergeCollectionPlace(collection) : collection
      )
    );
    setPlaces((current) =>
      current.map((item) =>
        item.id === place.id
          ? {
              ...item,
              ...nextVisual,
              collectionIds: Array.from(new Set([...(item.collectionIds || []), collectionId])),
            }
          : item
      )
    );
    setSelectedPlace((current) =>
      current?.id === place.id
        ? {
            ...current,
            ...nextVisual,
            collectionIds: Array.from(new Set([...(current.collectionIds || []), collectionId])),
          }
        : current
    );
    savePlaceToFirestore(nextPlace).catch(() => {});
    if (nextCollection) {
      saveCollectionToFirestore(nextCollection).catch(() => {});
    }
    setSelectedCollectionId(collectionId);
    setCollectionPickerPlace(null);
    const collectionName = collections.find((item) => item.id === collectionId)?.name || '컬렉션';
    showToast(`${collectionName}에 저장했어요`);
  }

  function addRouteToCollection(routeSnapshot, collectionId) {
    const targetCollection = collections.find((collection) => collection.id === collectionId);
    if (!targetCollection) {
      showToast('컬렉션을 찾지 못했어요');
      return;
    }

    const nextRoutes = [
      routeSnapshot,
      ...(Array.isArray(targetCollection.routes) ? targetCollection.routes.filter((route) => route.id !== routeSnapshot.id) : []),
    ];
    const nextCollection = {
      ...targetCollection,
      routes: nextRoutes,
      updatedAt: new Date().toISOString(),
    };

    setCollections((current) => current.map((collection) => (collection.id === collectionId ? nextCollection : collection)));
    setSelectedCollectionId(collectionId);
    setCollectionPickerRoute(null);
    setRouteSelectMode(false);
    setRouteSearchOpen(false);
    saveRouteToFirestore(routeSnapshot).catch((error) => {
      console.warn('Failed to save route to Firestore', error);
    });
    saveCollectionToFirestore(nextCollection).catch(() => {});
    showToast(`${nextCollection.name}에 동선을 저장했어요`);
  }

  function createCurrentRouteSnapshot() {
    const base = resolveRouteBasePlace();
    const orderedPlaces = routePlaces.length ? routePlaces : base ? routePlacesInsideBaseCircle(base, places) : [];
    if (!base || orderedPlaces.length === 0) return null;

    return buildCollectionRouteSnapshot({
      basePlace: base,
      routePlaces: orderedPlaces,
      visitDate: routeScheduleDate,
      itinerary: aiGeneratedItinerary,
      provider: routeScheduleProvider,
    });
  }

  function saveCurrentRouteToCollection() {
    const snapshot = createCurrentRouteSnapshot();
    if (!snapshot) {
      showToast('먼저 동선을 만들어 주세요');
      return;
    }
    let nextSnapshot = snapshot;
    if (Array.isArray(snapshot.itinerary) && snapshot.itinerary.length) {
      const itinerarySnapshot = buildItinerarySnapshot({
        routeSnapshot: snapshot,
        basePlace: snapshot.basePlace,
        routePlaces: snapshot.places || [],
        visitDate: snapshot.visitDate,
        itinerary: snapshot.itinerary,
        provider: snapshot.provider,
        region: getRegionOfAddress(snapshot.basePlace?.address),
      });
      nextSnapshot = { ...snapshot, itineraryId: itinerarySnapshot.id };
      saveItineraryToFirestore(itinerarySnapshot).catch((error) => {
        console.warn('Failed to save route itinerary to Firestore', error);
      });
    }
    saveRouteToFirestore(nextSnapshot).catch((error) => {
      console.warn('Failed to save route to Firestore', error);
    });
    openRouteCollectionPicker(nextSnapshot);
  }

  function openSavedCollectionRoute(routeSnapshot) {
    const base =
      places.find((place) => place.id === routeSnapshot.basePlace?.id) ||
      routeSnapshot.basePlace ||
      null;
    const restoredPlaces = (routeSnapshot.placeIds || [])
      .map((placeId) => places.find((place) => place.id === placeId))
      .filter(Boolean);
    const fallbackPlaces = restoredPlaces.length ? restoredPlaces : routeSnapshot.places || [];

    setRouteBasePlace(base);
    setRouteBaseQuery(base?.name || '');
    setRoutePlaces(fallbackPlaces);
    setRouteScheduleDate(routeSnapshot.visitDate || routeScheduleDate);
    setAiGeneratedItinerary(Array.isArray(routeSnapshot.itinerary) && routeSnapshot.itinerary.length ? routeSnapshot.itinerary : null);
    setRouteScheduleProvider(routeSnapshot.provider || '');
    setTab('map');
    setRouteSelectMode(true);
    setRouteSearchOpen(false);
    fitMapToRoutePlaces([base, ...fallbackPlaces].filter(Boolean));
    showToast(`${routeSnapshot.title || '저장된 동선'}을 불러왔어요`);
  }

  function createCollection() {
    const nextIndex = collections.length + 1;
    setCollectionDraft({
      name: `새 컬렉션 ${nextIndex}`,
      icon: collectionIconOptions[collections.length % collectionIconOptions.length],
      color: collectionColorOptions[collections.length % collectionColorOptions.length],
      visibility: 'private',
    });
    setCollectionCreatorOpen(true);
  }

  function saveCreatedCollection() {
    const nextIndex = collections.length + 1;
    const draftName = collectionDraft.name.trim() || `새 컬렉션 ${nextIndex}`;
    const initialRoutes = collectionPickerRoute ? [collectionPickerRoute] : [];
    const nextCollectionId = `collection-${Date.now()}`;
    const initialPlace = collectionPickerPlace
      ? {
          ...collectionPickerPlace,
          pinColor: collectionDraft.color,
          pinIcon: collectionDraft.icon,
          collectionIds: Array.from(new Set([...(collectionPickerPlace.collectionIds || []), nextCollectionId])),
        }
      : null;
    const nextCollection = {
      id: nextCollectionId,
      name: draftName,
      color: collectionDraft.color,
      icon: collectionDraft.icon,
      visibility: collectionDraft.visibility || 'private',
      placeIds: initialPlace ? [initialPlace.id] : [],
      places: initialPlace ? [compactCollectionPlace(initialPlace)] : [],
      routes: initialRoutes,
      createdAt: Date.now(),
    };
    setCollections((current) => [nextCollection, ...current]);
    setSelectedCollectionId(nextCollection.id);
    if (collectionPickerPlace) {
      const nextVisual = { pinColor: nextCollection.color, pinIcon: nextCollection.icon };
      setCollections((current) =>
        current.map((collection) =>
          collection.id === nextCollection.id
            ? { ...collection, placeIds: [collectionPickerPlace.id] }
            : collection
        )
      );
      setPlaces((current) =>
        current.map((place) =>
          place.id === collectionPickerPlace.id
            ? {
                ...place,
                ...nextVisual,
                collectionIds: Array.from(new Set([...(place.collectionIds || []), nextCollection.id])),
              }
            : place
        )
      );
      setSelectedPlace((current) =>
        current?.id === collectionPickerPlace.id
          ? {
              ...current,
              ...nextVisual,
              collectionIds: Array.from(new Set([...(current.collectionIds || []), nextCollection.id])),
            }
          : current
      );
      savePlaceToFirestore(initialPlace).catch(() => {});
      saveCollectionToFirestore(nextCollection).catch(() => {});
      setCollectionPickerPlace(null);
      setCollectionPickerRoute(null);
      setCollectionCreatorOpen(false);
      showToast(`${nextCollection.name}에 저장했어요`);
      return;
    }
    saveCollectionToFirestore(nextCollection).catch(() => {});
    setCollectionPickerRoute(null);
    setCollectionCreatorOpen(false);
    showToast(initialRoutes.length ? `${nextCollection.name}에 동선을 저장했어요` : `${nextCollection.name} 생성 완료`);
  }

  function updateSelectedCollectionVisibility(visibility) {
    if (!selectedCollection) return;
    const nextCollection = {
      ...selectedCollection,
      visibility,
    };
    setCollections((current) =>
      current.map((collection) => (collection.id === selectedCollection.id ? nextCollection : collection))
    );
    saveCollectionToFirestore(nextCollection)
      .then(() => showToast(visibility === 'friends' ? '친구 공개로 변경했어요' : '나만 보기로 변경했어요'))
      .catch((error) => {
        console.warn('Failed to update collection visibility', error);
        showToast('공개 범위 저장에 실패했어요');
      });
  }

  function deleteSelectedCollection() {
    if (!selectedCollection) {
      showToast('삭제할 컬렉션이 없어요');
      return;
    }
    Alert.alert('컬렉션을 삭제할까요?', `${selectedCollection.name}만 삭제되고 장소는 지도에 남아요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          const removedId = selectedCollection.id;
          const remainingCollections = collections.filter((collection) => collection.id !== removedId);
          const visualForRemainingCollections = (collectionIds) => {
            const firstCollection = (Array.isArray(collectionIds) ? collectionIds : [])
              .map((id) => remainingCollections.find((collection) => collection.id === id))
              .find(Boolean);
            return firstCollection
              ? { pinColor: firstCollection.color || '#3182F6', pinIcon: firstCollection.icon || 'albums-outline' }
              : { pinColor: '#FFFFFF', pinIcon: '' };
          };
          setCollections((current) => {
            const next = current.filter((collection) => collection.id !== removedId);
            setSelectedCollectionId(next[0]?.id || null);
            return next;
          });
          setPlaces((current) =>
            current.map((place) => {
              const nextIds = (place.collectionIds || []).filter((id) => id !== removedId);
              const nextVisual = visualForRemainingCollections(nextIds);
              const nextPlace = {
                ...place,
                collectionIds: nextIds,
                ...nextVisual,
              };
              if ((place.collectionIds || []).includes(removedId)) {
                savePlaceToFirestore(nextPlace).catch(() => {});
              }
              return nextPlace;
            })
          );
          setSelectedPlace((current) => {
            if (!current) return current;
            const nextIds = (current.collectionIds || []).filter((id) => id !== removedId);
            const nextVisual = visualForRemainingCollections(nextIds);
            return {
              ...current,
              collectionIds: nextIds,
              ...nextVisual,
            };
          });
          deleteCollectionFromFirestore(removedId).catch(() => {});
          showToast('컬렉션을 삭제했어요');
        },
      },
    ]);
  }

  function makeRoute() {
    setRouteSelectMode(true);
    setRouteSearchOpen(false);
    setDetailSheetVisible(false);
    setDetailExpanded(false);
    setTab('map');
    if (selectedPlace) {
      setRouteBasePlace(selectedPlace);
      setRouteBaseQuery(selectedPlace.name);
      setRoutePlaces(routePlacesInsideBaseCircle(selectedPlace, places));
      focusRouteBaseCircle(selectedPlace);
    } else if (routeBasePlace) {
      setRoutePlaces(routePlacesInsideBaseCircle(routeBasePlace, places));
      focusRouteBaseCircle(routeBasePlace);
    }
    showToast('기준 원 안의 저장 장소로 스마트 동선을 만들어요');
  }

  async function selectRouteBase(place) {
    setRouteBasePlace(place);
    setRouteBaseQuery(place.name);
    setRouteSearchOpen(false);
    const circlePlaces = routePlacesInsideBaseCircle(place, places);
    let nextRoute = circlePlaces;
    try {
      const backendRoute = await requestSmartRouteFromBackend(place);
      if (backendRoute?.length) {
        const insideIds = new Set(circlePlaces.map((item) => item.id));
        nextRoute = backendRoute.filter((item) => insideIds.has(item.id));
        if (!nextRoute.length) nextRoute = circlePlaces;
      }
    } catch (error) {
      console.warn('Backend smart route failed; using local fallback', error);
    }
    setRoutePlaces(nextRoute);
    focusRouteBaseCircle(place);
    showToast(`${place.name} 기준 원 안의 저장 장소 ${nextRoute.length}곳을 정리했어요`);
  }

  function resolveRouteBasePlace() {
    if (routeBasePlace && placeCoordinate(routeBasePlace)) return routeBasePlace;
    const text = routeBaseQuery.trim().toLowerCase();
    if (!text) return null;
    return places.find((place) => `${place.name} ${place.address}`.toLowerCase().includes(text) && placeCoordinate(place)) || null;
  }

  async function requestSmartRouteFromBackend(base) {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!apiBase) return null;
    const circlePlaces = routePlacesInsideBaseCircle(base, places);

    const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/routes/smart-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basePlace: base,
        places: circlePlaces,
        limit: circlePlaces.length || 6,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || '백엔드 스마트 동선 생성에 실패했습니다.');
    }
    return Array.isArray(payload.routePlaces) ? payload.routePlaces : null;
  }

  async function completeSmartRoute() {
    const base = resolveRouteBasePlace();
    if (!base) {
      setRouteSearchOpen(true);
      showToast('동선 기준이 될 숙소나 장소를 먼저 검색해 주세요');
      return null;
    }

    const circlePlaces = routePlacesInsideBaseCircle(base, places);
    let nextRoute = circlePlaces;
    try {
      const backendRoute = await requestSmartRouteFromBackend(base);
      if (backendRoute?.length) {
        const insideIds = new Set(circlePlaces.map((place) => place.id));
        nextRoute = backendRoute.filter((place) => insideIds.has(place.id));
        if (!nextRoute.length) nextRoute = circlePlaces;
      }
    } catch (error) {
      console.warn('Backend smart route failed; using local fallback', error);
    }

    if (nextRoute.length === 0) {
      showToast('기준점 주변에 동선을 만들 저장 장소가 없어요');
      return null;
    }

    setRouteBasePlace(base);
    setRouteBaseQuery(base.name);
    setRoutePlaces(nextRoute);
    focusRouteBaseCircle(base);
    setAiSelectedRegion(getRegionOfAddress(base.address));
    saveRouteToFirestore(
      buildCollectionRouteSnapshot({
        basePlace: base,
        routePlaces: nextRoute,
        visitDate: routeScheduleDate,
        itinerary: [],
        provider: 'nearest-distance',
      })
    ).catch((error) => {
      console.warn('Failed to save smart route to Firestore', error);
    });
    showToast(`${base.name} 반경 ${formatMoveDistance(ROUTE_BASE_RADIUS_METERS)} 안의 저장 장소로 동선을 만들었어요`);
    return { base, route: nextRoute };
  }

  async function finishSmartRouteSelection() {
    if (routeBasePlace || routeBaseQuery.trim()) {
      await completeSmartRoute();
    }
    closeRouteSelectMode();
  }

  async function openSmartSchedulePage() {
    const result = await completeSmartRoute();
    if (!result) return;
    setRouteSelectMode(false);
    setRouteScheduleOpen(true);
    setAiGeneratedItinerary(null);
    setRouteScheduleProvider('');
  }

  function setSmartPresetDate(key) {
    if (key === 'today') setRouteScheduleDate(todayDateString());
    if (key === 'tomorrow') setRouteScheduleDate(todayDateString(1));
    if (key === 'weekend') setRouteScheduleDate(weekendDateString());
  }

  async function generateSmartSchedule() {
    const base = resolveRouteBasePlace();
    const orderedPlaces = routePlaces.length ? routePlaces : base ? routePlacesInsideBaseCircle(base, places) : [];
    if (!base || orderedPlaces.length === 0) {
      showToast('먼저 기준 장소로 동선을 만들어 주세요');
      return;
    }

    setRouteScheduleLoading(true);
    setAiSelectedDate(routeScheduleDate);
    setAiSelectedRegion(getRegionOfAddress(base.address));

    const fallback = buildSmartItinerary(base, orderedPlaces);
    let nextItinerary = fallback;
    let provider = 'fallback';

    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (apiBase) {
      try {
        const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/ai/itinerary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basePlace: base,
            places: orderedPlaces,
            visitDate: routeScheduleDate,
          }),
        });
        const payload = await response.json();
        const geminiItems = buildItineraryFromGemini(payload?.itinerary, orderedPlaces);
        if (response.ok && geminiItems?.length) {
          nextItinerary = geminiItems;
          provider = payload.provider || 'gemini';
        }
      } catch {
        provider = 'fallback';
      }
    }

    setAiGeneratedItinerary(nextItinerary);
    setRouteScheduleProvider(provider);
    setRouteScheduleLoading(false);
    const routeSnapshot = buildCollectionRouteSnapshot({
      basePlace: base,
      routePlaces: orderedPlaces,
      visitDate: routeScheduleDate,
      itinerary: nextItinerary,
      provider,
    });
    const itinerarySnapshot = buildItinerarySnapshot({
      routeSnapshot,
      basePlace: base,
      routePlaces: orderedPlaces,
      visitDate: routeScheduleDate,
      itinerary: nextItinerary,
      provider,
      region: getRegionOfAddress(base.address),
    });
    saveRouteToFirestore({ ...routeSnapshot, itineraryId: itinerarySnapshot.id }).catch((error) => {
      console.warn('Failed to save generated route to Firestore', error);
    });
    saveItineraryToFirestore(itinerarySnapshot).catch((error) => {
      console.warn('Failed to save itinerary to Firestore', error);
    });
    showToast(provider === 'gemini' ? 'Gemini AI 일정표 생성 완료' : '기본 AI 일정표 생성 완료');
  }

  async function shareAiItinerary() {
    if (!aiGeneratedItinerary?.length) return;
    const body = aiGeneratedItinerary
      .map((item, index) => {
        const moveText = item.transitToNext ? `\n   ▼ 다음 장소로 이동: ${item.transitToNext.text}` : '';
        return `📍 [STEP ${index + 1}] ${item.time} - ${item.place.name} (${item.place.category})\n   - 주요 활동: ${item.activity} (${item.duration})\n   - 영업 상태: ${item.hoursCheck}\n   - AI 꿀팁: "${item.tip}"${moveText}`;
      })
      .join('\n\n');
    const message = `[스팟로그] AI 추천 ${aiSelectedRegion} 데일리 일정표 📅\n방문 예정일: ${aiSelectedDate}\nAI가 영업시간과 이동 거리를 최적화한 최상의 동선입니다!\n\n${body}`;

    try {
      await Share.share({ message });
      showToast('AI 일정표 공유 준비 완료');
    } catch {
      showToast('공유를 열지 못했어요');
    }
  }
  function handleMapSelectPlace(placeId) {
    const nextPlace = places.find((place) => place.id === placeId);
    if (nextPlace) {
      setSelectedPlace(nextPlace);
      setDetailSheetVisible(true);
      setDetailExpanded(false);
      setRouteExplore({ status: 'idle', selectedMode: '', routes: [], message: '' });
      setTransitRealtime({ status: 'idle', message: '', buses: [], subwayMessage: '' });
      mapRef.current?.clearRoutePolyline();
      focusMapOnPlace(nextPlace);
    }
  }

  function handleExternalPlace(place) {
    if (!place?.name) return;
    const nextPlace = {
      id: place.id || `google-${place.googlePlaceId || Date.now()}`,
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      category: normalizeCategoryLabel(categoryFromGoogleTypes(place.googleTypes)),
      address: place.address || 'Google 지도 등록 장소',
      latitude: Number(place.latitude) || 37.5446,
      longitude: Number(place.longitude) || 127.0559,
      hours: place.hours || '영업시간 확인 필요',
      menu: '',
      reviewSummary: place.rating
        ? `Google 지도 평점 ${place.rating}${place.userRatingsTotal ? ` · 리뷰 ${place.userRatingsTotal}개` : ''}`
        : 'Google 지도에 등록된 장소입니다.',
      screenshotText: 'Google Maps POI',
      confidence: 1,
      provider: 'google',
      photoUrl: place.photoUrl,
      pinColor: '#FFFFFF',
      collectionIds: [],
    };

    setSelectedPlace(nextPlace);
    setDetailSheetVisible(true);
    setDetailExpanded(false);
    setRouteExplore({ status: 'idle', selectedMode: '', routes: [], message: '' });
    setTransitRealtime({ status: 'idle', message: '', buses: [], subwayMessage: '' });
    mapRef.current?.clearRoutePolyline();
    focusMapOnPlace(nextPlace);
  }

  function handleRouteCircleSelected(payload) {
    const ids = payload?.ids || [];
    const selected = ids
      .map((id) => visiblePlaces.find((place) => place.id === id))
      .filter(Boolean);
    const source = selected.length >= 2 ? selected : visiblePlaces.slice(0, 5);
    const nextRoute = buildRoute(source);

    setRoutePlaces(nextRoute.length >= 2 ? nextRoute : buildRoute(places.slice(0, 4)));
    if (selected.length >= 2) {
      showToast(`${selected.length}곳으로 동선을 만들었어요`);
    } else {
      showToast('원 안 장소가 적어서 보이는 핫플로 동선을 만들었어요');
    }
  }

  function closeRouteSelectMode() {
    setRouteSelectMode(false);
    setRouteSearchOpen(false);
    mapRef.current?.clearRouteCircle();
  }

  async function fetchTransitRealtime(route) {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!apiBase) {
      setTransitRealtime({
        status: 'error',
        message: 'EXPO_PUBLIC_API_BASE_URL을 설정해 주세요',
        buses: [],
        subwayMessage: '',
      });
      return;
    }

    setTransitRealtime({
      status: 'loading',
      message: '실시간 대중교통 정보를 불러오는 중...',
      buses: [],
      subwayMessage: '',
    });

    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/transit/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityCode: process.env.EXPO_PUBLIC_TAGO_BUS_CITY_CODE || '',
          routeId: process.env.EXPO_PUBLIC_TAGO_BUS_ROUTE_ID || '',
          transitSteps: route?.transitSteps || [],
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || '실시간 대중교통 정보를 불러오지 못했습니다');
      }

      setTransitRealtime({
        status: payload.status || 'ready',
        message: payload.bus?.message || payload.message || '',
        buses: payload.bus?.buses || [],
        subwayMessage: payload.subway?.message || '',
      });
    } catch (error) {
      setTransitRealtime({
        status: 'error',
        message: error instanceof Error ? error.message : '실시간 대중교통 정보를 불러오지 못했습니다',
        buses: [],
        subwayMessage: '',
      });
    }
  }

  async function renderRouteMode(route) {
    if (!route?.encodedPolyline) {
      showToast(route?.message || '이 이동수단의 경로가 없습니다');
      return;
    }

    setRouteExplore((current) => ({
      ...current,
      selectedMode: route.mode,
      message: '',
    }));
    mapRef.current?.renderRoutePolyline(route.encodedPolyline);
    if (route.mode === 'TRANSIT') {
      await fetchTransitRealtime(route);
    } else {
      setTransitRealtime({ status: 'idle', message: '', buses: [], subwayMessage: '' });
    }
  }

  async function exploreSelectedPlaceRoute() {
    if (!selectedPlace) return;

    const origin = userLocation ? placeCoordinate(userLocation) : null;
    const destination = placeCoordinate(selectedPlace);

    if (!origin) {
      showToast('현재 위치를 먼저 확인해 주세요');
      mapRef.current?.runMapCommand('centerUser');
      return;
    }

    if (!destination) {
      showToast('도착지 좌표가 없어 경로를 찾을 수 없어요');
      return;
    }

    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (!apiBase) {
      showToast('EXPO_PUBLIC_API_BASE_URL을 설정해 주세요');
      return;
    }

    setRouteExplore({
      status: 'loading',
      selectedMode: '',
      routes: [],
      message: '경로 계산 중...',
    });

    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/routes/multi-modal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          modes: routeExploreModes.map((item) => item.key),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || '경로 탐색에 실패했습니다');
      }

      const routes = Array.isArray(payload.routes) ? payload.routes : [];
      const firstReady = routes.find((route) => route.status === 'ready' && route.encodedPolyline);
      const firstMessage = routes.find((route) => route.message)?.message || '사용 가능한 경로가 없습니다';

      setRouteExplore({
        status: firstReady ? 'ready' : 'unavailable',
        selectedMode: firstReady?.mode || '',
        routes,
        message: firstReady ? '' : firstMessage,
      });

      if (firstReady) {
        mapRef.current?.renderRoutePolyline(firstReady.encodedPolyline);
        showToast(`${selectedPlace.name}까지 경로를 표시했어요`);
      } else {
        mapRef.current?.clearRoutePolyline();
        showToast(firstMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '경로 탐색 중 문제가 발생했습니다';
      setRouteExplore({
        status: 'error',
        selectedMode: '',
        routes: [],
        message,
      });
      mapRef.current?.clearRoutePolyline();
      showToast(message);
    }
  }

  function updateVerification(key, value) {
    setVerification((current) => ({ ...(current || {}), [key]: value }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      {tab === 'map' && (
        <View style={styles.mapScreen}>
          <GoogleMapWebView
            ref={mapRef}
            places={mapPlaces}
            selectedPlace={mapSelectedPlace}
            userLocation={userLocation}
            onSelectPlace={handleMapSelectPlace}
            onExternalPlace={handleExternalPlace}
            onMapPress={() => {
              setDetailSheetVisible(false);
              setDetailExpanded(false);
            }}
            onStatusChange={setMapStatus}
            onRouteChange={setRouteInfo}
            onRouteCircleSelected={handleRouteCircleSelected}
          />

          <TouchableOpacity style={styles.searchBox} activeOpacity={0.92}>
            <Glass style={styles.searchGlass}>
              <Ionicons name="search" size={20} color="#3182F6" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="장소, 주소, 카테고리 검색"
                placeholderTextColor="#8B95A1"
                style={styles.searchInput}
              />
            </Glass>
          </TouchableOpacity>

          <View style={styles.categoryRail}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRailContent}>
              {categories.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  onPress={() => setCategory(item.label)}
                  style={[styles.categoryChip, category === item.label && styles.categoryChipOn]}
                >
                  <Ionicons name={item.icon} size={15} color={category === item.label ? '#FFFFFF' : item.color} />
                  <Text style={[styles.categoryChipText, category === item.label && styles.categoryChipTextOn]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {mapStatus.status !== 'ready' && mapStatus.message ? (
            <Glass style={styles.mapStatusBadge}>
              <Ionicons name={mapStatus.status === 'error' ? 'warning-outline' : 'sync-outline'} size={16} color={mapStatus.status === 'error' ? '#FF3B30' : '#3182F6'} />
              <Text style={styles.mapStatusText} numberOfLines={2}>{mapStatus.message}</Text>
            </Glass>
          ) : null}

          <View style={styles.mapControlStack}>
            <TouchableOpacity activeOpacity={0.84} onPress={() => mapRef.current?.runMapCommand('fitPlaces')}>
              <Glass style={styles.mapRoundButton}>
                <Ionicons name="scan-outline" size={21} color="#191F28" />
              </Glass>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.84} onPress={() => mapRef.current?.runMapCommand('centerUser')}>
              <Glass style={styles.mapRoundButton}>
                <Ionicons name="navigate" size={21} color="#3182F6" />
              </Glass>
            </TouchableOpacity>
          </View>

          {selectedPlace && detailSheetVisible && !detailExpanded ? (
            <Animated.View style={[styles.detailMiniAnimated, { height: detailMiniHeight }]}>
              <Glass style={styles.detailSheet}>
                <View {...detailSheetResponder.panHandlers}>
                  <View style={styles.detailDragHandle} />
                  <View style={styles.detailTopCompact}>
                    <View style={[styles.detailIcon, { backgroundColor: colorForCategory(selectedPlace.category) }]}>
                      <Ionicons name={iconForCategory(selectedPlace.category)} size={20} color="#FFFFFF" />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.detailTitle} numberOfLines={1}>{selectedPlace.name}</Text>
                      <Text style={styles.detailMeta} numberOfLines={1}>{normalizeCategoryLabel(selectedPlace.category)}</Text>
                    </View>
                    <Ionicons name="chevron-up" size={20} color="#8B95A1" />
                  </View>
                </View>
              </Glass>
            </Animated.View>
          ) : null}

          {selectedPlace && detailSheetVisible && detailExpanded ? (
            <View style={styles.detailFullPage}>
              <View style={styles.detailFullHeader}>
                <TouchableOpacity style={styles.detailBackButton} activeOpacity={0.78} onPress={collapseDetailToMini}>
                  <Ionicons name="chevron-back" size={24} color="#111827" />
                </TouchableOpacity>
                <View style={styles.flex}>
                  <Text style={styles.detailFullTitle} numberOfLines={1}>{selectedPlace.name}</Text>
                  <Text style={styles.detailMeta} numberOfLines={1}>{normalizeCategoryLabel(selectedPlace.category)}</Text>
                </View>
              </View>

              <ScrollView contentContainerStyle={styles.detailFullContent} showsVerticalScrollIndicator={false}>
                <View style={styles.detailTop}>
                  <View style={[styles.detailIcon, { backgroundColor: colorForCategory(selectedPlace.category) }]}> 
                    <Ionicons name={iconForCategory(selectedPlace.category)} size={20} color="#FFFFFF" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.detailTitle}>{selectedPlace.name}</Text>
                    <Text style={styles.detailMeta}>
                      {normalizeCategoryLabel(selectedPlace.category)}
                      {routeInfo.status === 'ready' && routeInfo.durationText ? ` · ${routeInfo.durationText}` : ''}
                    </Text>
                  </View>
                </View>
                <Text style={styles.detailDesc}>{selectedPlace.reviewSummary}</Text>
                <View style={styles.infoGrid}>
                  <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>{'영업시간'}</Text>
                    <Text style={styles.infoText}>{selectedPlace.hours}</Text>
                  </View>
                  <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>{'대표 메뉴'}</Text>
                    <Text style={styles.infoText}>{normalizeMenu(selectedPlace.menu)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.routeExploreButton}
                  activeOpacity={0.86}
                  onPress={makeRoute}
                >
                  <Ionicons name="git-merge-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.routeExploreButtonText}>스마트 동선 생성</Text>
                </TouchableOpacity>
                <View style={styles.detailTabRow}>
                  {[
                    ['photos', '사진', 'images-outline'],
                    ['reviews', '리뷰', 'chatbubble-ellipses-outline'],
                  ].map(([key, label, icon]) => {
                    const active = detailTab === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.detailTabButton, active && styles.detailTabButtonOn]}
                        activeOpacity={0.82}
                        onPress={() => setDetailTab(key)}
                      >
                        <Ionicons name={icon} size={16} color={active ? '#FFFFFF' : '#4E5968'} />
                        <Text style={[styles.detailTabText, active && styles.detailTabTextOn]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {detailTab === 'photos' ? (
                  <View style={styles.detailTabPanel}>
                    <View style={styles.detailSectionTop}>
                      <Text style={styles.detailSectionTitle}>Google 사진</Text>
                      {googlePlaceDetails.status === 'loading' ? <ActivityIndicator size="small" color="#3182F6" /> : null}
                    </View>
                    {googlePlaceDetails.photos.length ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRail}>
                        {googlePlaceDetails.photos.map((photo, index) => {
                          const uri = googlePhotoUrl(photo);
                          if (!uri) return null;
                          return <Image key={`${photo.reference || uri}-${index}`} source={{ uri }} style={styles.placePhoto} />;
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={styles.emptyInlineText}>
                        {googlePlaceDetails.message || 'Google에서 가져올 수 있는 사진이 아직 없어요.'}
                      </Text>
                    )}

                    <View style={styles.detailSectionTop}>
                      <Text style={styles.detailSectionTitle}>Google 리뷰</Text>
                      {googlePlaceDetails.rating ? (
                        <Text style={styles.googleReviewMeta}>
                          {googlePlaceDetails.rating}점 · {googlePlaceDetails.userRatingsTotal || 0}개
                        </Text>
                      ) : null}
                    </View>
                    {googlePlaceDetails.reviews.length ? (
                      googlePlaceDetails.reviews.map((review, index) => (
                        <View key={`${review.authorName}-${review.time || index}`} style={styles.googleReviewCard}>
                          <View style={styles.googleReviewTop}>
                            <View style={styles.flex}>
                              <Text style={styles.googleReviewAuthor}>{review.authorName}</Text>
                              <Text style={styles.googleReviewMeta}>{review.relativeTime}</Text>
                            </View>
                            <View style={styles.starRow}>
                              {ratingStars(review.rating).map((star, starIndex) => (
                                <Ionicons key={`${star}-${starIndex}`} name={star} size={14} color="#FFB800" />
                              ))}
                            </View>
                          </View>
                          <Text style={styles.googleReviewText}>{review.text || '리뷰 내용이 비어 있어요.'}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptyInlineText}>
                        {googlePlaceDetails.status === 'loading' ? 'Google 리뷰를 불러오는 중...' : 'Google 리뷰가 아직 없어요.'}
                      </Text>
                    )}
                  </View>
                ) : (
                  <View style={styles.detailTabPanel}>
                    <View style={styles.reviewComposer}>
                      <Text style={styles.detailSectionTitle}>내 별점</Text>
                      <View style={styles.starRow}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <TouchableOpacity
                            key={star}
                            style={styles.starButton}
                            activeOpacity={0.75}
                            onPress={() => setReviewDraft((current) => ({ ...current, rating: star }))}
                          >
                            <Ionicons name={star <= reviewDraft.rating ? 'star' : 'star-outline'} size={26} color="#FFB800" />
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        value={reviewDraft.comment}
                        onChangeText={(comment) => setReviewDraft((current) => ({ ...current, comment }))}
                        placeholder="이 장소에 대한 내 리뷰를 남겨보세요."
                        placeholderTextColor="#8B95A1"
                        multiline
                        style={styles.reviewInput}
                      />
                      <TouchableOpacity
                        style={[styles.reviewSaveButton, reviewSaving && styles.aiGenerateButtonOff]}
                        activeOpacity={0.86}
                        disabled={reviewSaving}
                        onPress={saveUserPlaceReview}
                      >
                        {reviewSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                        <Text style={styles.reviewSaveText}>{reviewSaving ? '저장 중' : '리뷰 저장'}</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.detailSectionTop}>
                      <Text style={styles.detailSectionTitle}>내가 남긴 리뷰</Text>
                      <Text style={styles.googleReviewMeta}>{userReviews.length}개</Text>
                    </View>
                    {userReviews.length ? (
                      userReviews.map((review) => (
                        <View key={review.id} style={styles.userReviewCard}>
                          <View style={styles.googleReviewTop}>
                            <Text style={styles.googleReviewAuthor}>내 리뷰</Text>
                            <View style={styles.starRow}>
                              {ratingStars(review.rating).map((star, starIndex) => (
                                <Ionicons key={`${review.id}-${starIndex}`} name={star} size={14} color="#FFB800" />
                              ))}
                            </View>
                          </View>
                          <Text style={styles.googleReviewText}>{review.comment}</Text>
                          <Text style={styles.googleReviewMeta}>{new Date(review.createdAt).toLocaleString()}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptyInlineText}>아직 이 장소에 남긴 리뷰가 없어요.</Text>
                    )}
                  </View>
                )}
                <TouchableOpacity
                  style={styles.routeExploreButton}
                  activeOpacity={0.86}
                  onPress={exploreSelectedPlaceRoute}
                  disabled={routeExplore.status === 'loading'}
                >
                  {routeExplore.status === 'loading' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="navigate-outline" size={18} color="#FFFFFF" />
                  )}
                  <Text style={styles.routeExploreButtonText}>
                    {routeExplore.status === 'loading' ? '경로 계산 중' : '경로 탐색'}
                  </Text>
                </TouchableOpacity>

                {routeExplore.routes.length > 0 || routeExplore.message ? (
                  <View style={styles.routeModeRow}>
                    {routeExploreModes.map((mode) => {
                      const route = routeExplore.routes.find((item) => item.mode === mode.key);
                      const ready = route?.status === 'ready';
                      const selected = routeExplore.selectedMode === mode.key;
                      return (
                        <TouchableOpacity
                          key={mode.key}
                          style={[styles.routeModeChip, selected && styles.routeModeChipOn, !ready && styles.routeModeChipOff]}
                          activeOpacity={ready ? 0.82 : 1}
                          onPress={() => ready && renderRouteMode(route)}
                        >
                          <Ionicons name={mode.icon} size={15} color={selected ? '#FFFFFF' : ready ? '#E53935' : '#8B95A1'} />
                          <Text style={[styles.routeModeLabel, selected && styles.routeModeLabelOn]}>
                            {mode.label}
                          </Text>
                          <Text style={[styles.routeModeValue, selected && styles.routeModeLabelOn]}>
                            {ready ? route.durationText || route.distanceText : '불가'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {routeExplore.message ? <Text style={styles.routeExploreMessage}>{routeExplore.message}</Text> : null}
                    {routeExplore.selectedMode === 'TRANSIT' && transitRealtime.status !== 'idle' ? (
                      <View style={styles.transitRealtimeBox}>
                        <View style={styles.transitRealtimeHeader}>
                          <Ionicons name="radio-outline" size={15} color="#3182F6" />
                          <Text style={styles.transitRealtimeTitle}>{'실시간 대중교통'}</Text>
                        </View>
                        <Text style={styles.transitRealtimeText}>
                          {transitRealtime.status === 'loading'
                            ? '실시간 정보를 불러오는 중...'
                            : transitRealtime.message || '실시간 정보가 없습니다.'}
                        </Text>
                        {transitRealtime.buses.slice(0, 3).map((bus, index) => (
                          <Text key={`${bus.vehicleNo || bus.nodeId || index}`} style={styles.transitRealtimeText}>
                            {bus.vehicleNo || '버스'} ? {bus.nodeName || '현재 위치 확인 중'}
                          </Text>
                        ))}
                        {transitRealtime.subwayMessage ? (
                          <Text style={styles.transitRealtimeMuted}>{transitRealtime.subwayMessage}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}

      {tab === 'collect' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>캡처 이미지 업로드</Text>
          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="image-outline" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>Gemini 이미지 분석</Text>
            </View>
            <Text style={styles.cardTitle}>장소 정보 추출!</Text>

            <TouchableOpacity style={styles.captureDrop} activeOpacity={0.86} onPress={pickScreenshot}>
              <Ionicons name="cloud-upload-outline" size={28} color="#3182F6" />
              <Text style={styles.captureDropTitle}>캡처 이미지 선택</Text>
              <Text style={styles.captureDropSub}>Upload</Text>
            </TouchableOpacity>

            {uploadedImage ? (
              <View style={styles.capturePreview}>
                <Image source={{ uri: uploadedImage }} style={styles.captureImage} />
                <View style={styles.capturePreviewInfo}>
                  <Text style={styles.resultConfidence}>원본 캡처</Text>
                  <Text style={styles.detailDesc} numberOfLines={2}>이미지 분석 결과가 아래 검증 폼에 표시됩니다.</Text>
                </View>
              </View>
            ) : null}

            {extracting ? (
              <View style={styles.extractingBox}>
                <ActivityIndicator color="#3182F6" />
                <Text style={styles.extractingText}>{extractStep}</Text>
              </View>
            ) : null}
          </Glass>

          {verification && (
            <Glass style={styles.card}>
              <Text style={styles.resultConfidence}>
                Gemini 분석 · {Math.round((verification.confidence || 0.9) * 100)}%
              </Text>
              <Text style={styles.resultTitle}>검증 후 저장</Text>

              <Text style={styles.fieldLabel}>장소명</Text>
              <TextInput value={verification.name} onChangeText={(value) => updateVerification('name', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>카테고리</Text>
              <View style={styles.demoRow}>
                {categories.filter((item) => item.label !== '전체').map((item) => (
                  <TouchableOpacity key={item.label} onPress={() => updateVerification('category', item.label)} style={[styles.categoryChip, verification.category === item.label && styles.categoryChipOn]}>
                    <Text style={[styles.categoryChipText, verification.category === item.label && styles.categoryChipTextOn]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>주소</Text>
              <TextInput value={verification.address} onChangeText={(value) => updateVerification('address', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>영업시간</Text>
              <TextInput value={verification.hours} onChangeText={(value) => updateVerification('hours', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>대표 메뉴</Text>
              <TextInput value={normalizeMenu(verification.menu)} onChangeText={(value) => updateVerification('menu', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>AI 리뷰 요약</Text>
              <TextInput multiline value={verification.reviewSummary} onChangeText={(value) => updateVerification('reviewSummary', value)} style={[styles.fieldInput, styles.fieldArea]} />

              <TouchableOpacity style={styles.primaryButton} onPress={saveExtracted}>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>지도에 저장하기</Text>
              </TouchableOpacity>
            </Glass>
          )}
        </ScrollView>
      )}

      {tab === 'plan' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>AI 일정표</Text>
          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>오늘의 코스</Text>
            </View>
            <Text style={styles.cardTitle}>하루 일정표</Text>
          </Glass>

          {(routePlaces.length ? routePlaces : places.slice(0, 4)).map((place, index) => (
            <Glass key={place.id} style={styles.timelineItem}>
              <Text style={styles.timelineTime}>{`${10 + index * 2}:00`.padStart(5, '0')}</Text>
              <View style={styles.flex}>
                <Text style={styles.routeTitle}>{place.name}</Text>
                <Text style={styles.routeMeta}>{place.category} 방문 · {place.hours}</Text>
              </View>
            </Glass>
          ))}
        </ScrollView>
      )}

      {tab === 'collections' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>컬렉션</Text>
          <Glass style={styles.card}>
            <View style={styles.collectionHeader}>
              <View>
                <Text style={styles.cardTitle}>내 핫스팟</Text>
                <Text style={styles.settingDesc}>지도에 저장한 장소를 여행 목적별로 모아둘 수 있어요.</Text>
              </View>
            </View>
            <View style={styles.collectionActions}>
              <TouchableOpacity style={styles.collectionActionButton} activeOpacity={0.82} onPress={createCollection}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.collectionActionText}>만들기</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.collectionActionButton, styles.collectionDeleteButton]} activeOpacity={0.82} onPress={deleteSelectedCollection}>
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={[styles.collectionActionText, styles.collectionDeleteText]}>삭제하기</Text>
              </TouchableOpacity>
            </View>
          </Glass>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionTabs}>
            {collections.map((collection) => {
              const active = collection.id === selectedCollection?.id;
              return (
                <TouchableOpacity
                  key={collection.id}
                  style={[styles.collectionTab, active && styles.collectionTabOn]}
                  activeOpacity={0.82}
                  onPress={() => setSelectedCollectionId(collection.id)}
                >
                  <View style={[styles.collectionIconChip, { backgroundColor: collection.color }]}>
                    <Ionicons name={collection.icon || 'albums-outline'} size={14} color="#FFFFFF" />
                  </View>
                  <Text style={[styles.collectionTabText, active && styles.collectionTabTextOn]}>{collection.name}</Text>
                  <Text style={[styles.collectionTabCount, active && styles.collectionTabTextOn]}>
                    {(collection.placeIds?.length || 0) + (collection.routes?.length || 0)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {selectedCollection ? (
            <Glass style={styles.card}>
              <View style={styles.collectionDetailTop}>
                <Text style={styles.resultConfidence}>{selectedCollection.name}</Text>
                <View style={styles.collectionVisibilityBadge}>
                  <Ionicons
                    name={selectedCollection.visibility === 'friends' ? 'people-outline' : 'lock-closed-outline'}
                    size={13}
                    color={selectedCollection.visibility === 'friends' ? '#3182F6' : '#6B7684'}
                  />
                  <Text style={styles.collectionVisibilityBadgeText}>
                    {selectedCollection.visibility === 'friends' ? '친구 공개' : '나만 보기'}
                  </Text>
                </View>
              </View>
              <Text style={styles.resultTitle}>
               장소 {selectedCollectionPlaces.length}곳 · 동선 {selectedCollectionRoutes.length}개
              </Text>
              <View style={styles.collectionVisibilityToggle}>
                {collectionVisibilityOptions.map((option) => {
                  const active = (selectedCollection.visibility || 'private') === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.collectionVisibilityToggleButton, active && styles.collectionVisibilityToggleButtonOn]}
                      activeOpacity={0.84}
                      onPress={() => updateSelectedCollectionVisibility(option.key)}
                    >
                      <Ionicons name={option.icon} size={15} color={active ? '#FFFFFF' : '#6B7684'} />
                      <Text style={[styles.collectionVisibilityToggleText, active && styles.collectionVisibilityToggleTextOn]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selectedCollectionPlaces.length === 0 && selectedCollectionRoutes.length === 0 ? (
                <Text style={styles.detailDesc}>캡처 분석 후 지도에 등록할 때 컬렉션 저장을 선택하면 여기에 쌓입니다.</Text>
              ) : (
                <>
                  {selectedCollectionPlaces.map((place) => (
                    <TouchableOpacity
                      key={place.id}
                      style={styles.collectionPlaceRow}
                      activeOpacity={0.82}
                      onPress={() => {
                        if (place.missing) {
                          showToast('장소 원본 데이터가 아직 동기화되지 않았어요');
                          return;
                        }
                        setSelectedPlace(place);
                        setDetailSheetVisible(true);
                        setDetailExpanded(false);
                        setTab('map');
                        focusMapOnPlace(place);
                      }}
                  >
                      <View style={[styles.collectionPlaceIcon, { backgroundColor: colorForCategory(place.category) }]}>
                        <Ionicons name={iconForCategory(place.category)} size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.routeTitle}>{place.name}</Text>
                        <Text style={styles.routeMeta}>{place.category} · {place.address}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#8B95A1" style={styles.collectionRowChevron} />
                    </TouchableOpacity>
                  ))}
                  {selectedCollectionRoutes.map((route) => (
                    <TouchableOpacity
                      key={route.id}
                      style={styles.collectionRouteRow}
                      activeOpacity={0.82}
                      onPress={() => openSavedCollectionRoute(route)}
                    >
                      <View style={[styles.collectionPlaceIcon, { backgroundColor: selectedCollection.color }]}>
                        <Ionicons name="git-merge-outline" size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.routeTitle}>{route.title || '저장된 스마트 동선'}</Text>
                        <Text style={styles.routeMeta}>
                          {(route.places?.length || route.placeIds?.length || 0)}곳 · {route.visitDate || '날짜 미정'}
                        </Text>
                        <Text style={styles.collectionRouteSteps} numberOfLines={2}>
                          {(route.places || []).map((place) => place.name).join(' → ')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#8B95A1" style={styles.collectionRowChevron} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </Glass>
          ) : (
            <Glass style={styles.card}>
              <Text style={styles.cardTitle}>아직 컬렉션이 없어요</Text>
              <Text style={styles.detailDesc}>만들기 버튼으로 첫 컬렉션을 만들어보세요.</Text>
            </Glass>
          )}
        </ScrollView>
      )}

      {tab === 'settings' && (
        <ScrollView contentContainerStyle={[styles.page, styles.settingsPage]}>
          <Text style={styles.pageTitle}>설정</Text>
          <Glass style={styles.card}>
            <View style={styles.authHeader}>
              <View style={styles.authAvatarFallback}>
                <Ionicons name="person-outline" size={24} color="#3182F6" />
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{authUser ? `${authUser.nickname}` : '계정 로그인'}</Text>
                <Text style={styles.settingDesc}>
                  {authUser ? `${authUser.age}세 · ${genderLabel(authUser.gender)}` : '아이디와 비밀번호로 내 장소와 컬렉션을 계정별로 저장합니다.'}
                </Text>
              </View>
            </View>

            {authUser ? (
              <>
                
                <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.82} onPress={signOutPasswordUser}>
                  <Ionicons name="log-out-outline" size={18} color="#3182F6" />
                  <Text style={styles.secondaryButtonText}>로그아웃</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.authModeRow}>
                  {[
                    ['login', '로그인'],
                    ['register', '회원가입'],
                  ].map(([key, label]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.authModeButton, authMode === key && styles.authModeButtonOn]}
                      activeOpacity={0.82}
                      onPress={() => {
                        setAuthMode(key);
                        setAuthMessage('');
                      }}
                    >
                      <Text style={[styles.authModeText, authMode === key && styles.authModeTextOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>아이디</Text>
                <TextInput
                  value={authDraft.userId}
                  onChangeText={(value) => updateAuthDraft('userId', value)}
                  placeholder="영문/숫자 4~20자"
                  placeholderTextColor="#8B95A1"
                  autoCapitalize="none"
                  style={styles.fieldInput}
                />

                <Text style={styles.fieldLabel}>비밀번호</Text>
                <TextInput
                  value={authDraft.password}
                  onChangeText={(value) => updateAuthDraft('password', value)}
                  placeholder="6자 이상"
                  placeholderTextColor="#8B95A1"
                  secureTextEntry
                  style={styles.fieldInput}
                />

                {authMode === 'register' ? (
                  <>
                    <Text style={styles.fieldLabel}>닉네임</Text>
                    <TextInput
                      value={authDraft.nickname}
                      onChangeText={(value) => updateAuthDraft('nickname', value)}
                      placeholder="예: 성수탐험가"
                      placeholderTextColor="#8B95A1"
                      style={styles.fieldInput}
                    />

                    <Text style={styles.fieldLabel}>나이</Text>
                    <TextInput
                      value={authDraft.age}
                      onChangeText={(value) => updateAuthDraft('age', value.replace(/[^0-9]/g, ''))}
                      placeholder="숫자만 입력"
                      placeholderTextColor="#8B95A1"
                      keyboardType="number-pad"
                      style={styles.fieldInput}
                    />

                    <Text style={styles.fieldLabel}>성별</Text>
                    <View style={styles.authGenderRow}>
                      {[
                        ['none', '선택 안 함'],
                        ['female', '여성'],
                        ['male', '남성'],
                        ['other', '기타'],
                      ].map(([key, label]) => (
                        <TouchableOpacity
                          key={key}
                          style={[styles.authGenderChip, authDraft.gender === key && styles.authGenderChipOn]}
                          activeOpacity={0.82}
                          onPress={() => updateAuthDraft('gender', key)}
                        >
                          <Text style={[styles.authGenderText, authDraft.gender === key && styles.authGenderTextOn]}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryButton, authStatus === 'loading' && styles.authButtonDisabled]}
                  activeOpacity={0.86}
                  onPress={submitPasswordAuth}
                  disabled={authStatus === 'loading'}
                >
                  {authStatus === 'loading' ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="person-circle-outline" size={20} color="#FFFFFF" />}
                  <Text style={styles.primaryButtonText}>
                    {authStatus === 'loading' ? '처리 중...' : authMode === 'register' ? '회원가입하기' : '로그인하기'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.authMessage}>
                  {authMode === 'register' ? '가입 정보는 Firestore users 컬렉션에 저장되고, 비밀번호는 해시로만 보관됩니다.' : '회원가입한 아이디와 비밀번호로 로그인해 주세요.'}
                </Text>
              </>
            )}

            {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
          </Glass>

          {authUser ? (
            <Glass style={styles.card}>
              <View style={styles.friendHeader}>
                <View>
                  <Text style={styles.cardTitle}>친구</Text>
                  <Text style={styles.settingDesc}>친구 코드로 추가하고 AI 일정표를 공유할 수 있어요.</Text>
                </View>
                <TouchableOpacity style={styles.friendRefreshButton} activeOpacity={0.82} onPress={loadFriendHub}>
                  {friendStatus === 'loading' ? (
                    <ActivityIndicator size="small" color="#3182F6" />
                  ) : (
                    <Ionicons name="refresh" size={18} color="#3182F6" />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.friendCodeBox}>
                <Text style={styles.authLabel}>내 친구 코드</Text>
                <Text style={styles.friendCodeText}>{authUser.friendCode || '로그인 후 자동 생성'}</Text>
              </View>

              <View style={styles.friendAddRow}>
                <TextInput
                  value={friendTarget}
                  onChangeText={setFriendTarget}
                  placeholder="친구 아이디 또는 PIN-코드"
                  placeholderTextColor="#8B95A1"
                  autoCapitalize="characters"
                  style={[styles.fieldInput, styles.friendAddInput]}
                />
                <TouchableOpacity style={styles.friendAddButton} activeOpacity={0.84} onPress={sendFriendRequestFromSettings}>
                  <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {friendMessage ? <Text style={styles.authMessage}>{friendMessage}</Text> : null}

              {friendHub.incoming.length ? (
                <View style={styles.friendSection}>
                  <Text style={styles.friendSectionTitle}>받은 요청</Text>
                  {friendHub.incoming.map((request) => (
                    <View key={request.id} style={styles.friendRow}>
                      <View style={styles.friendAvatar}>
                        <Ionicons name="person" size={15} color="#3182F6" />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.friendName}>{request.fromNickname || request.fromUserId}</Text>
                        <Text style={styles.friendMeta}>{request.fromFriendCode || request.fromUserId}</Text>
                      </View>
                      <TouchableOpacity style={styles.friendMiniButton} activeOpacity={0.82} onPress={() => respondFriendRequestFromSettings(request.id, 'accept')}>
                        <Text style={styles.friendMiniButtonText}>수락</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.friendMiniButton, styles.friendMiniButtonGhost]} activeOpacity={0.82} onPress={() => respondFriendRequestFromSettings(request.id, 'reject')}>
                        <Text style={[styles.friendMiniButtonText, styles.friendMiniButtonGhostText]}>거절</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}

              {friendHub.outgoing.length ? (
                <View style={styles.friendSection}>
                  <Text style={styles.friendSectionTitle}>보낸 요청</Text>
                  {friendHub.outgoing.map((request) => (
                    <View key={request.id} style={styles.friendRow}>
                      <View style={styles.friendAvatar}>
                        <Ionicons name="time-outline" size={15} color="#8B95A1" />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.friendName}>{request.toNickname || request.toUserId}</Text>
                        <Text style={styles.friendMeta}>수락 대기 중</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.friendSection}>
                <Text style={styles.friendSectionTitle}>친구 목록</Text>
                {friendHub.friends.length ? (
                  friendHub.friends.map((friend) => (
                    <View key={friend.userId} style={styles.friendRow}>
                      <View style={styles.friendAvatar}>
                        <Ionicons name="people" size={15} color="#3182F6" />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.friendName}>{friend.nickname || friend.userId}</Text>
                        <Text style={styles.friendMeta}>{friend.friendCode || friend.userId}</Text>
                      </View>
                      <TouchableOpacity style={styles.friendIconButton} activeOpacity={0.82} onPress={() => shareCurrentItineraryWithFriend(friend)}>
                        <Ionicons name="share-social-outline" size={17} color="#3182F6" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.friendIconButton} activeOpacity={0.82} onPress={() => removeFriendFromSettings(friend.userId)}>
                        <Ionicons name="trash-outline" size={17} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyInlineText}>아직 친구가 없어요. 친구 코드를 입력해 요청을 보내보세요.</Text>
                )}
              </View>

              <View style={styles.friendSection}>
                <Text style={styles.friendSectionTitle}>친구 공개 컬렉션</Text>
                {friendHub.publicCollections.length ? (
                  friendHub.publicCollections.map((collection) => {
                    const previewPlaces = Array.isArray(collection.places) ? collection.places.slice(0, 3) : [];
                    return (
                      <View key={`${collection.ownerUserId}-${collection.id}`} style={styles.friendPublicCollectionRow}>
                        <View style={[styles.collectionPlaceIcon, { backgroundColor: collection.color || '#3182F6' }]}>
                          <Ionicons name={collection.icon || 'albums-outline'} size={16} color="#FFFFFF" />
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.friendName}>{collection.name || '친구 컬렉션'}</Text>
                          <Text style={styles.friendMeta}>
                            {collection.ownerNickname || collection.ownerUserId} · 장소 {(collection.placeIds?.length || collection.places?.length || 0)}곳 · 동선 {collection.routes?.length || 0}개
                          </Text>
                          {previewPlaces.length ? (
                            <Text style={styles.friendPublicCollectionPreview} numberOfLines={2}>
                              {previewPlaces.map((place) => place.name).join(' · ')}
                            </Text>
                          ) : (
                            <Text style={styles.friendPublicCollectionPreview}>공개된 장소 미리보기가 없어요.</Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={styles.friendIconButton}
                          activeOpacity={0.82}
                          onPress={() => openFriendPublicCollection(collection)}
                        >
                          <Ionicons name="eye-outline" size={18} color="#3182F6" />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.emptyInlineText}>친구가 공개한 컬렉션이 아직 없어요.</Text>
                )}
              </View>

              <View style={styles.friendSection}>
                <Text style={styles.friendSectionTitle}>공유받은 항목</Text>
                {friendHub.inbox.length ? (
                  friendHub.inbox.slice(0, 4).map((item) => (
                    <View key={item.id} style={styles.friendInboxRow}>
                      <Ionicons name={item.type === 'itinerary' ? 'calendar-outline' : 'bookmark-outline'} size={17} color="#FF7A00" />
                      <View style={styles.flex}>
                        <Text style={styles.friendName}>{item.title}</Text>
                        <Text style={styles.friendMeta}>{item.ownerNickname || item.ownerUserId}님이 공유</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyInlineText}>아직 공유받은 항목이 없어요.</Text>
                )}
              </View>
            </Glass>
          ) : null}

        </ScrollView>
      )}

      <Glass style={styles.tabBar}>
        {[
          ['map', '지도', 'map-outline'],
          ['collect', '캡처', 'image-outline'],
          ['collections', '컬렉션', 'albums-outline'],
          ['plan', '일정', 'calendar-outline'],
          ['settings', '설정', 'settings-outline'],
        ].map(([key, label, icon]) => {
          const active = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => {
                setFriendPublicCollectionOpen(null);
                setTab(key);
              }}
            >
              <Ionicons name={icon} size={21} color={active ? '#3182F6' : '#8B95A1'} />
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </Glass>

      {routeSelectMode && (
        <View style={styles.routeSelectOverlay}>
          <View style={styles.routeFog} />
          <View style={styles.routeEdgeTop} />
          <View style={styles.routeEdgeBottom} />
          <View style={styles.routeEdgeLeft} />
          <View style={styles.routeEdgeRight} />
          {routeBasePlace ? (
            <View pointerEvents="none" style={styles.routeCenterPinWrap}>
              <View style={styles.routeCenterRadiusCircle} />
              <View style={[styles.routeCenterPin, { backgroundColor: applyCollectionPinVisual(routeBasePlace).pinColor || colorForCategory(routeBasePlace.category) }]}>
                <Ionicons name={applyCollectionPinVisual(routeBasePlace).pinIcon || iconForCategory(routeBasePlace.category)} size={22} color="#FFFFFF" />
              </View>
              <Text style={styles.routeCenterPinLabel} numberOfLines={1}>
                {routeBasePlace.name}
              </Text>
            </View>
          ) : null}
          <Glass style={styles.routeSelectGuide}>
            <View style={styles.routeGuideIcon}>
              <Ionicons name="search-outline" size={18} color="#FFFFFF" />
            </View>
            <TouchableOpacity style={styles.flex} activeOpacity={0.82} onPress={() => setRouteSearchOpen(true)}>
              <Text style={styles.routeGuideTitle}>동선 영역 검색</Text>
              <Text style={styles.routeGuideSub}>{routeBasePlace ? routeBasePlace.name : '숙소나 기준 장소를 입력해 주세요'}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.78} onPress={closeRouteSelectMode}>
              <Ionicons name="close" size={22} color="#111827" />
            </TouchableOpacity>
          </Glass>

          {routeSearchOpen ? (
            <Glass style={styles.routeSearchPanel}>
              <View style={styles.routeSearchInputRow}>
                <Ionicons name="search-outline" size={18} color="#3182F6" />
                <TextInput
                  value={routeBaseQuery}
                  onChangeText={setRouteBaseQuery}
                  placeholder="숙소 이름, 장소명, 주소 검색"
                  placeholderTextColor="#8B95A1"
                  style={styles.routeSearchInput}
                  autoFocus
                />
              </View>
              <ScrollView style={styles.routeSearchList} keyboardShouldPersistTaps="handled">
                {routeSearchResults.map((place) => (
                  <TouchableOpacity key={place.id} style={styles.routeSearchRow} activeOpacity={0.82} onPress={() => selectRouteBase(place)}>
                    <View style={[styles.collectionPlaceIcon, { backgroundColor: colorForCategory(place.category) }]}>
                      <Ionicons name={iconForCategory(place.category)} size={15} color="#FFFFFF" />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.routeTitle}>{place.name}</Text>
                      <Text style={styles.routeMeta}>{place.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {routeSearchResults.length === 0 ? (
                  <Text style={styles.routeEmptyText}>저장된 장소에서 검색 결과가 없어요. 먼저 캡처나 지도에서 장소를 등록해 주세요.</Text>
                ) : null}
              </ScrollView>
            </Glass>
          ) : null}

          <Glass style={styles.routeResultSheet}>
            <View style={styles.routeResultTop}>
              <View style={styles.flex}>
                <Text style={styles.routeResultTitle}>스마트 동선</Text>
                <Text style={styles.routeGuideSub}>
                  기준 원 안의 저장 장소 {routePlaces.length}곳
                </Text>
              </View>
              <TouchableOpacity style={styles.routeDoneButton} activeOpacity={0.82} onPress={finishSmartRouteSelection}>
                <Text style={styles.routeDoneText}>완료</Text>
              </TouchableOpacity>
            </View>
            {routePlaces.length > 0 ? (
              <>
                <TouchableOpacity style={styles.routeScheduleButton} activeOpacity={0.84} onPress={saveCurrentRouteToCollection}>
                  <Ionicons name="bookmark-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.routeScheduleButtonText}>컬렉션 저장</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.routeScheduleButton} activeOpacity={0.84} onPress={openSmartSchedulePage}>
                  <Ionicons name="calendar-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.routeScheduleButtonText}>일정 생성</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </Glass>
        </View>
      )}

      {routeScheduleOpen ? (
        <View style={styles.routeSchedulePage}>
          <SafeAreaView style={styles.routeScheduleSafe}>
            <View style={styles.routeScheduleHeader}>
              <TouchableOpacity activeOpacity={0.78} onPress={() => setRouteScheduleOpen(false)}>
                <Ionicons name="chevron-back" size={25} color="#111827" />
              </TouchableOpacity>
              <View style={styles.flex}>
                <Text style={styles.routeScheduleTitle}>AI 추천 데일리 일정표</Text>
                <Text style={styles.routeScheduleSub}>{routeBasePlace ? `${routeBasePlace.name} 기준` : '기준점 기반'} · {routePlaces.length}곳</Text>
              </View>
              <TouchableOpacity activeOpacity={0.78} onPress={shareAiItinerary}>
                <Ionicons name="share-outline" size={22} color="#3182F6" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.routeScheduleContent}>
              <Glass style={styles.card}>
                <View style={styles.badge}>
                  <Ionicons name="sparkles" size={15} color="#3182F6" />
                  <Text style={styles.badgeText}>Gemini AI 동선 플래너</Text>
                </View>
                <Text style={styles.cardTitle}>방문 날짜를 선택하면 기준점에서 가까운 순서와 이동 거리를 바탕으로 하루 일정을 만들어줍니다.</Text>
                <Text style={styles.fieldLabel}>방문 예정일</Text>
                <TextInput
                  value={routeScheduleDate}
                  onChangeText={setRouteScheduleDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#8B95A1"
                  style={styles.fieldInput}
                />
                <View style={styles.aiDateRow}>
                  {[
                    ['today', '오늘'],
                    ['tomorrow', '내일'],
                    ['weekend', '이번 주말'],
                  ].map(([key, label]) => (
                    <TouchableOpacity key={key} style={styles.aiDateButton} activeOpacity={0.82} onPress={() => setSmartPresetDate(key)}>
                      <Text style={styles.aiDateButtonText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.aiGenerateButton, routeScheduleLoading && styles.aiGenerateButtonOff]}
                  activeOpacity={0.86}
                  disabled={routeScheduleLoading}
                  onPress={generateSmartSchedule}
                >
                  {routeScheduleLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="sparkles" size={18} color="#FFFFFF" />}
                  <Text style={styles.aiGenerateText}>{routeScheduleLoading ? 'AI 일정 생성 중...' : 'AI 일정 생성하기'}</Text>
                </TouchableOpacity>
                {routeScheduleProvider ? (
                  <Text style={styles.settingDesc}>
                    {routeScheduleProvider === 'gemini' ? 'Gemini API로 생성된 일정표입니다.' : 'Gemini 연결이 없거나 실패해 앱 내부 로직으로 생성했습니다.'}
                  </Text>
                ) : null}
                <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.82} onPress={saveCurrentRouteToCollection}>
                  <Ionicons name="bookmark-outline" size={18} color="#3182F6" />
                  <Text style={styles.secondaryButtonText}>동선 컬렉션에 저장</Text>
                </TouchableOpacity>
              </Glass>

              {aiGeneratedItinerary?.length ? (
                <Glass style={styles.card}>
                  <View style={styles.aiScheduleHeader}>
                    <Ionicons name="calendar-outline" size={20} color="#FF7A00" />
                    <View style={styles.flex}>
                      <Text style={styles.resultTitle}>[스팟로그] AI 추천 {aiSelectedRegion} 데일리 일정표 📅</Text>
                      <Text style={styles.routeMeta}>방문 예정일: {routeScheduleDate}</Text>
                    </View>
                  </View>
                  <Text style={styles.detailDesc}>AI가 영업시간과 이동 거리를 최적화한 최상의 동선입니다!</Text>

                  {aiGeneratedItinerary.map((item, index) => (
                    <View key={`${item.place.id}-${index}`} style={styles.aiTimelineBlock}>
                      <View style={styles.aiTimelineDot}>
                        <Text style={styles.aiTimelineDotText}>{index + 1}</Text>
                      </View>
                      <View style={styles.aiTimelineCard}>
                        <View style={styles.aiTimelineTop}>
                          <Text style={styles.timelineTime}>{item.time}</Text>
                          <Text style={styles.aiDurationText}>{item.duration}</Text>
                        </View>
                        <Text style={styles.routeTitle}>[STEP {index + 1}] {item.place.name} ({item.place.category})</Text>
                        <View style={styles.aiActivityBox}>
                          <Ionicons name="sparkles-outline" size={14} color="#3182F6" />
                          <Text style={styles.aiActivityText}>{item.activity}</Text>
                        </View>
                        <Text style={styles.aiHoursText}>{item.hoursCheck}</Text>
                        <View style={styles.aiTipBox}>
                          <Text style={styles.aiTipText}>AI 꿀팁: "{item.tip}"</Text>
                        </View>
                      </View>
                      {item.transitToNext ? (
                        <View style={styles.aiMoveBox}>
                          <Ionicons name={item.transitToNext.type === 'walk' ? 'walk-outline' : 'car-outline'} size={14} color="#E53935" />
                          <Text style={styles.aiMoveText}>다음 장소로 이동: {item.transitToNext.text}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}

                  <TouchableOpacity style={styles.primaryButton} activeOpacity={0.86} onPress={shareAiItinerary}>
                    <Ionicons name="share-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>외부 앱으로 공유</Text>
                  </TouchableOpacity>
                </Glass>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </View>
      ) : null}

      {friendPublicCollectionOpen ? (
        <View style={styles.friendCollectionPage}>
          <SafeAreaView style={styles.routeScheduleSafe}>
            <View style={styles.friendCollectionHeader}>
              <TouchableOpacity activeOpacity={0.78} onPress={closeFriendPublicCollection} style={styles.detailBackButton}>
                <Ionicons name="chevron-back" size={23} color="#111827" />
              </TouchableOpacity>
              <View style={styles.flex}>
                <Text style={styles.friendCollectionOwner}>
                  {friendPublicCollectionOpen.ownerNickname || friendPublicCollectionOpen.ownerUserId || '친구'}
                </Text>
                <Text style={styles.friendCollectionTitle}>{friendPublicCollectionOpen.name || '친구 공개 컬렉션'}</Text>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.friendCollectionContent}>
              <Glass style={styles.card}>
                <View style={styles.collectionDetailTop}>
                  <View style={[styles.collectionPreviewIcon, { backgroundColor: friendPublicCollectionOpen.color || '#3182F6' }]}>
                    <Ionicons name={friendPublicCollectionOpen.icon || 'albums-outline'} size={22} color="#FFFFFF" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>{friendPublicCollectionOpen.name || '친구 컬렉션'}</Text>
                    <Text style={styles.settingDesc}>
                      {(friendPublicCollectionOpen.places?.length || friendPublicCollectionOpen.placeIds?.length || 0)}곳 · 동선 {friendPublicCollectionOpen.routes?.length || 0}개
                    </Text>
                  </View>
                </View>
                <Text style={styles.detailDesc}>친구가 공개한 컬렉션입니다. 저장된 장소들을 확인할 수 있어요.</Text>
              </Glass>

              {Array.isArray(friendPublicCollectionOpen.places) && friendPublicCollectionOpen.places.length ? (
                friendPublicCollectionOpen.places.map((place, index) => (
                  <TouchableOpacity
                    key={place.id || `${friendPublicCollectionOpen.id}-place-${index}`}
                    style={styles.friendCollectionPlaceCard}
                    activeOpacity={0.84}
                    onPress={() => openFriendPublicPlace(place)}
                  >
                    <View style={[styles.collectionPlaceIcon, { backgroundColor: colorForCategory(place.category) }]}>
                      <Ionicons name={iconForCategory(place.category)} size={16} color="#FFFFFF" />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.routeTitle}>{place.name || '장소'}</Text>
                      <Text style={styles.routeMeta}>{place.category || '장소'} · {place.address || '주소 정보 없음'}</Text>
                      {place.reviewSummary ? (
                        <Text style={styles.friendCollectionPlaceSummary} numberOfLines={3}>
                          {place.reviewSummary}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#8B95A1" style={styles.collectionRowChevron} />
                  </TouchableOpacity>
                ))
              ) : (
                <Glass style={styles.card}>
                  <Text style={styles.cardTitle}>공개된 장소가 없어요</Text>
                  <Text style={styles.detailDesc}>친구가 컬렉션에 장소를 추가하면 여기에 표시됩니다.</Text>
                </Glass>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      ) : null}
      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {collectionPickerPlace || collectionPickerRoute ? (
        <View style={styles.collectionPickerOverlay}>
          <TouchableOpacity
            style={styles.collectionPickerBackdrop}
            activeOpacity={1}
            onPress={() => {
              setCollectionPickerPlace(null);
              setCollectionPickerRoute(null);
            }}
          />
          <Glass style={styles.collectionPickerSheet}>
            <View style={styles.collectionPickerTop}>
              <View>
                <Text style={styles.collectionPickerTitle}>저장할 컬렉션</Text>
                <Text style={styles.collectionPickerSub}>
                  {collectionPickerRoute
                    ? `${collectionPickerRoute.title}을 담을 곳을 선택하세요.`
                    : `${collectionPickerPlace.name}을 담을 곳을 선택하세요.`}
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.78}
                onPress={() => {
                  setCollectionPickerPlace(null);
                  setCollectionPickerRoute(null);
                }}
              >
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>
            {collections.map((collection) => (
              <TouchableOpacity
                key={collection.id}
                style={styles.collectionPickerRow}
                activeOpacity={0.82}
                onPress={() =>
                  collectionPickerRoute
                    ? addRouteToCollection(collectionPickerRoute, collection.id)
                    : addPlaceToCollection(collectionPickerPlace, collection.id)
                }
              >
                <View style={[styles.collectionPlaceIcon, { backgroundColor: collection.color }]}>
                  <Ionicons name={collection.icon || 'albums-outline'} size={16} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.routeTitle}>{collection.name}</Text>
                  <Text style={styles.routeMeta}>
                    장소 {collection.placeIds.length}곳 · 동선 {collection.routes?.length || 0}개
                  </Text>
                </View>
                <Ionicons name="checkmark-circle-outline" size={20} color="#3182F6" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.82} onPress={createCollection}>
              <Ionicons name="add" size={18} color="#3182F6" />
              <Text style={styles.secondaryButtonText}>새 컬렉션 만들기</Text>
            </TouchableOpacity>
          </Glass>
        </View>
      ) : null}

      {collectionCreatorOpen ? (
        <View style={styles.collectionCreatorOverlay}>
          <TouchableOpacity
            style={styles.collectionPickerBackdrop}
            activeOpacity={1}
            onPress={() => {
              setCollectionCreatorOpen(false);
              setCollectionPickerRoute(null);
            }}
          />
          <Glass style={styles.collectionCreatorSheet}>
            <View style={styles.collectionPickerTop}>
              <View>
                <Text style={styles.collectionPickerTitle}>컬렉션 만들기</Text>
                <Text style={styles.collectionPickerSub}>
                  이름, 아이콘, 색깔을 원하는 대로 정하세요.
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.78}
                onPress={() => {
                  setCollectionCreatorOpen(false);
                  setCollectionPickerRoute(null);
                }}
              >
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            <View style={styles.collectionPreviewRow}>
              <View style={[styles.collectionPreviewIcon, { backgroundColor: collectionDraft.color }]}>
                <Ionicons name={collectionDraft.icon} size={24} color="#FFFFFF" />
              </View>
              <TextInput
                value={collectionDraft.name}
                onChangeText={(name) => setCollectionDraft((current) => ({ ...current, name }))}
                style={styles.collectionNameInput}
                placeholder="컬렉션 이름"
                placeholderTextColor="#8B95A1"
                autoCorrect={false}
              />
            </View>

            <Text style={styles.fieldLabel}>아이콘</Text>
            <View style={styles.collectionOptionGrid}>
              {collectionIconOptions.map((icon) => {
                const active = collectionDraft.icon === icon;
                return (
                  <TouchableOpacity
                    key={icon}
                    style={[styles.collectionIconOption, active && styles.collectionIconOptionOn]}
                    activeOpacity={0.82}
                    onPress={() => setCollectionDraft((current) => ({ ...current, icon }))}
                  >
                    <Ionicons name={icon} size={21} color={active ? '#FFFFFF' : '#4E5968'} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>색깔</Text>
            <View style={styles.collectionColorRow}>
              {collectionColorOptions.map((color) => {
                const active = collectionDraft.color === color;
                return (
                  <TouchableOpacity
                    key={color}
                    style={[styles.collectionColorOption, { backgroundColor: color }, active && styles.collectionColorOptionOn]}
                    activeOpacity={0.82}
                    onPress={() => setCollectionDraft((current) => ({ ...current, color }))}
                  >
                    {active ? <Ionicons name="checkmark" size={17} color="#FFFFFF" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>공개 범위</Text>
            <View style={styles.collectionVisibilityRow}>
              {collectionVisibilityOptions.map((option) => {
                const active = collectionDraft.visibility === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.collectionVisibilityOption, active && styles.collectionVisibilityOptionOn]}
                    activeOpacity={0.84}
                    onPress={() => setCollectionDraft((current) => ({ ...current, visibility: option.key }))}
                  >
                    <Ionicons name={option.icon} size={18} color={active ? '#3182F6' : '#6B7684'} />
                    <View style={styles.flex}>
                      <Text style={[styles.collectionVisibilityTitle, active && styles.collectionVisibilityTitleOn]}>
                        {option.label}
                      </Text>
                      <Text style={styles.collectionVisibilityDesc}>{option.description}</Text>
                    </View>
                    {active ? <Ionicons name="checkmark-circle" size={18} color="#3182F6" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.collectionCreatorActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.82}
                onPress={() => {
                  setCollectionCreatorOpen(false);
                  setCollectionPickerRoute(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.collectionSaveButton} activeOpacity={0.82} onPress={saveCreatedCollection}>
                <Text style={styles.collectionSaveText}>저장</Text>
              </TouchableOpacity>
            </View>
          </Glass>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
