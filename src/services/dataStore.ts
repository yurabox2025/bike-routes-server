import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import type { DataFile, User } from '../types/models.js';
import { writeJsonAtomic } from '../utils/fs.js';
import { Mutex } from '../utils/mutex.js';

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

export async function initDataStore(): Promise<void> {
  await dataMutex.runExclusive(async () => {
    try {
      await fs.access(config.dataFilePath);
    } catch {
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
      await writeJsonAtomic(config.dataFilePath, data);
      return;
    }

    const data = await readDataUnsafe();
    const hasAdmin = data.users.some((user) => user.role === 'admin');
    if (!hasAdmin) {
      data.users.push({
        id: uuidv4(),
        name: config.adminName,
        pinHash: await bcrypt.hash(config.adminPin, 10),
        role: 'admin',
        createdAt: new Date().toISOString(),
        disabled: false
      });
      data.updatedAt = new Date().toISOString();
      await writeJsonAtomic(config.dataFilePath, data);
    }
  });
}

async function readDataUnsafe(): Promise<DataFile> {
  const raw = await fs.readFile(config.dataFilePath, 'utf-8');
  return JSON.parse(raw) as DataFile;
}

export async function readData(): Promise<DataFile> {
  return dataMutex.runExclusive(async () => readDataUnsafe());
}

export async function updateData(mutator: (data: DataFile) => void | Promise<void>): Promise<DataFile> {
  return dataMutex.runExclusive(async () => {
    const data = await readDataUnsafe();
    await mutator(data);
    data.updatedAt = new Date().toISOString();
    await writeJsonAtomic(config.dataFilePath, data);
    return data;
  });
}
