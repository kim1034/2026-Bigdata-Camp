import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { GoogleMapWebView } from './src/components/GoogleMapWebView';
import { categories } from './src/data/places';
import {
  deleteCollectionFromFirestore,
  isFirebaseDbConfigured,
  loadCollectionsFromFirestore,
  loadPlacesFromFirestore,
  saveCollectionToFirestore,
  savePlaceToFirestore,
} from './src/services/firebaseDb';
import { buildRoute } from './src/utils/inference';
import { styles } from './src/styles';

const ROUTE_SELECT_RADIUS = 92;
const ROUTE_TAP_MOVE_THRESHOLD = 11;
const ROUTE_PAN_SENSITIVITY = 1.65;
const ROUTE_PAN_MIN_DELTA = 0.8;
const ROUTE_PINCH_ZOOM_SENSITIVITY = 1.25;
const ROUTE_ZOOM_MIN_DELTA = 0.012;

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

const routeExploreModes = [
  { key: 'WALK', label: '도보', icon: 'walk-outline' },
  { key: 'BICYCLE', label: '자전거', icon: 'bicycle-outline' },
  { key: 'TRANSIT', label: '대중교통', icon: 'bus-outline' },
];

const starterCollections = [
  {
    id: 'collection-weekend',
    name: '이번 주말 코스',
    color: '#3182F6',
    icon: 'albums-outline',
    placeIds: [],
    createdAt: Date.now(),
  },
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

function enrichPlace(place) {
  return {
    ...place,
    color: place.pinColor || colorForCategory(place.category),
    icon: iconForCategory(place.category),
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
  if (text.includes('맛') || text.includes('식당') || text.includes('앸')) return 'food';
  if (text.includes('숙') || text.includes('펜션') || text.includes('숈')) return 'stay';
  if (text.includes('관광') || text.includes('공원')) return 'attraction';
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

export default function App() {
  const mapRef = useRef(null);
  const routeGestureModeRef = useRef('idle');
  const singleTouchRef = useRef(null);
  const twoFingerAnchorRef = useRef(null);
  const pinchDistanceRef = useRef(0);
  const routePanFrameRef = useRef(false);
  const routePanDeltaRef = useRef({ x: 0, y: 0 });
  const routeZoomFrameRef = useRef(false);
  const routeZoomDeltaRef = useRef(0);
  const [tab, setTab] = useState('map');
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [detailSheetVisible, setDetailSheetVisible] = useState(false);
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
  const [collections, setCollections] = useState(starterCollections);
  const [selectedCollectionId, setSelectedCollectionId] = useState(starterCollections[0].id);
  const [collectionPickerPlace, setCollectionPickerPlace] = useState(null);
  const [collectionCreatorOpen, setCollectionCreatorOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState({
    name: '',
    icon: collectionIconOptions[0],
    color: collectionColorOptions[0],
  });

  const visiblePlaces = useMemo(() => {
    return places.filter((place) => {
      const categoryMatched = category === '전체' || place.category === category;
      const text = `${place.name} ${place.address} ${place.category}`.toLowerCase();
      const queryMatched = !query.trim() || text.includes(query.trim().toLowerCase());
      return categoryMatched && queryMatched;
    });
  }, [places, category, query]);

  const mapPlaces = useMemo(() => visiblePlaces.map(enrichPlace), [visiblePlaces]);
  const mapSelectedPlace = useMemo(() => (selectedPlace ? enrichPlace(selectedPlace) : null), [selectedPlace]);
  const selectedCollection = useMemo(
    () => collections.find((item) => item.id === selectedCollectionId) || collections[0] || null,
    [collections, selectedCollectionId]
  );
  const selectedCollectionPlaces = useMemo(() => {
    if (!selectedCollection) return [];
    return selectedCollection.placeIds
      .map((placeId) => places.find((place) => place.id === placeId))
      .filter(Boolean);
  }, [places, selectedCollection]);
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
            const x = current.startX;
            const y = current.startY;
            setDetailSheetVisible(false);
            mapRef.current?.selectRouteCircle(x, y, ROUTE_SELECT_RADIUS);
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
    [routeSelectMode]
  );

  useEffect(() => {
    let isMounted = true;

    async function hydratePlaces() {
      if (!isFirebaseDbConfigured()) return;
      try {
        const remotePlaces = await loadPlacesFromFirestore();
        if (isMounted && remotePlaces.length > 0) {
          setPlaces(remotePlaces);
          setSelectedPlace(remotePlaces[0]);
          setDetailSheetVisible(true);
          setRoutePlaces(buildRoute(remotePlaces.slice(0, 4)));
        }
        const remoteCollections = await loadCollectionsFromFirestore();
        if (isMounted && remoteCollections.length > 0) {
          setCollections(remoteCollections);
          setSelectedCollectionId(remoteCollections[0].id);
        }
      } catch (error) {
        console.warn('Failed to load Firestore places', error);
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

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1700);
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
      .catch(() => showToast('지도 저장 완료, DB 저장은 실패했어요'));
    setSelectedPlace(nextPlace);
    setDetailSheetVisible(true);
    setUploadedImage(null);
    setExtractResult(null);
    setVerification(null);
    setTab('map');
    showToast(`${nextPlace.name} 지도 등록 완료`);
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

  function addPlaceToCollection(place, collectionId) {
    const nextColor = colorForCategory(place.category);
    const targetCollection = collections.find((collection) => collection.id === collectionId);
    const nextCollection = targetCollection
      ? {
          ...targetCollection,
          placeIds: targetCollection.placeIds.includes(place.id)
            ? targetCollection.placeIds
            : [place.id, ...targetCollection.placeIds],
        }
      : null;
    setCollections((current) =>
      current.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              placeIds: collection.placeIds.includes(place.id)
                ? collection.placeIds
                : [place.id, ...collection.placeIds],
            }
          : collection
      )
    );
    setPlaces((current) =>
      current.map((item) =>
        item.id === place.id
          ? {
              ...item,
              pinColor: nextColor,
              collectionIds: Array.from(new Set([...(item.collectionIds || []), collectionId])),
            }
          : item
      )
    );
    setSelectedPlace((current) =>
      current?.id === place.id
        ? {
            ...current,
            pinColor: nextColor,
            collectionIds: Array.from(new Set([...(current.collectionIds || []), collectionId])),
          }
        : current
    );
    savePlaceToFirestore({
      ...place,
      pinColor: nextColor,
      collectionIds: Array.from(new Set([...(place.collectionIds || []), collectionId])),
    }).catch(() => {});
    if (nextCollection) {
      saveCollectionToFirestore(nextCollection).catch(() => {});
    }
    setSelectedCollectionId(collectionId);
    setCollectionPickerPlace(null);
    const collectionName = collections.find((item) => item.id === collectionId)?.name || '컬렉션';
    showToast(`${collectionName}에 저장했어요`);
  }

  function createCollection() {
    const nextIndex = collections.length + 1;
    setCollectionDraft({
      name: `새 컬렉션 ${nextIndex}`,
      icon: collectionIconOptions[collections.length % collectionIconOptions.length],
      color: collectionColorOptions[collections.length % collectionColorOptions.length],
    });
    setCollectionCreatorOpen(true);
  }

  function saveCreatedCollection() {
    const nextIndex = collections.length + 1;
    const draftName = collectionDraft.name.trim() || `새 컬렉션 ${nextIndex}`;
    const nextCollection = {
      id: `collection-${Date.now()}`,
      name: draftName,
      color: collectionDraft.color,
      icon: collectionDraft.icon,
      placeIds: collectionPickerPlace ? [collectionPickerPlace.id] : [],
      createdAt: Date.now(),
    };
    setCollections((current) => [nextCollection, ...current]);
    setSelectedCollectionId(nextCollection.id);
    if (collectionPickerPlace) {
      const nextColor = colorForCategory(collectionPickerPlace.category);
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
                pinColor: nextColor,
                collectionIds: Array.from(new Set([...(place.collectionIds || []), nextCollection.id])),
              }
            : place
        )
      );
      setSelectedPlace((current) =>
        current?.id === collectionPickerPlace.id
          ? {
              ...current,
              pinColor: nextColor,
              collectionIds: Array.from(new Set([...(current.collectionIds || []), nextCollection.id])),
            }
          : current
      );
      savePlaceToFirestore({
        ...collectionPickerPlace,
        pinColor: nextColor,
        collectionIds: Array.from(new Set([...(collectionPickerPlace.collectionIds || []), nextCollection.id])),
      }).catch(() => {});
      saveCollectionToFirestore(nextCollection).catch(() => {});
      setCollectionPickerPlace(null);
      setCollectionCreatorOpen(false);
      showToast(`${nextCollection.name}에 저장했어요`);
      return;
    }
    saveCollectionToFirestore(nextCollection).catch(() => {});
    setCollectionCreatorOpen(false);
    showToast(`${nextCollection.name} 생성 완료`);
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
          setCollections((current) => {
            const next = current.filter((collection) => collection.id !== removedId);
            setSelectedCollectionId(next[0]?.id || null);
            return next;
          });
          setPlaces((current) =>
            current.map((place) => {
              const nextIds = (place.collectionIds || []).filter((id) => id !== removedId);
              return {
                ...place,
                collectionIds: nextIds,
                pinColor: nextIds.length > 0 ? place.pinColor : '#FFFFFF',
              };
            })
          );
          setSelectedPlace((current) => {
            if (!current) return current;
            const nextIds = (current.collectionIds || []).filter((id) => id !== removedId);
            return {
              ...current,
              collectionIds: nextIds,
              pinColor: nextIds.length > 0 ? current.pinColor : '#FFFFFF',
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
    setTab('map');
    if (!routeBasePlace && selectedPlace) {
      setRouteBasePlace(selectedPlace);
      setRouteBaseQuery(selectedPlace.name);
    }
    showToast('기준 장소를 검색해서 스마트 동선을 만들어요');
  }

  function selectRouteBase(place) {
    setRouteBasePlace(place);
    setRouteBaseQuery(place.name);
    setRouteSearchOpen(false);
    const nextRoute = buildNearestRoute(place, places);
    setRoutePlaces(nextRoute);
    showToast(`${place.name} 기준 동선 후보를 정리했어요`);
  }

  function resolveRouteBasePlace() {
    if (routeBasePlace && placeCoordinate(routeBasePlace)) return routeBasePlace;
    const text = routeBaseQuery.trim().toLowerCase();
    if (!text) return null;
    return places.find((place) => `${place.name} ${place.address}`.toLowerCase().includes(text) && placeCoordinate(place)) || null;
  }

  function completeSmartRoute() {
    const base = resolveRouteBasePlace();
    if (!base) {
      setRouteSearchOpen(true);
      showToast('동선 기준이 될 숙소나 장소를 먼저 검색해 주세요');
      return null;
    }

    const nextRoute = buildNearestRoute(base, places);
    if (nextRoute.length === 0) {
      showToast('기준점 주변에 동선을 만들 저장 장소가 없어요');
      return null;
    }

    setRouteBasePlace(base);
    setRouteBaseQuery(base.name);
    setRoutePlaces(nextRoute);
    setAiSelectedRegion(getRegionOfAddress(base.address));
    showToast(`${base.name} 기준으로 가까운 순서 동선을 만들었어요`);
    return { base, route: nextRoute };
  }

  async function openSmartSchedulePage() {
    const result = completeSmartRoute();
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
    const orderedPlaces = routePlaces.length ? routePlaces : base ? buildNearestRoute(base, places) : [];
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
      setRouteExplore({ status: 'idle', selectedMode: '', routes: [], message: '' });
      setTransitRealtime({ status: 'idle', message: '', buses: [], subwayMessage: '' });
      mapRef.current?.clearRoutePolyline();
    }
  }

  function handleExternalPlace(place) {
    if (!place?.name) return;
    const nextPlace = {
      id: place.id || `google-${place.googlePlaceId || Date.now()}`,
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      category: categoryFromGoogleTypes(place.googleTypes),
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
    setRouteExplore({ status: 'idle', selectedMode: '', routes: [], message: '' });
    setTransitRealtime({ status: 'idle', message: '', buses: [], subwayMessage: '' });
    mapRef.current?.clearRoutePolyline();
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
            onMapPress={() => setDetailSheetVisible(false)}
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

          <TouchableOpacity style={styles.fab} activeOpacity={0.88} onPress={makeRoute}>
            <Ionicons name="git-merge-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          {selectedPlace && detailSheetVisible && (
            <Glass style={styles.detailSheet}>
              <View style={styles.detailTop}>
                <View style={[styles.detailIcon, { backgroundColor: colorForCategory(selectedPlace.category) }]}>
                  <Ionicons name={iconForCategory(selectedPlace.category)} size={20} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.detailTitle}>{selectedPlace.name}</Text>
                  <Text style={styles.detailMeta}>
                    {selectedPlace.category} · AI {Math.round((selectedPlace.confidence || 0.85) * 100)}%
                    {routeInfo.status === 'ready' && routeInfo.durationText ? ` · ${routeInfo.durationText}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.detailDesc}>{selectedPlace.reviewSummary}</Text>
              <View style={styles.infoGrid}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>영업시간</Text>
                  <Text style={styles.infoText}>{selectedPlace.hours}</Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>대표 메뉴</Text>
                  <Text style={styles.infoText}>{normalizeMenu(selectedPlace.menu)}</Text>
                </View>
              </View>
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
                        <Text style={styles.transitRealtimeTitle}>실시간 대중교통</Text>
                      </View>
                      <Text style={styles.transitRealtimeText}>
                        {transitRealtime.status === 'loading'
                          ? '실시간 정보를 불러오는 중...'
                          : transitRealtime.message || '실시간 정보가 없습니다.'}
                      </Text>
                      {transitRealtime.buses.slice(0, 3).map((bus, index) => (
                        <Text key={`${bus.vehicleNo || bus.nodeId || index}`} style={styles.transitRealtimeText}>
                          {bus.vehicleNo || '버스'} · {bus.nodeName || '현재 위치 확인 중'}
                        </Text>
                      ))}
                      {transitRealtime.subwayMessage ? (
                        <Text style={styles.transitRealtimeMuted}>{transitRealtime.subwayMessage}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Glass>
          )}
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
            <Text style={styles.cardTitle}>인스타/지도 캡처 한 장을 올리면 Gemini가 장소 정보를 추출합니다.</Text>

            <TouchableOpacity style={styles.captureDrop} activeOpacity={0.86} onPress={pickScreenshot}>
              <Ionicons name="cloud-upload-outline" size={28} color="#3182F6" />
              <Text style={styles.captureDropTitle}>캡처 이미지 선택</Text>
              <Text style={styles.captureDropSub}>앨범에서 스크린샷을 고르면 서버의 Gemini API로 분석합니다.</Text>
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

              <Text style={styles.fieldLabel}>원본 캡처 내용</Text>
              <TextInput multiline value={verification.screenshotText} onChangeText={(value) => updateVerification('screenshotText', value)} style={[styles.fieldInput, styles.fieldArea]} />

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
            <Text style={styles.cardTitle}>동선 순서를 하루 일정표로 바꾸었습니다.</Text>
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
                <Text style={styles.cardTitle}>내 핫플 묶음</Text>
                <Text style={styles.settingDesc}>지도에 저장한 장소를 여행 목적별로 모아둘 수 있어요.</Text>
              </View>
              <View style={styles.collectionCountBadge}>
                <Text style={styles.collectionCountText}>{collections.length}</Text>
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
                  <Text style={[styles.collectionTabCount, active && styles.collectionTabTextOn]}>{collection.placeIds.length}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {selectedCollection ? (
            <Glass style={styles.card}>
              <Text style={styles.resultConfidence}>{selectedCollection.name}</Text>
              <Text style={styles.resultTitle}>{selectedCollectionPlaces.length}곳 저장됨</Text>
              {selectedCollectionPlaces.length === 0 ? (
                <Text style={styles.detailDesc}>캡처 분석 후 지도에 등록할 때 컬렉션 저장을 선택하면 여기에 쌓입니다.</Text>
              ) : (
                selectedCollectionPlaces.map((place) => (
                  <TouchableOpacity
                    key={place.id}
                    style={styles.collectionPlaceRow}
                    activeOpacity={0.82}
                    onPress={() => {
                      setSelectedPlace(place);
                      setDetailSheetVisible(true);
                      setTab('map');
                    }}
                  >
                    <View style={[styles.collectionPlaceIcon, { backgroundColor: colorForCategory(place.category) }]}>
                      <Ionicons name={iconForCategory(place.category)} size={16} color="#FFFFFF" />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.routeTitle}>{place.name}</Text>
                      <Text style={styles.routeMeta}>{place.category} · {place.address}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#8B95A1" />
                  </TouchableOpacity>
                ))
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
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>설정</Text>
          <Glass style={styles.card}>
            <Text style={styles.cardTitle}>PinSnap Archive</Text>
            <Text style={styles.detailDesc}>캡처 이미지는 서버의 Gemini API로 분석하고, 저장한 장소는 Firestore에 동기화됩니다.</Text>
          </Glass>
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
            <TouchableOpacity key={key} style={styles.tab} onPress={() => setTab(key)}>
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
          <Glass style={styles.routeSelectGuide}>
            <View style={styles.routeGuideIcon}>
              <Ionicons name="search-outline" size={18} color="#FFFFFF" />
            </View>
            <TouchableOpacity style={styles.flex} activeOpacity={0.82} onPress={() => setRouteSearchOpen(true)}>
              <Text style={styles.routeGuideTitle}>?? ?? ??</Text>
              <Text style={styles.routeGuideSub}>{routeBasePlace ? routeBasePlace.name : '??? ?? ??? ??? ???'}</Text>
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
                  placeholder="?? ??, ???, ?? ??"
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
                  <Text style={styles.routeEmptyText}>??? ???? ?? ??? ???. ?? ??? ???? ??? ??? ???.</Text>
                ) : null}
              </ScrollView>
            </Glass>
          ) : null}

          <Glass style={styles.routeResultSheet}>
            <View style={styles.routeResultTop}>
              <Text style={styles.routeResultTitle}>??? ??</Text>
              <TouchableOpacity style={styles.routeDoneButton} activeOpacity={0.82} onPress={completeSmartRoute}>
                <Text style={styles.routeDoneText}>??</Text>
              </TouchableOpacity>
            </View>
            {routePlaces.length > 0 ? (
              <TouchableOpacity style={styles.routeScheduleButton} activeOpacity={0.84} onPress={openSmartSchedulePage}>
                <Ionicons name="calendar-outline" size={17} color="#FFFFFF" />
                <Text style={styles.routeScheduleButtonText}>?? ??</Text>
              </TouchableOpacity>
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
                <Text style={styles.cardTitle}>방문 날짜를 선택하면 기준점에서 가까운 순서와 이동 거리를 바탕으로 하루 일정을 만듭니다.</Text>
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

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {collectionPickerPlace ? (
        <View style={styles.collectionPickerOverlay}>
          <TouchableOpacity style={styles.collectionPickerBackdrop} activeOpacity={1} onPress={() => setCollectionPickerPlace(null)} />
          <Glass style={styles.collectionPickerSheet}>
            <View style={styles.collectionPickerTop}>
              <View>
                <Text style={styles.collectionPickerTitle}>저장할 컬렉션</Text>
                <Text style={styles.collectionPickerSub}>{collectionPickerPlace.name}을 담을 곳을 선택하세요.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.78} onPress={() => setCollectionPickerPlace(null)}>
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>
            {collections.map((collection) => (
              <TouchableOpacity
                key={collection.id}
                style={styles.collectionPickerRow}
                activeOpacity={0.82}
                onPress={() => addPlaceToCollection(collectionPickerPlace, collection.id)}
              >
                <View style={[styles.collectionPlaceIcon, { backgroundColor: collection.color }]}>
                  <Ionicons name={collection.icon || 'albums-outline'} size={16} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.routeTitle}>{collection.name}</Text>
                  <Text style={styles.routeMeta}>{collection.placeIds.length}곳 저장됨</Text>
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
          <TouchableOpacity style={styles.collectionPickerBackdrop} activeOpacity={1} onPress={() => setCollectionCreatorOpen(false)} />
          <Glass style={styles.collectionCreatorSheet}>
            <View style={styles.collectionPickerTop}>
              <View>
                <Text style={styles.collectionPickerTitle}>컬렉션 만들기</Text>
                <Text style={styles.collectionPickerSub}>
                  이름, 아이콘, 색깔을 원하는 대로 정하세요.
                </Text>
              </View>
              <TouchableOpacity activeOpacity={0.78} onPress={() => setCollectionCreatorOpen(false)}>
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

            <View style={styles.collectionCreatorActions}>
              <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.82} onPress={() => setCollectionCreatorOpen(false)}>
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
