import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const cwd = process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataFilePath: process.env.DATA_FILE_PATH ?? path.join(cwd, '..', 'data', 'data.json'),
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(cwd, 'uploads'),
  maxGpxSizeMb: Number(process.env.MAX_GPX_SIZE_MB ?? 20),
  maxSimplifiedPoints: Number(process.env.MAX_SIMPLIFIED_POINTS ?? 5000),
  yadiskToken: process.env.YADISK_TOKEN ?? '',
  yadiskBaseDir: process.env.YADISK_BASE_DIR ?? '/bike-app',
  localFallbackEnabled: process.env.LOCAL_FALLBACK_ENABLED !== 'false',
  adminName: process.env.ADMIN_NAME ?? 'admin',
  adminPin: process.env.ADMIN_PIN ?? '1234'
};

export const isProduction = process.env.NODE_ENV === 'production';
