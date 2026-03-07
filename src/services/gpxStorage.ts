import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

export interface StoredGpxRef {
  provider: 'yadisk' | 'local';
  pathOrUrl: string;
}

function buildDirectoryChain(filePath: string): string[] {
  if (filePath.startsWith('app:/')) {
    const segments = filePath
      .slice('app:/'.length)
      .split('/')
      .filter(Boolean);
    const dirSegments = segments.slice(0, -1);
    const chain: string[] = [];
    let current = 'app:';
    for (const segment of dirSegments) {
      current = `${current}/${segment}`;
      chain.push(current);
    }
    return chain;
  }

  const segments = filePath.split('/').filter(Boolean);
  const dirSegments = segments.slice(0, -1);
  const chain: string[] = [];
  let current = '';
  for (const segment of dirSegments) {
    current = `${current}/${segment}`;
    chain.push(current);
  }
  return chain;
}

async function ensureRemoteDirectory(path: string): Promise<void> {
  const mkdirUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources');
  mkdirUrl.searchParams.set('path', path);

  const mkdirResp = await fetch(mkdirUrl, {
    method: 'PUT',
    headers: {
      Authorization: `OAuth ${config.yadiskToken}`
    }
  });

  if (mkdirResp.status === 201 || mkdirResp.status === 202 || mkdirResp.status === 409) {
    return;
  }

  const body = await mkdirResp.text();
  throw new Error(`Yandex Disk mkdir error for "${path}": ${mkdirResp.status} ${body}`);
}

async function ensureDirectoriesForRemoteFile(filePath: string): Promise<void> {
  const chain = buildDirectoryChain(filePath);
  for (const dir of chain) {
    await ensureRemoteDirectory(dir);
  }
}

function normalizeRemotePath(activityId: string): string {
  const base = config.yadiskBaseDir.replace(/\/$/, '');
  return `${base}/gpx/${activityId}.gpx`;
}

async function uploadToYandexDisk(activityId: string, fileBuffer: Buffer): Promise<StoredGpxRef> {
  const remotePath = normalizeRemotePath(activityId);
  await ensureDirectoriesForRemoteFile(remotePath);

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
