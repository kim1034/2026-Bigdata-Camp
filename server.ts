import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createHttpServer } from 'http';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const httpServer = createHttpServer(app);

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));

type PlaceResult = {
  name: string;
  category: '카페' | '맛집' | '숙박' | '관광지';
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  menu: Array<{ name: string; price: string }>;
  reviewSummary: string;
  screenshotText: string;
  confidence: number;
  provider?: string;
};

function normalizeCategory(value: unknown): PlaceResult['category'] {
  const text = String(value || '');
  if (text.includes('맛') || text.includes('식') || text.includes('레스토랑')) return '맛집';
  if (text.includes('숙') || text.includes('호텔') || text.includes('펜션') || text.includes('스테이')) return '숙박';
  if (text.includes('관광') || text.includes('공원') || text.includes('전시') || text.includes('체험')) return '관광지';
  return '카페';
}

function normalizeMenu(value: unknown): Array<{ name: string; price: string }> {
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item) => {
      if (typeof item === 'string') return { name: item, price: '정보 없음' };
      return {
        name: String(item?.name || '대표 메뉴'),
        price: String(item?.price || '정보 없음'),
      };
    });
  }

  const text = String(value || '').trim();
  return text ? [{ name: text, price: '정보 없음' }] : [{ name: '대표 메뉴', price: '정보 없음' }];
}

function normalizePlaceResult(raw: any, fallbackText: string, provider: string): PlaceResult {
  return {
    name: String(raw?.name || '분석된 장소'),
    category: normalizeCategory(raw?.category),
    address: String(raw?.address || '주소 확인 필요'),
    latitude: Number(raw?.latitude) || 37.5446,
    longitude: Number(raw?.longitude) || 127.0559,
    hours: String(raw?.hours || '영업시간 확인 필요'),
    menu: normalizeMenu(raw?.menu),
    reviewSummary: String(raw?.reviewSummary || raw?.review_summary || '이미지 분석 결과를 바탕으로 저장된 장소입니다.'),
    screenshotText: String(raw?.screenshotText || raw?.screenshot_text || fallbackText || '캡처 이미지 분석 결과'),
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0.82)),
    provider,
  };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function generateItineraryWithGemini(payload: any) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash';
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const basePlace = payload?.basePlace || null;
  const visitDate = String(payload?.visitDate || '');

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        text: [
          '너는 한국 여행 일정표를 만드는 모바일 앱의 AI 플래너야.',
          '기준점에서 가까운 순서로 정렬된 장소 목록을 바탕으로 하루 일정표를 만들어줘.',
          '반드시 JSON만 반환해. 마크다운 코드블록은 쓰지 마.',
          'JSON 필드: title, summary, steps',
          'steps는 배열이고 각 항목 필드: time, placeName, category, activity, duration, hoursStatus, tip, moveToNext',
          'moveToNext는 마지막 장소면 빈 문자열, 아니면 "🚶 도보 이동 7분 (547m)" 같은 형식으로 써.',
          '영업시간 정보가 부족하면 "영업시간 확인 필요"라고 명확히 써.',
          `방문 예정일: ${visitDate}`,
          `기준점: ${basePlace ? JSON.stringify(basePlace) : '사용자 입력 기준점'}`,
          `장소 목록: ${JSON.stringify(places)}`,
        ].join('\n'),
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const parsed = safeJsonParse(response.text || '');
  if (!parsed) {
    throw new Error('Gemini 일정표 응답을 해석하지 못했습니다.');
  }

  return parsed;
}

