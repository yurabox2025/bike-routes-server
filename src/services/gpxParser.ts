import { parseStringPromise } from 'xml2js';

interface ParsedGpx {
  points: [number, number][];
  startedAt: string;
  durationSeconds?: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
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
  const elevations: number[] = [];
  const times: string[] = [];

  for (const track of tracks) {
    for (const segment of asArray(track?.trkseg)) {
      for (const point of asArray(segment?.trkpt)) {
        const lat = Number(point?.lat);
        const lon = Number(point?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push([lon, lat]);
          const ele = Number(point?.ele);
          if (Number.isFinite(ele)) {
            elevations.push(ele);
          }
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

  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    const delta = elevations[index] - elevations[index - 1];
    if (!Number.isFinite(delta) || delta === 0) {
      continue;
    }
    if (delta > 0) {
      elevationGainMeters += delta;
    } else {
      elevationLossMeters += Math.abs(delta);
    }
  }

  return {
    points,
    startedAt,
    durationSeconds,
    elevationGainMeters: Math.round(elevationGainMeters),
    elevationLossMeters: Math.round(elevationLossMeters)
  };
}
