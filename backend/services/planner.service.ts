import type { Coordinate } from '../types';

type PlaceLike = {
  id?: string;
  name?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  hours?: string;
  menu?: any;
};

function placeCoordinate(place: PlaceLike | null | undefined): Coordinate | null {
  const lat = Number(place?.latitude ?? place?.lat);
  const lng = Number(place?.longitude ?? place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function calculateDistanceMeters(from: PlaceLike, to: PlaceLike) {
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

function formatMoveDistance(meters: number) {
  if (!Number.isFinite(meters)) return '';
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km`;
  return `${Math.round(meters)}m`;
}

function firstMenuName(menu: any) {
  if (Array.isArray(menu) && menu[0]) return menu[0].name || String(menu[0]);
  return String(menu || '').split(',')[0].trim() || '대표 메뉴';
}

function categoryKind(category: any) {
  const text = String(category || '');
  if (text.includes('카페')) return 'cafe';
  if (text.includes('맛집') || text.includes('식당') || text.includes('음식')) return 'food';
  if (text.includes('숙박') || text.includes('숙소') || text.includes('펜션') || text.includes('호텔')) return 'stay';
  if (text.includes('관광') || text.includes('공원') || text.includes('명소')) return 'attraction';
  return 'place';
}

function itineraryActivityForPlace(place: PlaceLike) {
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
      tip: '숙소를 기준점으로 잡고 주변 스팟을 가까운 이동거리 순서로 묶었습니다.',
    };
  }
  return {
    activity: '여유로운 명소 관람 및 주변 산책',
    duration: '1시간 30분',
    durationMinutes: 90,
    tip: '동선 중간에 배치하면 이동 피로를 줄이고 주변까지 자연스럽게 둘러볼 수 있어요.',
  };
}

function timeText(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addMinutes(date: Date, minutes: number) {
  date.setMinutes(date.getMinutes() + minutes);
}

export function getRegionOfAddress(address: any) {
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

export function buildNearestRoute(basePlace: PlaceLike, sourcePlaces: PlaceLike[], limit = 6) {
  if (!placeCoordinate(basePlace)) return [];
  const remaining = sourcePlaces
    .filter((place) => place?.id !== basePlace?.id && placeCoordinate(place))
    .map((place) => ({ ...place, distanceFromBase: calculateDistanceMeters(basePlace, place) }))
    .sort((a, b) => a.distanceFromBase - b.distanceFromBase)
    .slice(0, limit);
  const ordered: PlaceLike[] = [];
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

export function buildFallbackItinerary(payload: any) {
  const basePlace = payload?.basePlace || null;
  const orderedPlaces = Array.isArray(payload?.places) ? payload.places : [];
  const visitDate = String(payload?.visitDate || '');
  const currentTime = new Date();
  currentTime.setHours(10, 30, 0, 0);

  const steps = orderedPlaces.map((place, index) => {
    const preset = itineraryActivityForPlace(place);
    const time = timeText(currentTime);
    const nextPlace = orderedPlaces[index + 1];
    let moveToNext = '';

    if (nextPlace) {
      const distance = calculateDistanceMeters(place, nextPlace);
      const isWalk = distance < 900;
      const speedMetersPerMinute = isWalk ? 70 : 420;
      const minutes = Math.max(2, Math.round(distance / speedMetersPerMinute));
      moveToNext = `${isWalk ? '도보' : '차량'} 이동 ${minutes}분 (${formatMoveDistance(distance)})`;
      addMinutes(currentTime, preset.durationMinutes + minutes);
    }

    return {
      time,
      placeName: place.name || `STEP ${index + 1}`,
      category: place.category || '장소',
      activity: preset.activity,
      duration: preset.duration,
      hoursStatus: place.hours || '영업시간 확인 필요',
      tip:
        index === 0 && basePlace
          ? `"${basePlace.name}"에서 가장 가까운 스팟부터 시작하도록 배치했습니다. ${preset.tip}`
          : preset.tip,
      moveToNext,
    };
  });

  return {
    title: `${getRegionOfAddress(basePlace?.address)} 데일리 일정표`,
    summary: '앱 내부 거리 계산 로직으로 만든 기본 일정표입니다.',
    visitDate,
    steps,
  };
}
