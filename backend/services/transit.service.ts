import { env } from '../config/env';

function normalizeDataGoItems(payload: any) {
  const items = payload?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export async function fetchTagoBusLocations(cityCode: string, routeId: string) {
  if (!env.tagoBusServiceKey) {
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
    serviceKey: env.tagoBusServiceKey,
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

export async function getRealtimeTransit(payload: any) {
  const cityCode = String(payload?.cityCode || env.tagoBusCityCode || '').trim();
  const routeId = String(payload?.routeId || env.tagoBusRouteId || '').trim();
  const transitSteps = Array.isArray(payload?.transitSteps) ? payload.transitSteps : [];
  const bus = await fetchTagoBusLocations(cityCode, routeId);

  return {
    status: bus.status === 'ready' ? 'ready' : 'partial',
    provider: 'TAGO',
    bus,
    subway: {
      status: 'missing-config',
      message: '실시간 지하철 도착 정보는 별도 지하철 API를 연결하면 활성화됩니다.',
      trains: [],
    },
    transitSteps,
    requestedAt: new Date().toISOString(),
  };
}