function inferMockPlace(text: string): PlaceResult {
  const value = text.toLowerCase();

  if (text.includes('숙소') || text.includes('스테이') || text.includes('한옥') || text.includes('펜션')) {
    return {
      name: value.includes('제주') ? '제주 감성 독채 펜션' : '스테이 한옥',
      category: '숙박',
      address: value.includes('제주') ? '제주 제주시 애월읍' : '서울 종로구 자하문로',
      latitude: value.includes('제주') ? 33.4631 : 37.5802,
      longitude: value.includes('제주') ? 126.3104 : 126.9691,
      hours: '체크인 15:00 / 체크아웃 11:00',
      menu: [{ name: '감성 숙소 1박', price: '320,000원' }],
      reviewSummary: '캡처 이미지에서 숙소 키워드를 감지해 조용한 숙박 코스로 분류했습니다.',
      screenshotText: text,
      confidence: 0.86,
      provider: 'mock',
    };
  }

  if (text.includes('맛집') || text.includes('식당') || text.includes('국수') || text.includes('덮밥') || text.includes('파스타')) {
    return {
      name: value.includes('한남') ? '한남동 퓨전 파스타' : '쵸리상경 성수',
      category: '맛집',
      address: value.includes('한남') ? '서울 용산구 한남동' : '서울 성동구 서울숲길 18',
      latitude: value.includes('한남') ? 37.5344 : 37.5471,
      longitude: value.includes('한남') ? 127.0008 : 127.0425,
      hours: '매일 11:00 - 21:30',
      menu: [
        { name: value.includes('파스타') ? '시그니처 파스타' : '갈릭 덮밥', price: '12,000원' },
        { name: value.includes('파스타') ? '글라스 와인' : '고기 국수', price: '14,000원' },
      ],
      reviewSummary: '식사 관련 키워드와 지역 맥락을 함께 보고 맛집으로 저장합니다.',
      screenshotText: text,
      confidence: 0.88,
      provider: 'mock',
    };
  }

  return {
    name: value.includes('onion') || text.includes('어니언') ? '어니언 성수' : '무브모브 성수',
    category: '카페',
    address: '서울 성동구 성수이로',
    latitude: 37.5438,
    longitude: 127.0569,
    hours: '매일 10:30 - 22:00',
    menu: [
      { name: '크림 라떼', price: '6,500원' },
      { name: '수제 케이크', price: '8,000원' },
    ],
    reviewSummary: '릴스 저장 반응이 높은 성수 디저트 카페로 자동 분류했습니다.',
    screenshotText: text,
    confidence: 0.93,
    provider: 'mock',
  };
}

function inferImagePrompt(image: string, promptHint = '') {
  const value = `${image} ${promptHint}`.toLowerCase();
  if (value.includes('607377') || value.includes('hotel') || value.includes('pension') || value.includes('제주')) {
    return '제주 감성 독채 펜션 숙소 캡처 OCR 결과';
  }
  if (value.includes('151724') || value.includes('restaurant') || value.includes('pasta') || value.includes('한남')) {
    return '한남동 퓨전 파스타 맛집 캡처 OCR 결과';
  }
  return '성수 대형 에스프레소 바 카페 캡처 OCR 결과';
}

function parseDataUriImage(image: string) {
  const match = image.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || 'image/jpeg',
    data: match[2],
  };
}

async function imageToInlineData(image: string) {
  const dataUri = parseDataUriImage(image);
  if (dataUri) return dataUri;

  if (/^https?:\/\//i.test(image)) {
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(`이미지를 불러오지 못했습니다. (${response.status})`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      mimeType: contentType.split(';')[0],
      data: buffer.toString('base64'),
    };
  }

  return {
    mimeType: 'image/jpeg',
    data: image,
  };
}

async function analyzeImageWithGemini(image: string, promptHint = '') {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const inlineData = await imageToInlineData(image);
  const model = process.env.GEMINI_MODEL || process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData,
      },
      {
        text: [
          '이 이미지는 인스타그램, 지도, 블로그, 장소 리뷰 캡처일 수 있습니다.',
          '이미지 안의 텍스트와 시각 정보를 분석해서 실제 방문 장소 후보를 추출하세요.',
          '한국어 JSON만 반환하세요. 마크다운 코드블록은 쓰지 마세요.',
          'JSON 필드: name, category, address, latitude, longitude, hours, menu, reviewSummary, screenshotText, confidence',
          'category는 반드시 카페, 맛집, 숙박, 관광지 중 하나로 쓰세요.',
          'menu는 [{ "name": "...", "price": "..." }] 배열로 쓰세요.',
          '좌표를 확실히 모르면 서울/한국 내 합리적인 추정 좌표를 넣고 confidence를 낮추세요.',
          promptHint ? `추가 힌트: ${promptHint}` : '',
        ].filter(Boolean).join('\n'),
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text || '';
  const parsed = JSON.parse(text);
  return normalizePlaceResult(parsed, parsed?.screenshotText || promptHint, 'gemini');
}

type Coordinate = {
  lat: number;
  lng: number;
};

