import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tmpFile = path.join(dir, `${path.basename(filePath)}.tmp`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tmpFile, filePath);
}
