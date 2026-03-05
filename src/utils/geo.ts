import type { LineStringGeoJson } from '../types/models.js';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceMeters(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function lineDistanceMeters(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineDistanceMeters(coords[i - 1], coords[i]);
  }
  return total;
}

function perpendicularDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const x = point[0];
  const y = point[1];
  const x1 = start[0];
  const y1 = start[1];
  const x2 = end[0];
  const y2 = end[1];

  const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);
  if (denominator === 0) {
    return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  }
  return numerator / denominator;
}

export function simplifyCoords(coords: [number, number][], tolerance = 0.00005): [number, number][] {
  if (coords.length <= 2) {
    return coords;
  }

  const keep = new Array(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;

  const stack: [number, number][] = [[0, coords.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = 0;
    let index = -1;

    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(coords[i], coords[start], coords[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (maxDistance > tolerance && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return coords.filter((_, idx) => keep[idx]);
}

export function privacyCut(coords: [number, number][], trimMeters: number): [number, number][] {
  if (trimMeters <= 0 || coords.length < 3) {
    return coords;
  }

  const trimStart = trimFromStart(coords, trimMeters);
  const trimEnd = trimFromStart([...trimStart].reverse(), trimMeters).reverse();
  return trimEnd.length >= 2 ? trimEnd : coords;
}

function trimFromStart(coords: [number, number][], meters: number): [number, number][] {
  let removed = 0;
  let idx = 0;
  while (idx < coords.length - 1 && removed < meters) {
    removed += haversineDistanceMeters(coords[idx], coords[idx + 1]);
    idx += 1;
  }
  return coords.slice(Math.min(idx, coords.length - 2));
}

export function toLineString(coords: [number, number][]): LineStringGeoJson {
  return {
    type: 'LineString',
    coordinates: coords
  };
}

export function limitPoints(coords: [number, number][], maxPoints: number): [number, number][] {
  if (coords.length <= maxPoints) {
    return coords;
  }

  const step = Math.ceil(coords.length / maxPoints);
  const compact: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) {
    compact.push(coords[i]);
  }

  const last = coords[coords.length - 1];
  if (compact[compact.length - 1] !== last) {
    compact.push(last);
  }

  return compact;
}
