export const categories = [
  { label: '전체', icon: 'apps-outline', color: '#191F28' },
  { label: '카페', icon: 'cafe-outline', color: '#3182F6' },
  { label: '맛집', icon: 'restaurant-outline', color: '#FF6B00' },
  { label: '숙박', icon: 'bed-outline', color: '#8B5CF6' },
  { label: '관광지', icon: 'leaf-outline', color: '#00A86B' },
];

export const initialPlaces = [
  {
    id: 'preset-1',
    name: '어니언 성수',
    category: '카페',
    address: '서울 성동구 아차산로9길 8',
    latitude: 37.5446,
    longitude: 127.0559,
    hours: '매일 08:00 - 22:00',
    menu: '팡도르, 아메리카노',
    reviewSummary: '공장을 개조한 성수 대표 감성 카페. 사진 반응과 저장률이 높습니다.',
    screenshotText: '#성수카페 #어니언 #onion 성수 대표 핫플',
    confidence: 0.94,
  },
  {
    id: 'preset-2',
    name: '쵸리상경 성수',
    category: '맛집',
    address: '서울 성동구 서울숲길 18',
    latitude: 37.5471,
    longitude: 127.0425,
    hours: '매일 11:00 - 21:30',
    menu: '갈릭 덮밥, 고기 국수',
    reviewSummary: '서울숲 근처 식사 코스에 잘 맞는 맛집으로 분류했습니다.',
    screenshotText: '서울숲 근처 식사 맛집 쵸리상경 덮밥 추천',
    confidence: 0.88,
  },
  {
    id: 'preset-3',
    name: '스테이 한옥',
    category: '숙박',
    address: '서울 종로구 자하문로',
    latitude: 37.5802,
    longitude: 126.9691,
    hours: '체크인 15:00 / 체크아웃 11:00',
    menu: '한옥 1박',
    reviewSummary: '서촌 골목과 연결되는 조용한 숙소로 주말 코스에 넣기 좋습니다.',
    screenshotText: '#서촌숙소 #한옥스테이 주말 감성 숙소',
    confidence: 0.86,
  },
  {
    id: 'preset-4',
    name: '서울숲 공원',
    category: '관광지',
    address: '서울 성동구 뚝섬로 273',
    latitude: 37.5443,
    longitude: 127.0374,
    hours: '24시간 개방',
    menu: '산책, 피크닉',
    reviewSummary: '성수 카페와 함께 묶기 좋은 산책 코스입니다.',
    screenshotText: '#서울숲 #피크닉 #성수데이트',
    confidence: 0.91,
  },
];

export const demoTexts = [
  '인스타 릴스에서 본 #성수카페 #어니언. 빵이랑 커피 저장해둘 핫플',
  '서울숲 근처 식사 맛집 쵸리상경. 덮밥 먹고 카페 가기 좋은 코스',
  '#서촌숙소 #한옥스테이 주말 감성 숙소로 저장',
];

export const demoScreenshots = [
  {
    name: '성수 대형 에스프레소 바 캡처',
    imageUrl: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=600&q=80',
    promptHint: '성수 에스프레소 바 캡처 이미지 OCR 분석',
  },
  {
    name: '제주 감성 독채 펜션 캡처',
    imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80',
    promptHint: '제주 감성 한옥 숙소 캡처 이미지 OCR 분석',
  },
  {
    name: '한남동 퓨전 맛집 캡처',
    imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80',
    promptHint: '한남동 파스타 맛집 캡처 이미지 OCR 분석',
  },
];
