import { env } from '../config/env';
import type { Coordinate, RouteMode, RouteResult, TransitStep } from '../types';

const directionsModeMap: Record<RouteMode, string> = {
  WALK: 'walking',
  BICYCLE: 'bicycling',
  TRANSIT: 'transit',
};

const HUMAN_POWER_ROUTE_LIMIT_METERS = 50000;

export function parseCoordinate(value: any): Coordinate | null {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function distanceBetweenCoordinates(a: Coordinate, b: Coordinate) {
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

function routeFallback(mode: RouteMode, status: string, message: string): RouteResult {
  return {
    mode,
    status: 'unavailable',
    providerStatus: status,
    durationText: '',
    durationSeconds: null,
    distanceText: '',
    distanceMeters: null,
    encodedPolyline: '',
    transitSteps: [],
    message,
  };
}

function estimatedHumanRoute(mode: RouteMode, origin: Coordinate, destination: Coordinate, providerStatus = 'LOCAL_ESTIMATE'): RouteResult {
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
    message: 'Google 경로 결과가 없어 거리 기반 예상값을 표시합니다.',
    estimated: true,
    straightDistanceMeters: Math.round(straightDistanceMeters),
  };
}

function extractTransitSteps(leg: any): TransitStep[] {
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

async function fetchDirectionsRoute(mode: RouteMode, origin: Coordinate, destination: Coordinate): Promise<RouteResult> {
  const straightDistanceMeters = distanceBetweenCoordinates(origin, destination);
  if ((mode === 'WALK' || mode === 'BICYCLE') && straightDistanceMeters > HUMAN_POWER_ROUTE_LIMIT_METERS) {
    return {
      ...routeFallback(mode, 'DISTANCE_LIMIT', '50km 이상이라 도보/자전거 경로를 제공하지 않습니다.'),
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
    key: env.googleDirectionsApiKey,
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

export async function getMultiModalRoutes(origin: Coordinate, destination: Coordinate, modes: RouteMode[]) {
  const nextModes: RouteMode[] = modes.length ? modes : ['WALK', 'BICYCLE', 'TRANSIT'];

  return Promise.all(
    nextModes.map((mode) =>
      fetchDirectionsRoute(mode, origin, destination).catch((error) =>
        routeFallback(mode, 'FETCH_ERROR', error instanceof Error ? error.message : '경로 API 처리 중 문제가 발생했습니다.')
      )
    )
  );
}
