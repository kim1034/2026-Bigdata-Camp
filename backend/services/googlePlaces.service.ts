import { env } from '../config/env';

export type GooglePlacePhoto = {
  reference: string;
  width: number | null;
  height: number | null;
  attributions: string[];
};

export type GooglePlaceReview = {
  authorName: string;
  rating: number | null;
  relativeTime: string;
  text: string;
  profilePhotoUrl: string;
  time: number | null;
};

export type GooglePlaceLookupInput = {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function compactQueryPart(value: unknown) {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

export async function resolveGooglePlaceId(input: GooglePlaceLookupInput) {
  const query = [compactQueryPart(input.name), compactQueryPart(input.address)].filter(Boolean).join(' ');
  if (!query) return '';

  const params = new URLSearchParams({
    query,
    language: 'ko',
    region: 'kr',
    key: env.googlePlacesApiKey,
  });

  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    params.set('location', `${input.lat},${input.lng}`);
    params.set('radius', '1200');
  }

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok || !['OK', 'ZERO_RESULTS'].includes(payload.status)) {
    const status = payload.status || String(response.status);
    const message = payload.error_message || 'Google Places 검색에 실패했습니다.';
    throw new Error(`${status}: ${message}`);
  }

  const firstResult = Array.isArray(payload.results) ? payload.results[0] : null;
  return normalizeText(firstResult?.place_id);
}

export async function getGooglePlaceDetails(placeId: string) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: [
      'place_id',
      'name',
      'rating',
      'user_ratings_total',
      'photos',
      'reviews',
      'url',
    ].join(','),
    language: 'ko',
    key: env.googlePlacesApiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok || payload.status !== 'OK') {
    const status = payload.status || String(response.status);
    const message = payload.error_message || 'Google Places 상세 정보를 불러오지 못했습니다.';
    throw new Error(`${status}: ${message}`);
  }

  const result = payload.result || {};
  const photos: GooglePlacePhoto[] = Array.isArray(result.photos)
    ? result.photos.slice(0, 8).map((photo: any) => ({
        reference: normalizeText(photo.photo_reference),
        width: Number.isFinite(Number(photo.width)) ? Number(photo.width) : null,
        height: Number.isFinite(Number(photo.height)) ? Number(photo.height) : null,
        attributions: Array.isArray(photo.html_attributions) ? photo.html_attributions.map(normalizeText) : [],
      })).filter((photo: GooglePlacePhoto) => Boolean(photo.reference))
    : [];

  const reviews: GooglePlaceReview[] = Array.isArray(result.reviews)
    ? result.reviews.slice(0, 5).map((review: any) => ({
        authorName: normalizeText(review.author_name) || 'Google 사용자',
        rating: Number.isFinite(Number(review.rating)) ? Number(review.rating) : null,
        relativeTime: normalizeText(review.relative_time_description),
        text: normalizeText(review.text),
        profilePhotoUrl: normalizeText(review.profile_photo_url),
        time: Number.isFinite(Number(review.time)) ? Number(review.time) : null,
      }))
    : [];

  return {
    googlePlaceId: normalizeText(result.place_id) || placeId,
    name: normalizeText(result.name),
    rating: Number.isFinite(Number(result.rating)) ? Number(result.rating) : null,
    userRatingsTotal: Number.isFinite(Number(result.user_ratings_total)) ? Number(result.user_ratings_total) : null,
    url: normalizeText(result.url),
    photos,
    reviews,
  };
}

export async function getGooglePlacePhoto(photoReference: string, maxWidth = 900) {
  const width = Math.max(120, Math.min(Number(maxWidth) || 900, 1600));
  const params = new URLSearchParams({
    photo_reference: photoReference,
    maxwidth: String(width),
    key: env.googlePlacesApiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/photo?${params.toString()}`, {
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Google Place Photo ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();
  return {
    contentType,
    buffer: Buffer.from(arrayBuffer),
  };
}
