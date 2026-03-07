import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const cwd = process.cwd();
const dataStorageProviderRaw = (process.env.DATA_STORAGE_PROVIDER ?? 'auto').toLowerCase();
const dataStorageProvider =
  dataStorageProviderRaw === 'local' || dataStorageProviderRaw === 'yadisk' || dataStorageProviderRaw === 'auto'
    ? dataStorageProviderRaw
    : 'auto';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataFilePath: process.env.DATA_FILE_PATH ?? path.join(cwd, '..', 'data', 'data.json'),
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(cwd, 'uploads'),
  maxGpxSizeMb: Number(process.env.MAX_GPX_SIZE_MB ?? 20),
  maxSimplifiedPoints: Number(process.env.MAX_SIMPLIFIED_POINTS ?? 5000),
  yadiskToken: process.env.YADISK_TOKEN ?? '',
  yadiskBaseDir: process.env.YADISK_BASE_DIR ?? '/bike-app',
  yadiskDataPath: process.env.YADISK_DATA_PATH ?? '/bike-app/data/data.json',
  dataStorageProvider,
  localFallbackEnabled: process.env.LOCAL_FALLBACK_ENABLED !== 'false',
  adminName: process.env.ADMIN_NAME ?? 'admin',
  adminPin: process.env.ADMIN_PIN ?? '1234'
};

export const isProduction = process.env.NODE_ENV === 'production';
export const isRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_EXTERNAL_URL);

export function validateConfig(): void {
  if (config.dataStorageProvider === 'yadisk' && !config.yadiskToken) {
    throw new Error('Invalid configuration: DATA_STORAGE_PROVIDER=yadisk requires YADISK_TOKEN');
  }
}
