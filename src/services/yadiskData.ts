import fetch from 'node-fetch';
import { config } from '../config.js';
import type { DataFile } from '../types/models.js';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `OAuth ${config.yadiskToken}`
  };
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

async function ensureDirectory(path: string): Promise<void> {
  const mkdirUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources');
  mkdirUrl.searchParams.set('path', path);

  const mkdirResp = await fetch(mkdirUrl, {
    method: 'PUT',
    headers: authHeaders()
  });

  if (mkdirResp.status === 201 || mkdirResp.status === 202 || mkdirResp.status === 409) {
    return;
  }

  const body = await mkdirResp.text();
  throw new Error(`Yandex Disk mkdir error for "${path}": ${mkdirResp.status} ${body}`);
}

async function ensureDirectoriesForFile(filePath: string): Promise<void> {
  const chain = buildDirectoryChain(filePath);
  for (const dir of chain) {
    await ensureDirectory(dir);
  }
}

export async function uploadDataToYandexDisk(data: DataFile): Promise<void> {
  if (!config.yadiskToken) {
    throw new Error('YADISK_TOKEN is not configured');
  }

  await ensureDirectoriesForFile(config.yadiskDataPath);

  const metaUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources/upload');
  metaUrl.searchParams.set('path', config.yadiskDataPath);
  metaUrl.searchParams.set('overwrite', 'true');

  const metaResp = await fetch(metaUrl, {
    method: 'GET',
    headers: authHeaders()
  });

  if (!metaResp.ok) {
    const body = await metaResp.text();
    throw new Error(`Yandex Disk data upload URL error: ${metaResp.status} ${body}`);
  }

  const metaJson = (await metaResp.json()) as { href?: string };
  if (!metaJson.href) {
    throw new Error('Yandex Disk data upload URL is missing');
  }

  const uploadResp = await fetch(metaJson.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data, null, 2)
  });

  if (!uploadResp.ok) {
    const body = await uploadResp.text();
    throw new Error(`Yandex Disk data upload failed: ${uploadResp.status} ${body}`);
  }
}

export async function downloadDataFromYandexDisk(): Promise<DataFile> {
  if (!config.yadiskToken) {
    throw new Error('YADISK_TOKEN is not configured');
  }

  const metaUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources/download');
  metaUrl.searchParams.set('path', config.yadiskDataPath);

  const metaResp = await fetch(metaUrl, {
    method: 'GET',
    headers: authHeaders()
  });

  if (!metaResp.ok) {
    const body = await metaResp.text();
    throw new Error(`Yandex Disk data download URL error: ${metaResp.status} ${body}`);
  }

  const metaJson = (await metaResp.json()) as { href?: string };
  if (!metaJson.href) {
    throw new Error('Yandex Disk data download URL is missing');
  }

  const downloadResp = await fetch(metaJson.href, {
    method: 'GET'
  });

  if (!downloadResp.ok) {
    const body = await downloadResp.text();
    throw new Error(`Yandex Disk data download failed: ${downloadResp.status} ${body}`);
  }

  return (await downloadResp.json()) as DataFile;
}
