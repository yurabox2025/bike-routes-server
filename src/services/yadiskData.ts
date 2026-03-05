import fetch from 'node-fetch';
import { config } from '../config.js';
import type { DataFile } from '../types/models.js';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `OAuth ${config.yadiskToken}`
  };
}

export async function uploadDataToYandexDisk(data: DataFile): Promise<void> {
  if (!config.yadiskToken) {
    throw new Error('YADISK_TOKEN is not configured');
  }

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
