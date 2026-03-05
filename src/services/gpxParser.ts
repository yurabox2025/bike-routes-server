import { parseStringPromise } from 'xml2js';

interface ParsedGpx {
  points: [number, number][];
  startedAt: string;
  durationSeconds?: number;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export async function parseGpx(buffer: Buffer): Promise<ParsedGpx> {
  const xml = buffer.toString('utf-8');
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: true,
    trim: true
  });

  const tracks = asArray(parsed?.gpx?.trk);
  const points: [number, number][] = [];
  const times: string[] = [];

  for (const track of tracks) {
    for (const segment of asArray(track?.trkseg)) {
      for (const point of asArray(segment?.trkpt)) {
        const lat = Number(point?.lat);
        const lon = Number(point?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push([lon, lat]);
          if (point?.time) {
            times.push(String(point.time));
          }
        }
      }
    }
  }

  if (points.length < 2) {
    throw new Error('GPX does not contain a valid track with at least two points');
  }

  const sortedTimes = times
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const startedAt = (sortedTimes[0] ?? new Date()).toISOString();

  let durationSeconds: number | undefined;
  if (sortedTimes.length > 1) {
    durationSeconds = Math.floor((sortedTimes[sortedTimes.length - 1].getTime() - sortedTimes[0].getTime()) / 1000);
    if (durationSeconds < 0) {
      durationSeconds = undefined;
    }
  }

  return { points, startedAt, durationSeconds };
}