type RouteMode = 'WALK' | 'BICYCLE' | 'TRANSIT';

const directionsModeMap: Record<RouteMode, string> = {
  WALK: 'walking',
  BICYCLE: 'bicycling',
  TRANSIT: 'transit',
};

const HUMAN_POWER_ROUTE_LIMIT_METERS = 50000;

function parseCoordinate(value: any): Coordinate | null {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function distanceBetweenCoordinates(a: Coordinate, b: Coordinate) {
  const earthRadius = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistanceText(meters: number) {
  if (meters >= 1000) return `약 ${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  return `약 ${Math.round(meters)} m`;
}

function formatDurationText(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `약 ${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `약 ${hours}시간 ${remainMinutes}분` : `약 ${hours}시간`;
}

function encodePolylineValue(value: number) {
  let nextValue = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (nextValue >= 0x20) {
    output += String.fromCharCode((0x20 | (nextValue & 0x1f)) + 63);
    nextValue >>= 5;
  }
  output += String.fromCharCode(nextValue + 63);
  return output;
}

function encodePolyline(points: Coordinate[]) {
  let lastLat = 0;
  let lastLng = 0;
  return points
    .map((point) => {
      const lat = Math.round(point.lat * 1e5);
      const lng = Math.round(point.lng * 1e5);
      const encoded = encodePolylineValue(lat - lastLat) + encodePolylineValue(lng - lastLng);
      lastLat = lat;
      lastLng = lng;
      return encoded;
    })
    .join('');
}

function getDirectionsApiKey() {
  return (
    process.env.GOOGLE_DIRECTIONS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY ||
    ''
  ).trim();
}

function routeFallback(mode: RouteMode, status: string, message: string) {
  return {
    mode,
    status: 'unavailable',
    providerStatus: status,
    durationText: '',
    durationSeconds: null,
    distanceText: '',
    distanceMeters: null,
    encodedPolyline: '',
    message,
  };
}

function estimatedHumanRoute(mode: RouteMode, origin: Coordinate, destination: Coordinate, providerStatus = 'LOCAL_ESTIMATE') {
  const straightDistanceMeters = distanceBetweenCoordinates(origin, destination);
  const routeDistanceMeters = Math.round(straightDistanceMeters * (mode === 'WALK' ? 1.18 : 1.12));
  const speedMetersPerSecond = mode === 'WALK' ? 1.25 : 4.2;
  const durationSeconds = Math.round(routeDistanceMeters / speedMetersPerSecond);

  return {
    mode,
    status: 'ready',
    providerStatus,
    durationText: formatDurationText(durationSeconds),
    durationSeconds,
    distanceText: formatDistanceText(routeDistanceMeters),
    distanceMeters: routeDistanceMeters,
    encodedPolyline: encodePolyline([origin, destination]),
    transitSteps: [],
    message: 'Google 경로가 없어 거리 기반으로 예상했습니다.',
    estimated: true,
    straightDistanceMeters: Math.round(straightDistanceMeters),
  };
}

function extractTransitSteps(leg: any) {
  return (leg?.steps || [])
    .filter((step: any) => step.travel_mode === 'TRANSIT' && step.transit_details)
    .map((step: any) => {
      const details = step.transit_details || {};
      const line = details.line || {};
      return {
        vehicleType: line.vehicle?.type || '',
        vehicleName: line.vehicle?.name || '',
        lineName: line.name || '',
        lineShortName: line.short_name || '',
        departureStop: details.departure_stop?.name || '',
        arrivalStop: details.arrival_stop?.name || '',
        departureTime: details.departure_time?.text || '',
        arrivalTime: details.arrival_time?.text || '',
        numStops: details.num_stops ?? null,
        durationText: step.duration?.text || '',
        distanceText: step.distance?.text || '',
      };
    });
}

async function fetchDirectionsRoute(mode: RouteMode, origin: Coordinate, destination: Coordinate, apiKey: string) {
  const straightDistanceMeters = distanceBetweenCoordinates(origin, destination);
  if ((mode === 'WALK' || mode === 'BICYCLE') && straightDistanceMeters > HUMAN_POWER_ROUTE_LIMIT_METERS) {
    return {
      ...routeFallback(mode, 'DISTANCE_LIMIT', '50km 이상이라 도보/자전거 경로는 제공하지 않습니다.'),
      straightDistanceMeters: Math.round(straightDistanceMeters),
    };
  }

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: directionsModeMap[mode],
    alternatives: 'false',
    language: 'ko',
    region: 'kr',
    key: apiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    if (mode === 'WALK' || mode === 'BICYCLE') {
      return estimatedHumanRoute(mode, origin, destination, String(response.status));
    }
    return routeFallback(mode, String(response.status), 'Google 경로 API 호출에 실패했습니다.');
  }

  if (payload.status !== 'OK' || !payload.routes?.[0]) {
    if (mode === 'WALK' || mode === 'BICYCLE') {
      return estimatedHumanRoute(mode, origin, destination, payload.status || 'LOCAL_ESTIMATE');
    }

    const message =
      payload.status === 'ZERO_RESULTS'
        ? '이 이동수단은 현재 지역에서 경로를 찾지 못했습니다.'
        : payload.error_message || '경로를 계산하지 못했습니다.';
    return routeFallback(mode, payload.status || 'UNKNOWN', message);
  }

  const route = payload.routes[0];
  const leg = route.legs?.[0] || {};

  return {
    mode,
    status: 'ready',
    providerStatus: payload.status,
    durationText: leg.duration?.text || '',
    durationSeconds: leg.duration?.value ?? null,
    distanceText: leg.distance?.text || '',
    distanceMeters: leg.distance?.value ?? null,
    encodedPolyline: route.overview_polyline?.points || '',
    transitSteps: mode === 'TRANSIT' ? extractTransitSteps(leg) : [],
    message: '',
  };
}

function getTagoBusServiceKey() {
  return (process.env.TAGO_BUS_SERVICE_KEY || process.env.EXPO_PUBLIC_TAGO_BUS_SERVICE_KEY || '').trim();
}

function normalizeDataGoItems(payload: any) {
  const items = payload?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function fetchTagoBusLocations(cityCode: string, routeId: string) {
  const serviceKey = getTagoBusServiceKey();
  if (!serviceKey) {
    return {
      status: 'missing-config',
      message: 'TAGO 버스 위치 API 키가 .env에 없습니다.',
      buses: [],
    };
  }

  if (!cityCode || !routeId) {
    return {
      status: 'missing-route',
      message: '실시간 버스 위치 조회에는 도시코드와 노선 ID가 필요합니다.',
      buses: [],
    };
  }

  const params = new URLSearchParams({
    serviceKey,
    cityCode,
    routeId,
    _type: 'json',
    numOfRows: '50',
    pageNo: '1',
  });
  const url = `https://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList?${params.toString()}`;
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || payload?.response?.header?.resultCode !== '00') {
    return {
      status: 'error',
      message: payload?.response?.header?.resultMsg || 'TAGO 버스 위치 조회에 실패했습니다.',
      buses: [],
    };
  }

  const buses = normalizeDataGoItems(payload).map((item: any) => ({
    nodeId: String(item.nodeid || ''),
    nodeName: String(item.nodenm || ''),
    routeId: String(item.routeid || routeId),
    vehicleNo: String(item.vehicleno || ''),
    lat: Number(item.gpslati || item.lat || 0),
    lng: Number(item.gpslong || item.lng || 0),
    remainSeatCnt: item.remainSeatCnt ?? null,
  }));

  return {
    status: 'ready',
    message: buses.length ? `실시간 버스 ${buses.length}대를 불러왔습니다.` : '현재 조회되는 버스 위치가 없습니다.',
    buses,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'PinSnap Archive',
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.post('/api/extract', async (req, res) => {
  const image = String(req.body?.image || '').trim();
  const text = String(req.body?.text || req.body?.prompt || '').trim();
  const promptHint = String(req.body?.promptHint || '').trim();

  if (image) {
    try {
      const place = await analyzeImageWithGemini(image, promptHint);
      res.json(place);
      return;
    } catch (error) {
      console.error('[Gemini image analysis failed]', error);
      const fallback = inferMockPlace(inferImagePrompt(image, promptHint));
      res.json({
        ...fallback,
        provider: 'mock-fallback',
        geminiError: error instanceof Error ? error.message : 'Gemini 분석 실패',
      });
      return;
    }
  }

  if (!text) {
    res.status(400).json({ error: '분석할 텍스트나 이미지가 필요합니다.' });
    return;
  }

  res.json({
    place: inferMockPlace(text),
    provider: process.env.GEMINI_API_KEY ? 'mock-ready-for-gemini' : 'mock',
  });
});

app.post('/api/ai/itinerary', async (req, res) => {
  const places = Array.isArray(req.body?.places) ? req.body.places : [];

  if (places.length === 0) {
    res.status(400).json({
      error: 'EMPTY_PLACES',
      message: '일정표를 만들 장소가 필요합니다.',
    });
    return;
  }

  try {
    const itinerary = await generateItineraryWithGemini(req.body);
    res.json({
      provider: 'gemini',
      itinerary,
    });
  } catch (error) {
    console.error('[Gemini itinerary generation failed]', error);
    res.json({
      provider: 'fallback',
      geminiError: error instanceof Error ? error.message : 'Gemini 일정 생성 실패',
      itinerary: null,
    });
  }
});

app.post('/api/routes/multi-modal', async (req, res) => {
  const origin = parseCoordinate(req.body?.origin);
  const destination = parseCoordinate(req.body?.destination);
  const requestedModes = Array.isArray(req.body?.modes) ? req.body.modes : ['WALK', 'BICYCLE', 'TRANSIT'];
  const modes = requestedModes.filter((mode: string): mode is RouteMode => ['WALK', 'BICYCLE', 'TRANSIT'].includes(mode));
  const apiKey = getDirectionsApiKey();

  if (!origin || !destination) {
    res.status(400).json({
      error: 'INVALID_COORDINATES',
      message: '출발지와 도착지 좌표가 필요합니다.',
    });
    return;
  }

  if (!apiKey) {
    res.status(503).json({
      error: 'MISSING_GOOGLE_DIRECTIONS_KEY',
      message: '서버 .env에 GOOGLE_DIRECTIONS_API_KEY 또는 GOOGLE_MAPS_API_KEY를 추가해 주세요.',
    });
    return;
  }

  try {
    const routes = await Promise.all(
      (modes.length ? modes : ['WALK', 'BICYCLE', 'TRANSIT']).map((mode) =>
        fetchDirectionsRoute(mode, origin, destination, apiKey).catch((error) =>
          routeFallback(
            mode,
            'FETCH_ERROR',
            error instanceof Error ? error.message : '경로 API 처리 중 문제가 발생했습니다.'
          )
        )
      )
    );

    res.json({
      origin,
      destination,
      routes,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'ROUTE_SEARCH_FAILED',
      message: error instanceof Error ? error.message : '경로 탐색 중 문제가 발생했습니다.',
    });
  }
});

app.post('/api/transit/realtime', async (req, res) => {
  const cityCode = String(req.body?.cityCode || process.env.TAGO_BUS_CITY_CODE || process.env.EXPO_PUBLIC_TAGO_BUS_CITY_CODE || '').trim();
  const routeId = String(req.body?.routeId || process.env.TAGO_BUS_ROUTE_ID || process.env.EXPO_PUBLIC_TAGO_BUS_ROUTE_ID || '').trim();
  const transitSteps = Array.isArray(req.body?.transitSteps) ? req.body.transitSteps : [];

  try {
    const bus = await fetchTagoBusLocations(cityCode, routeId);
    res.json({
      status: bus.status === 'ready' ? 'ready' : 'partial',
      provider: 'TAGO',
      bus,
      subway: {
        status: 'missing-config',
        message: '실시간 지하철 도착 정보는 별도 지하철 API 키를 연결하면 활성화됩니다.',
        trains: [],
      },
      transitSteps,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      provider: 'TAGO',
      message: error instanceof Error ? error.message : '실시간 대중교통 정보를 불러오지 못했습니다.',
      bus: { status: 'error', message: 'TAGO 호출 실패', buses: [] },
      subway: { status: 'missing-config', message: '실시간 지하철 API가 설정되지 않았습니다.', trains: [] },
      transitSteps,
    });
  }
});

async function start() {
  if (isProduction) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[PinSnap Server] ${PORT} 포트가 이미 사용 중입니다.`);
      console.error('이미 켜진 dev 서버를 닫거나 .env에서 PORT=3001처럼 다른 포트를 지정해 주세요.');
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[PinSnap Server] http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
