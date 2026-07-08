export type CategoryType = '카페' | '맛집' | '숙박' | '관광지' | '식당' | '펜션/숙소' | '관광지/기타';

export interface PlaceMenu {
  name: string;
  price: string;
}

export interface Place {
  id: string;
  name: string;
  category: CategoryType;
  address: string;
  latitude: number;
  longitude: number;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  hours: string;
  menu: PlaceMenu[];
  reviewSummary: string;
  screenshotText: string;
  originalImage?: string;
  googlePlaceId?: string;
  provider?: string;
  photoUrl?: string;
  rating?: number | null;
  userRatingsTotal?: number | null;
  confidence?: number;
  pinColor?: string;
  pinIcon?: string;
  collectionIds?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface ExtractionResult {
  name: string;
  category: CategoryType;
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  menu: PlaceMenu[];
  reviewSummary: string;
  screenshotText: string;
}
