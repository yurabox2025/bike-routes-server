import { parseStringPromise } from 'xml2js';
import { haversineDistanceMeters } from '../utils/geo.js';

interface ParsedGpx {
  points: [number, number][];
  startedAt: string;
  durationSeconds?: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
}

interface RawTrackPoint {
  point: [number, number];
  elevationMeters?: number;
  time?: string;
}

export interface GpxProfileSample {
  distanceMeters: number;
  elevationMeters: number | null;
  slopePercent: number | null;
  slopeDegrees: number | null;
  time?: string;
}

export interface ParsedGpxProfile {
  samples: GpxProfileSample[];
  totalDistanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  maxSlopeUpPercent: number | null;
  maxSlopeDownPercent: number | null;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

async function parseRawTrackPoints(buffer: Buffer): Promise<RawTrackPoint[]> {
  const xml = buffer.toString('utf-8');
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: true,
    trim: true
  });

  const tracks = asArray(parsed?.gpx?.trk);
  const rawPoints: RawTrackPoint[] = [];

  for (const track of tracks) {
    for (const segment of asArray(track?.trkseg)) {
      for (const point of asArray(segment?.trkpt)) {
        const lat = Number(point?.lat);
        const lon = Number(point?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }

        const elevation = Number(point?.ele);
        const timeCandidate = point?.time ? new Date(String(point.time)) : null;

        rawPoints.push({
          point: [lon, lat],
          elevationMeters: Number.isFinite(elevation) ? elevation : undefined,
          time: timeCandidate && !Number.isNaN(timeCandidate.getTime()) ? timeCandidate.toISOString() : undefined
        });
      }
    }
  }

  return rawPoints;
}

function pickTimeBounds(points: RawTrackPoint[]): { startedAt: string; durationSeconds?: number } {
  const times = points
    .map((point) => (point.time ? new Date(point.time) : null))
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const startedAt = (times[0] ?? new Date()).toISOString();

  if (times.length < 2) {
    return { startedAt };
  }

  const durationSeconds = Math.floor((times[times.length - 1].getTime() - times[0].getTime()) / 1000);
  return {
    startedAt,
    durationSeconds: durationSeconds > 0 ? durationSeconds : undefined
  };
}

function downsampleProfileSamples(samples: GpxProfileSample[], maxPoints: number): GpxProfileSample[] {
  if (samples.length <= maxPoints) {
    return samples;
  }

  const step = Math.ceil(samples.length / maxPoints);
  const compact: GpxProfileSample[] = [];
  for (let index = 0; index < samples.length; index += step) {
    compact.push(samples[index]);
  }

  const last = samples[samples.length - 1];
  if (compact[compact.length - 1] !== last) {
    compact.push(last);
  }

  return compact;
}

export async function parseGpx(buffer: Buffer): Promise<ParsedGpx> {
  const rawPoints = await parseRawTrackPoints(buffer);
  const points = rawPoints.map((entry) => entry.point);

  if (points.length < 2) {
    throw new Error('GPX does not contain a valid track with at least two points');
  }

  const { startedAt, durationSeconds } = pickTimeBounds(rawPoints);

  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  for (let index = 1; index < rawPoints.length; index += 1) {
    const prev = rawPoints[index - 1].elevationMeters;
    const current = rawPoints[index].elevationMeters;
    if (typeof prev !== 'number' || typeof current !== 'number') {
      continue;
    }

    const delta = current - prev;
    if (delta > 0) {
      elevationGainMeters += delta;
    } else if (delta < 0) {
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

export async function parseGpxProfile(buffer: Buffer, maxPoints = 900): Promise<ParsedGpxProfile> {
  const rawPoints = await parseRawTrackPoints(buffer);
  if (rawPoints.length < 2) {
    throw new Error('GPX does not contain a valid track with at least two points');
  }

  const samples: GpxProfileSample[] = [];
  let totalDistanceMeters = 0;
  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  let maxSlopeUpPercent: number | null = null;
  let maxSlopeDownPercent: number | null = null;

  samples.push({
    distanceMeters: 0,
    elevationMeters: rawPoints[0].elevationMeters ?? null,
    slopePercent: null,
    slopeDegrees: null,
    time: rawPoints[0].time
  });

  for (let index = 1; index < rawPoints.length; index += 1) {
    const prev = rawPoints[index - 1];
    const current = rawPoints[index];

    const deltaDistance = haversineDistanceMeters(prev.point, current.point);
    totalDistanceMeters += deltaDistance;

    let slopePercent: number | null = null;
    let slopeDegrees: number | null = null;

    if (typeof prev.elevationMeters === 'number' && typeof current.elevationMeters === 'number') {
      const deltaElevation = current.elevationMeters - prev.elevationMeters;

      if (deltaElevation > 0) {
        elevationGainMeters += deltaElevation;
      } else if (deltaElevation < 0) {
        elevationLossMeters += Math.abs(deltaElevation);
      }

      if (deltaDistance >= 1) {
        slopePercent = (deltaElevation / deltaDistance) * 100;
        slopeDegrees = (Math.atan(deltaElevation / deltaDistance) * 180) / Math.PI;

        if (slopePercent > 0) {
          maxSlopeUpPercent = maxSlopeUpPercent === null ? slopePercent : Math.max(maxSlopeUpPercent, slopePercent);
        } else if (slopePercent < 0) {
          maxSlopeDownPercent = maxSlopeDownPercent === null ? slopePercent : Math.min(maxSlopeDownPercent, slopePercent);
        }
      }
    }

    samples.push({
      distanceMeters: totalDistanceMeters,
      elevationMeters: current.elevationMeters ?? null,
      slopePercent: slopePercent !== null ? Number(slopePercent.toFixed(2)) : null,
      slopeDegrees: slopeDegrees !== null ? Number(slopeDegrees.toFixed(2)) : null,
      time: current.time
    });
  }

  const compactSamples = downsampleProfileSamples(samples, maxPoints);

  const startedAt = rawPoints.find((point) => point.time)?.time;
  const finishedAt = [...rawPoints].reverse().find((point) => point.time)?.time;

  let durationSeconds: number | undefined;
  if (startedAt && finishedAt) {
    const duration = Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    if (duration > 0) {
      durationSeconds = duration;
    }
  }

  return {
    samples: compactSamples,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    elevationGainMeters: Math.round(elevationGainMeters),
    elevationLossMeters: Math.round(elevationLossMeters),
    maxSlopeUpPercent: maxSlopeUpPercent !== null ? Number(maxSlopeUpPercent.toFixed(2)) : null,
    maxSlopeDownPercent: maxSlopeDownPercent !== null ? Number(maxSlopeDownPercent.toFixed(2)) : null,
    startedAt,
    finishedAt,
    durationSeconds
  };
}
