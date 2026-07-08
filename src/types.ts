export type CategoryType = '카페' | '식당' | '펜션/숙소' | '관광지/기타';

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
  hours: string;
  menu: PlaceMenu[];
  reviewSummary: string;
  screenshotText: string;
  createdAt: string;
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
