import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config, isRender } from '../config.js';
import type { DataFile, User } from '../types/models.js';
import { writeJsonAtomic } from '../utils/fs.js';
import { Mutex } from '../utils/mutex.js';
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

function shouldUseYadiskForData(): boolean {
  if (config.dataStorageProvider === 'local') {
    return false;
  }
  if (config.dataStorageProvider === 'yadisk') {
    return true;
  }
  // In auto mode: local dev uses local file, Render deploy uses Yandex Disk (if token exists).
  return isRender && Boolean(config.yadiskToken);
}

export function getDataProvider(): 'local' | 'yadisk' {
  return shouldUseYadiskForData() ? 'yadisk' : 'local';
}

export function getDataWriteTarget(): string {
  return getDataProvider() === 'yadisk' ? config.yadiskDataPath : config.dataFilePath;
}

async function readLocalData(): Promise<DataFile> {
  const raw = await fs.readFile(config.dataFilePath, 'utf-8');
  return JSON.parse(raw) as DataFile;
}

async function writeLocalData(data: DataFile): Promise<void> {
  await writeJsonAtomic(config.dataFilePath, data);
}

async function readDataUnsafe(): Promise<DataFile> {
  if (!shouldUseYadiskForData()) {
    return readLocalData();
  }

  try {
    const data = await downloadDataFromYandexDisk();
    await writeLocalData(data);
    return data;
  } catch (error) {
    console.error('Failed to read data.json from Yandex Disk:', error);
    if (!config.localFallbackEnabled) {
      throw error;
    }
    return readLocalData();
  }
}

async function persistData(data: DataFile): Promise<void> {
  if (!shouldUseYadiskForData()) {
    await writeLocalData(data);
    return;
  }

  try {
    await uploadDataToYandexDisk(data);
    await writeLocalData(data);
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
