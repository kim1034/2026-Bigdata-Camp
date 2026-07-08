import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  googleDirectionsApiKey:
    process.env.GOOGLE_DIRECTIONS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY ||
    '',
  googlePlacesApiKey:
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY ||
    '',
  tagoBusServiceKey: process.env.TAGO_BUS_SERVICE_KEY || process.env.EXPO_PUBLIC_TAGO_BUS_SERVICE_KEY || '',
  tagoBusCityCode: process.env.TAGO_BUS_CITY_CODE || process.env.EXPO_PUBLIC_TAGO_BUS_CITY_CODE || '',
  tagoBusRouteId: process.env.TAGO_BUS_ROUTE_ID || process.env.EXPO_PUBLIC_TAGO_BUS_ROUTE_ID || '',
};
