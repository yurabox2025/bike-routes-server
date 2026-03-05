import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../services/auth.js';
import { readData } from '../services/dataStore.js';
import type { User } from '../types/models.js';

declare module 'express-serve-static-core' {
  interface Request {
    currentUser?: User;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = verifyToken(token);
    const data = await readData();
    const user = data.users.find((candidate) => candidate.id === payload.userId && !candidate.disabled);
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    req.currentUser = user;
    next();
  } catch {
    res.status(401).json({ message: 'Unauthorized' });
  }
}
