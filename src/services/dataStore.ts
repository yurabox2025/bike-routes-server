import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config, isRender } from '../config.js';
import type { DataFile, User } from '../types/models.js';
import { writeJsonAtomic } from '../utils/fs.js';
import { Mutex } from '../utils/mutex.js';
import { initSqliteDataStore, readDataFromSqlite, writeDataToSqlite } from './sqliteData.js';
import { downloadDataFromYandexDisk, uploadDataToYandexDisk } from './yadiskData.js';

const dataMutex = new Mutex();

function createEmptyData(): DataFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    users: [],
    routes: [],
    activities: []
  };
}

async function createDefaultDataWithAdmin(): Promise<DataFile> {
  const data = createEmptyData();
  const admin: User = {
    id: uuidv4(),
    name: config.adminName,
    pinHash: await bcrypt.hash(config.adminPin, 10),
    role: 'admin',
    createdAt: new Date().toISOString(),
    disabled: false
  };
  data.users.push(admin);
  data.updatedAt = new Date().toISOString();
  return data;
}

function isYadiskDataNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('download url error: 404') ||
    message.includes('"error":"disknotfounderror"') ||
    message.includes('"error":"diskpathdoesntexistserror"')
  );
}

function shouldUseYadiskForData(): boolean {
  if (config.dataStorageProvider === 'local' || config.dataStorageProvider === 'sqlite') {
    return false;
  }
  if (config.dataStorageProvider === 'yadisk') {
    return true;
  }
  // In auto mode: local dev uses local file, Render deploy uses Yandex Disk (if token exists).
  return isRender && Boolean(config.yadiskToken);
}

function shouldUseSqliteForData(): boolean {
  return config.dataStorageProvider === 'sqlite';
}

export function getDataProvider(): 'local' | 'yadisk' | 'sqlite' {
  if (shouldUseSqliteForData()) {
    return 'sqlite';
  }
  return shouldUseYadiskForData() ? 'yadisk' : 'local';
}

export function getDataWriteTarget(): string {
  const provider = getDataProvider();
  if (provider === 'yadisk') {
    return config.yadiskDataPath;
  }
  if (provider === 'sqlite') {
    return config.sqliteFilePath;
  }
  return config.dataFilePath;
}

async function readLocalData(): Promise<DataFile> {
  try {
    const raw = await fs.readFile(config.dataFilePath, 'utf-8');
    return JSON.parse(raw) as DataFile;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code !== 'ENOENT') {
      throw error;
    }

    const data = await createDefaultDataWithAdmin();
    await writeLocalData(data);
    console.log(`data.json not found. Created default file at: ${config.dataFilePath}`);
    return data;
  }
}

async function writeLocalData(data: DataFile): Promise<void> {
  await writeJsonAtomic(config.dataFilePath, data);
}

async function writeLocalMirrorIfNeeded(data: DataFile): Promise<void> {
  if (isRender) {
    return;
  }

  try {
    await writeLocalData(data);
  } catch (error) {
    console.warn('Local data mirror write skipped:', error);
  }
}

async function readSqliteData(): Promise<DataFile> {
  const data = await readDataFromSqlite();
  if (data) {
    return data;
  }

  try {
    const localData = await readLocalData();
    await writeDataToSqlite(localData);
    console.log(`Initialized SQLite data from existing JSON file: ${config.dataFilePath}`);
    return localData;
  } catch (error) {
    console.warn('Failed to initialize SQLite from local data.json, creating default data:', error);
  }

  const defaultData = await createDefaultDataWithAdmin();
  await writeDataToSqlite(defaultData);
  console.log(`SQLite DB not found. Created default data at: ${config.sqliteFilePath}`);
  return defaultData;
}

async function readDataUnsafe(): Promise<DataFile> {
  if (shouldUseSqliteForData()) {
    return readSqliteData();
  }

  if (!shouldUseYadiskForData()) {
    return readLocalData();
  }

  try {
    const data = await downloadDataFromYandexDisk();
    await writeLocalMirrorIfNeeded(data);
    return data;
  } catch (error) {
    if (isYadiskDataNotFoundError(error)) {
      const defaultData = await createDefaultDataWithAdmin();
      await persistData(defaultData);
      console.log(`data.json not found on Yandex Disk. Created default file at: ${config.yadiskDataPath}`);
      return defaultData;
    }
    console.error('Failed to read data.json from Yandex Disk:', error);
    if (!config.localFallbackEnabled) {
      throw error;
    }
    return readLocalData();
  }
}

async function persistData(data: DataFile): Promise<void> {
  if (shouldUseSqliteForData()) {
    await writeDataToSqlite(data);
    return;
  }

  if (!shouldUseYadiskForData()) {
    await writeLocalData(data);
    return;
  }

  try {
    await uploadDataToYandexDisk(data);
    await writeLocalMirrorIfNeeded(data);
  } catch (error) {
    console.error('Failed to write data.json to Yandex Disk:', error);
    if (!config.localFallbackEnabled) {
      throw error;
    }
    await writeLocalData(data);
  }
}

async function ensureAdminExists(data: DataFile): Promise<boolean> {
  const hasAdmin = data.users.some((user) => user.role === 'admin');
  if (hasAdmin) {
    return false;
  }

  data.users.push({
    id: uuidv4(),
    name: config.adminName,
    pinHash: await bcrypt.hash(config.adminPin, 10),
    role: 'admin',
    createdAt: new Date().toISOString(),
    disabled: false
  });

  return true;
}

export async function initDataStore(): Promise<void> {
  await dataMutex.runExclusive(async () => {
    if (shouldUseSqliteForData()) {
      await initSqliteDataStore();
    }

    try {
      const data = await readDataUnsafe();
      const changed = await ensureAdminExists(data);
      if (changed) {
        data.updatedAt = new Date().toISOString();
        await persistData(data);
      }
      return;
    } catch (error) {
      console.error('Data store bootstrap read failed, creating new data file:', error);
    }

    const data = await createDefaultDataWithAdmin();
    await persistData(data);
  });
}

export async function readData(): Promise<DataFile> {
  return dataMutex.runExclusive(async () => readDataUnsafe());
}

export async function updateData(mutator: (data: DataFile) => void | Promise<void>): Promise<DataFile> {
  return dataMutex.runExclusive(async () => {
    const data = await readDataUnsafe();
    await mutator(data);
    data.updatedAt = new Date().toISOString();
    await persistData(data);
    return data;
  });
}
