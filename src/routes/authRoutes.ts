import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { signToken, verifyPin } from '../services/auth.js';
import { readData, updateData } from '../services/dataStore.js';
import { requireAuth } from '../middleware/auth.js';
import type { User } from '../types/models.js';
import { publicUser } from '../utils/sanitize.js';

const loginSchema = z.object({
  name: z.string().min(1),
  pin: z.string().min(3).max(32)
});

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  pin: z.string().min(3).max(32)
});

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let createdUser: User | undefined;

  await updateData(async (data) => {
    const existing = data.users.find((candidate) => candidate.name === parsed.data.name);
    if (existing) {
      throw new Error('User name already exists');
    }

    createdUser = {
      id: uuidv4(),
      name: parsed.data.name,
      pinHash: await bcrypt.hash(parsed.data.pin, 10),
      role: 'user',
      createdAt: new Date().toISOString(),
      disabled: false
    };
    data.users.push(createdUser);
  });

  res.status(201).json({
    token: signToken(createdUser!),
    user: publicUser(createdUser!)
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  const { name, pin } = parsed.data;
  const data = await readData();
  const user = data.users.find((candidate) => candidate.name === name && !candidate.disabled);

  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const ok = await verifyPin(pin, user.pinHash);
  if (!ok) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  res.json({
    token: signToken(user),
    user: publicUser(user)
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.currentUser!) });
});
