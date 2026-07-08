export type Coordinate = {
  lat: number;
  lng: number;
};

export type RouteMode = 'WALK' | 'BICYCLE' | 'TRANSIT';

export type RouteResult = {
  mode: RouteMode;
  status: 'ready' | 'unavailable';
  providerStatus: string;
  durationText: string;
  durationSeconds: number | null;
  distanceText: string;
  distanceMeters: number | null;
  encodedPolyline: string;
  transitSteps?: TransitStep[];
  message: string;
  estimated?: boolean;
  straightDistanceMeters?: number;
};

export type TransitStep = {
  vehicleType: string;
  vehicleName: string;
  lineName: string;
  lineShortName: string;
  departureStop: string;
  arrivalStop: string;
  departureTime: string;
  arrivalTime: string;
  numStops: number | null;
  durationText: string;
  distanceText: string;
};
