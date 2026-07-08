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
