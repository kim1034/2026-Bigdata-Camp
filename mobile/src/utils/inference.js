export function inferPlaceFromText(text) {
  const value = String(text || '').toLowerCase();

  if (value.includes('숙소') || value.includes('스테이') || value.includes('한옥') || value.includes('펜션')) {
    return {
      id: `place-${Date.now()}`,
      name: value.includes('제주') ? '제주 감성 독채 펜션' : '스테이 한옥',
      category: '숙박',
      address: value.includes('제주') ? '제주 제주시 애월읍' : '서울 종로구 자하문로',
      latitude: value.includes('제주') ? 33.4631 : 37.5802,
      longitude: value.includes('제주') ? 126.3104 : 126.9691,
      hours: '체크인 15:00 / 체크아웃 11:00',
      menu: '감성 숙소 1박',
      reviewSummary: '캡처 이미지에서 숙소 키워드를 감지해 조용한 숙박 코스로 분류했습니다.',
      screenshotText: text || '숙소 캡처 OCR 결과',
      confidence: 0.86,
    };
  }

  if (value.includes('맛집') || value.includes('덮밥') || value.includes('식사') || value.includes('파스타')) {
    return {
      id: `place-${Date.now()}`,
      name: value.includes('한남') ? '한남동 퓨전 파스타' : '쵸리상경 성수',
      category: '맛집',
      address: value.includes('한남') ? '서울 용산구 한남동' : '서울 성동구 서울숲길 18',
      latitude: value.includes('한남') ? 37.5344 : 37.5471,
      longitude: value.includes('한남') ? 127.0008 : 127.0425,
      hours: '매일 11:00 - 21:30',
      menu: value.includes('파스타') ? '시그니처 파스타, 와인' : '갈릭 덮밥, 고기 국수',
      reviewSummary: '식사 관련 키워드와 지역 맥락을 함께 보고 맛집으로 저장합니다.',
      screenshotText: text || '맛집 캡처 OCR 결과',
      confidence: 0.88,
    };
  }

  if (value.includes('서울숲') || value.includes('공원') || value.includes('피크닉')) {
    return {
      id: `place-${Date.now()}`,
      name: '서울숲 공원',
      category: '관광지',
      address: '서울 성동구 뚝섬로 273',
      latitude: 37.5443,
      longitude: 127.0374,
      hours: '24시간 개방',
      menu: '산책, 피크닉',
      reviewSummary: '공원/피크닉 키워드를 감지해 성수 코스의 관광지로 분류했습니다.',
      screenshotText: text || '관광지 캡처 OCR 결과',
      confidence: 0.91,
    };
  }

  return {
    id: `place-${Date.now()}`,
    name: value.includes('onion') || value.includes('어니언') ? '어니언 성수' : '무브모브 성수',
    category: '카페',
    address: '서울 성동구 성수이로',
    latitude: 37.5438,
    longitude: 127.0569,
    hours: '매일 10:30 - 22:00',
    menu: '크림 라떼, 수제 케이크',
    reviewSummary: '릴스 저장 반응이 높은 성수 디저트 카페로 자동 분류했습니다.',
    screenshotText: text || '카페 캡처 OCR 결과',
    confidence: 0.93,
  };
}

export function inferPlaceFromImagePayload(imagePayload) {
  const value = String(imagePayload || '').toLowerCase();
  if (value.includes('607377') || value.includes('hotel') || value.includes('pension')) {
    return inferPlaceFromText('제주 감성 독채 펜션 숙소 캡처');
  }
  if (value.includes('151724') || value.includes('restaurant') || value.includes('pasta')) {
    return inferPlaceFromText('한남동 퓨전 파스타 맛집 캡처');
  }
  return inferPlaceFromText('성수 대형 에스프레소 바 카페 캡처');
}

function distanceKm(a, b) {
  const radius = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function buildRoute(places) {
  if (places.length <= 2) return places;
  const remaining = [...places];
  const ordered = [remaining.shift()];

  while (remaining.length) {
    const current = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestDistance = Infinity;

    remaining.forEach((place, index) => {
      const distance = distanceKm(current, place);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }

  return ordered;
}

export function routeLegs(routePlaces) {
  return routePlaces.slice(0, -1).map((from, index) => {
    const to = routePlaces[index + 1];
    const km = distanceKm(from, to);
    const mode = km < 1.2 ? '도보' : km < 5 ? '대중교통' : '자동차';
    const speed = mode === '도보' ? 4.2 : mode === '대중교통' ? 18 : 24;

    return {
      from,
      to,
      mode,
      distanceKm: km,
      durationMin: Math.max(4, Math.round((km / speed) * 60)),
    };
  });
}
