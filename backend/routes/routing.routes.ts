import { Router } from 'express';
import { env } from '../config/env';
import { getMultiModalRoutes, parseCoordinate } from '../services/routing.service';
import { buildNearestRoute, getRegionOfAddress } from '../services/planner.service';
import type { RouteMode } from '../types';

export const routingRouter = Router();

routingRouter.post('/routes/smart-plan', (req, res) => {
  const basePlace = req.body?.basePlace;
  const places = Array.isArray(req.body?.places) ? req.body.places : [];
  const limit = Number(req.body?.limit || 6);

  if (!basePlace || places.length === 0) {
    res.status(400).json({
      error: 'INVALID_SMART_ROUTE_INPUT',
      message: '스마트 동선을 만들 기준점과 장소 목록이 필요합니다.',
    });
    return;
  }

  const routePlaces = buildNearestRoute(basePlace, places, Number.isFinite(limit) ? limit : 6);
  res.json({
    provider: 'backend-planner',
    basePlace,
    routePlaces,
    region: getRegionOfAddress(basePlace.address),
    requestedAt: new Date().toISOString(),
  });
});

routingRouter.post('/routes/multi-modal', async (req, res) => {
  const origin = parseCoordinate(req.body?.origin);
  const destination = parseCoordinate(req.body?.destination);
  const requestedModes = Array.isArray(req.body?.modes) ? req.body.modes : ['WALK', 'BICYCLE', 'TRANSIT'];
  const modes = requestedModes.filter((mode: string): mode is RouteMode => ['WALK', 'BICYCLE', 'TRANSIT'].includes(mode));

  if (!origin || !destination) {
    res.status(400).json({
      error: 'INVALID_COORDINATES',
      message: '출발지와 도착지 좌표가 필요합니다.',
    });
    return;
  }

  if (!env.googleDirectionsApiKey) {
    res.status(503).json({
      error: 'MISSING_GOOGLE_DIRECTIONS_KEY',
      message: '서버 .env에 GOOGLE_DIRECTIONS_API_KEY 또는 GOOGLE_MAPS_API_KEY를 추가해 주세요.',
    });
    return;
  }

  try {
    const routes = await getMultiModalRoutes(origin, destination, modes);
    res.json({
      origin,
      destination,
      routes,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'ROUTE_SEARCH_FAILED',
      message: error instanceof Error ? error.message : '경로 검색 중 문제가 발생했습니다.',
    });
  }
});
