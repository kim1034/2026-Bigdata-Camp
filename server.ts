import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables (.env.local takes precedence, per README setup instructions)
dotenv.config({ path: [".env.local", ".env"] });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Set body parser to handle large base64 screenshot images
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Initialize Gemini API Client
let ai: GoogleGenAI | null = null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (GEMINI_API_KEY && GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("Gemini API Client initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Gemini API client:", error);
  }
} else {
  console.log("GEMINI_API_KEY not set. /api/extract will return 503 until it is configured in .env.local.");
}

// Health check endpoint (used by the mobile app to verify server availability)
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "PinSnap Archive",
    gemini: Boolean(ai),
  });
});

// API Route for screenshot analysis
app.post("/api/extract", async (req, res) => {
  try {
    const { image } = req.body; // base64 data URL string

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "이미지 데이터가 누락되었습니다." });
    }

    if (!ai) {
      return res.status(503).json({
        error: "GEMINI_API_KEY가 설정되지 않아 분석을 수행할 수 없습니다. .env.local 파일을 확인해주세요.",
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const mimeType = image.match(/^data:(image\/\w+);base64,/)?.[1] || "image/png";

    console.log(`Calling ${GEMINI_MODEL} for screenshot OCR & place extraction...`);

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        },
        {
          text: `You are an advanced South Korean Place Extractor and OCR engine.
Analyze this screenshot (from Instagram, Blog, Map, or Chat) and do the following:
1. Extract all text via OCR.
2. Search and infer the business/place name (가게명/장소명) and the specific region/neighborhood in South Korea (e.g. 성수동, 한남동, 홍대, 강릉, 제주 등).
3. Determine its category exactly as one of the following: "카페", "식당", "펜션/숙소", "관광지/기타".
4. Gather or simulate realistic high-quality Google Places data for this place:
   - Full exact Korean address (도로명 주소).
   - Accurate South Korea Latitude and Longitude (near Seoul or its identified region) so it can be correctly plotted on our Leaflet map. (Crucial: MUST be in South Korea, Latitude around 35.0-38.5, Longitude around 126.0-129.5).
   - Standard Operating Hours in Korean (영업시간).
   - Representative menu items (대표 메뉴) up to 3 items, showing name and price (e.g., "15,000원").
   - A detailed Korean review summary (리뷰 요약) reflecting the overall public feedback (around 2-3 sentences).
   - A short snippet of the extracted text or hashtag that led to this detection.

You MUST respond strictly in JSON format matching the schema provided.`,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "The name of the place (e.g., 어니언 성수, 난포 성수).",
            },
            category: {
              type: Type.STRING,
              description: "Must be exactly one of: '카페', '식당', '펜션/숙소', '관광지/기타'",
            },
            address: {
              type: Type.STRING,
              description: "The complete South Korean road address (도로명 주소).",
            },
            latitude: {
              type: Type.NUMBER,
              description: "The latitude coordinate (e.g., 37.5446). Must be in South Korea.",
            },
            longitude: {
              type: Type.NUMBER,
              description: "The longitude coordinate (e.g., 127.0559). Must be in South Korea.",
            },
            hours: {
              type: Type.STRING,
              description: "Operating hours (e.g., 매일 11:00 - 22:00).",
            },
            menu: {
              type: Type.ARRAY,
              description: "List of 2-3 popular menu items.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Menu name." },
                  price: { type: Type.STRING, description: "Menu price (e.g., 12,000원)." },
                },
                required: ["name", "price"],
              },
            },
            reviewSummary: {
              type: Type.STRING,
              description: "A summary of user reviews in Korean (2-3 sentences, engaging and helpful).",
            },
            screenshotText: {
              type: Type.STRING,
              description: "Brief extracted OCR text or hashtags from the image.",
            },
          },
          required: [
            "name",
            "category",
            "address",
            "latitude",
            "longitude",
            "hours",
            "menu",
            "reviewSummary",
            "screenshotText",
          ],
        },
      },
    });

    const jsonText = response.text?.trim();
    if (!jsonText) {
      throw new Error("Gemini returned an empty response.");
    }

    const data = JSON.parse(jsonText);

    // Validate latitude/longitude — without valid coordinates the pin cannot be placed
    data.latitude = Number(data.latitude);
    data.longitude = Number(data.longitude);
    if (isNaN(data.latitude) || isNaN(data.longitude)) {
      throw new Error(`Invalid coordinates in Gemini response: ${data.latitude}, ${data.longitude}`);
    }

    console.log("Extracted Place Data successfully:", data.name, `Coords: ${data.latitude}, ${data.longitude}`);
    return res.json(data);
  } catch (error) {
    console.error("Error in /api/extract:", error);
    return res.status(500).json({
      error: "장소 분석에 실패했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

// --- Multi-modal routing & realtime transit (Google Directions + TAGO) ---
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

// Start Express server and integrate Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware attached.");
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static files from dist/ folder.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Pinsnap Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
