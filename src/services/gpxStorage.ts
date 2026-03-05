import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

export interface StoredGpxRef {
  provider: 'yadisk' | 'local';
  pathOrUrl: string;
}

function normalizeRemotePath(activityId: string): string {
  const base = config.yadiskBaseDir.replace(/\/$/, '');
  return `${base}/gpx/${activityId}.gpx`;
}

async function uploadToYandexDisk(activityId: string, fileBuffer: Buffer): Promise<StoredGpxRef> {
  const remotePath = normalizeRemotePath(activityId);
  const metaUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources/upload');
  metaUrl.searchParams.set('path', remotePath);
  metaUrl.searchParams.set('overwrite', 'true');

  const metaResp = await fetch(metaUrl, {
    method: 'GET',
    headers: {
      Authorization: `OAuth ${config.yadiskToken}`
    }
  });

  if (!metaResp.ok) {
    const body = await metaResp.text();
    throw new Error(`Yandex Disk upload URL error: ${metaResp.status} ${body}`);
  }

  const metaJson = (await metaResp.json()) as { href?: string };
  if (!metaJson.href) {
    throw new Error('Yandex Disk upload URL is missing');
  }

  const uploadResp = await fetch(metaJson.href, {
    method: 'PUT',
    body: fileBuffer,
    headers: {
      'Content-Type': 'application/gpx+xml'
    }
  });

  if (!uploadResp.ok) {
    const body = await uploadResp.text();
    throw new Error(`Yandex Disk upload failed: ${uploadResp.status} ${body}`);
  }

  return {
    provider: 'yadisk',
    pathOrUrl: remotePath
  };
}

async function saveLocally(activityId: string, fileBuffer: Buffer): Promise<StoredGpxRef> {
  await ensureDir(config.uploadsDir);
  const localPath = path.join(config.uploadsDir, `${activityId}.gpx`);
  await fs.writeFile(localPath, fileBuffer);
  return {
    provider: 'local',
    pathOrUrl: localPath
  };
}

export async function storeGpx(activityId: string, fileBuffer: Buffer): Promise<StoredGpxRef> {
  if (config.yadiskToken) {
    try {
      return await uploadToYandexDisk(activityId, fileBuffer);
    } catch (error) {
      console.error('Yandex Disk upload failed:', error);
      if (!config.localFallbackEnabled) {
        throw error;
      }
    }
  }

  return saveLocally(activityId, fileBuffer);
}
