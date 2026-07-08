import { Router } from 'express';
import { env } from '../config/env';
import { getGooglePlaceDetails, getGooglePlacePhoto, resolveGooglePlaceId } from '../services/googlePlaces.service';

export const placesRouter = Router();

placesRouter.get('/places/google-details', async (req, res) => {
  const placeId = String(req.query.placeId || '').trim();
  const name = String(req.query.name || '').trim();
  const address = String(req.query.address || '').trim();
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!env.googlePlacesApiKey) {
    res.status(503).json({
      error: 'MISSING_GOOGLE_PLACES_KEY',
      message: '서버 .env에 GOOGLE_PLACES_API_KEY 또는 GOOGLE_MAPS_API_KEY를 추가해 주세요.',
    });
    return;
  }

  if (!placeId && !name && !address) {
    res.status(400).json({
      error: 'MISSING_PLACE_LOOKUP',
      message: 'Google placeId 또는 장소명/주소가 필요합니다.',
    });
    return;
  }

  try {
    const resolvedPlaceId =
      placeId ||
      (await resolveGooglePlaceId({
        name,
        address,
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
      }));

    if (!resolvedPlaceId) {
      res.status(404).json({
        error: 'GOOGLE_PLACE_NOT_FOUND',
        message: 'Google Places에서 이 장소를 찾지 못했습니다.',
      });
      return;
    }

    const details = await getGooglePlaceDetails(resolvedPlaceId);
    res.json({
      provider: 'google-places',
      resolvedFrom: placeId ? 'placeId' : 'text-search',
      ...details,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(502).json({
      error: 'GOOGLE_PLACE_DETAILS_FAILED',
      message: error instanceof Error ? error.message : 'Google 장소 상세 정보를 불러오지 못했습니다.',
    });
  }
});

placesRouter.get('/places/google-photo', async (req, res) => {
  const reference = String(req.query.reference || '').trim();
  const maxWidth = Number(req.query.maxWidth || 900);

  if (!reference) {
    res.status(400).json({
      error: 'MISSING_PHOTO_REFERENCE',
      message: 'Google photo reference가 필요합니다.',
    });
    return;
  }

  if (!env.googlePlacesApiKey) {
    res.status(503).json({
      error: 'MISSING_GOOGLE_PLACES_KEY',
      message: '서버 .env에 GOOGLE_PLACES_API_KEY 또는 GOOGLE_MAPS_API_KEY를 추가해 주세요.',
    });
    return;
  }

  try {
    const photo = await getGooglePlacePhoto(reference, maxWidth);
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(photo.buffer);
  } catch (error) {
    res.status(502).json({
      error: 'GOOGLE_PLACE_PHOTO_FAILED',
      message: error instanceof Error ? error.message : 'Google 장소 사진을 불러오지 못했습니다.',
    });
  }
});
