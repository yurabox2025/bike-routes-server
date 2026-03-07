import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { readData, updateData } from '../services/dataStore.js';
import type { User } from '../types/models.js';
import { publicUser } from '../utils/sanitize.js';

const createUserSchema = z.object({
  name: z.string().min(1).max(80),
  pin: z.string().min(3).max(32),
  role: z.enum(['user', 'admin']).default('user')
});

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/', async (_req, res) => {
  const data = await readData();
  const users = data.users.filter((user) => !user.disabled).map(publicUser);
  res.json({ users });
});

usersRouter.post('/', async (req, res) => {
  if (req.currentUser?.role !== 'admin') {
    res.status(403).json({ message: 'Запрещено' });
    return;
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let createdUser: User | undefined;

  await updateData(async (data) => {
    const exists = data.users.some((user) => user.name === parsed.data.name);
    if (exists) {
      throw new Error('User name already exists');
    }

    createdUser = {
      id: uuidv4(),
      name: parsed.data.name,
      pinHash: await bcrypt.hash(parsed.data.pin, 10),
      role: parsed.data.role,
      createdAt: new Date().toISOString(),
      disabled: false
    };

    data.users.push(createdUser);
  });

  res.status(201).json({ user: publicUser(createdUser!) });
});
