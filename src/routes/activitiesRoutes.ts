import { Router } from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { parseGpx } from '../services/gpxParser.js';
import { storeGpx } from '../services/gpxStorage.js';
import { readData, updateData } from '../services/dataStore.js';
import type { Activity } from '../types/models.js';
import { limitPoints, lineDistanceMeters, privacyCut, simplifyCoords, toLineString } from '../utils/geo.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxGpxSizeMb * 1024 * 1024
  }
});

const assignRouteSchema = z.object({
  routeId: z.string().min(1)
});

const updateParticipantsSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1)
});

function parseParticipantUserIds(rawValue: unknown): string[] {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => String(value).trim()).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(String(rawValue)) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value).trim()).filter(Boolean);
    }
  } catch {
    // Continue to fallback comma-separated parsing.
  }

  return String(rawValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeParticipants(activity: Activity): string[] {
  if (Array.isArray(activity.participantUserIds) && activity.participantUserIds.length > 0) {
    return Array.from(new Set(activity.participantUserIds));
  }
  return [activity.userId];
}

export const activitiesRouter = Router();
activitiesRouter.use(requireAuth);

activitiesRouter.get('/', async (req, res) => {
  const routeId = req.query.routeId ? String(req.query.routeId) : undefined;
  const userId = req.query.userId ? String(req.query.userId) : undefined;

  const data = await readData();
  const activities = data.activities.filter((activity) => {
    if (routeId && activity.routeId !== routeId) {
      return false;
    }
    const participantIds = normalizeParticipants(activity);
    if (userId && !participantIds.includes(userId)) {
      return false;
    }
    return true;
  });

  for (const activity of activities) {
    activity.participantUserIds = normalizeParticipants(activity);
  }

  res.json({ activities });
});

activitiesRouter.get('/:id', async (req, res) => {
  const data = await readData();
  const activity = data.activities.find((candidate) => candidate.id === req.params.id);
  if (!activity) {
    res.status(404).json({ message: 'Activity not found' });
    return;
  }

  activity.participantUserIds = normalizeParticipants(activity);
  res.json({ activity });
});

activitiesRouter.post('/', upload.single('gpx'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'GPX file is required' });
    return;
  }

  const activityId = uuidv4();
  const trimMeters = Number(req.body.trimMeters ?? 0);
  const routeId = req.body.routeId ? String(req.body.routeId) : null;
  const requestedParticipants = parseParticipantUserIds(req.body.participantUserIds);

  const parsed = await parseGpx(req.file.buffer);
  let coords = parsed.points;

  if (trimMeters > 0 && Number.isFinite(trimMeters)) {
    coords = privacyCut(coords, trimMeters);
  }

  coords = simplifyCoords(coords, 0.00004);
  coords = limitPoints(coords, config.maxSimplifiedPoints);

  if (coords.length < 2) {
    res.status(400).json({ message: 'Track becomes too short after processing' });
    return;
  }

  const storedGpx = await storeGpx(activityId, req.file.buffer);

  let createdActivity: Activity | undefined;

  await updateData((data) => {
    if (routeId && !data.routes.some((route) => route.id === routeId)) {
      throw new Error('Route not found');
    }

    const uniqueParticipantIds = Array.from(new Set([req.currentUser!.id, ...requestedParticipants]));
    const allParticipantsExist = uniqueParticipantIds.every((userId) => data.users.some((user) => user.id === userId && !user.disabled));
    if (!allParticipantsExist) {
      throw new Error('Some participant users do not exist');
    }

    createdActivity = {
      id: activityId,
      userId: req.currentUser!.id,
      participantUserIds: uniqueParticipantIds,
      startedAt: parsed.startedAt,
      distanceMeters: Math.round(lineDistanceMeters(coords)),
      durationSeconds: parsed.durationSeconds,
      polylineGeoJson: toLineString(coords),
      gpxStorage: storedGpx,
      routeId,
      createdAt: new Date().toISOString()
    };

    data.activities.push(createdActivity);
  });

  res.status(201).json({ activity: createdActivity });
});

activitiesRouter.post('/:id/assign-route', async (req, res) => {
  const parsed = assignRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let updatedActivity: Activity | undefined;

  await updateData((data) => {
    const routeExists = data.routes.some((route) => route.id === parsed.data.routeId);
    if (!routeExists) {
      throw new Error('Route not found');
    }

    const activity = data.activities.find((candidate) => candidate.id === req.params.id);
    if (!activity) {
      throw new Error('Activity not found');
    }

    activity.routeId = parsed.data.routeId;
    updatedActivity = activity;
  });

  res.json({ activity: updatedActivity });
});

activitiesRouter.post('/:id/unassign-route', async (req, res) => {
  let updatedActivity: Activity | undefined;

  await updateData((data) => {
    const activity = data.activities.find((candidate) => candidate.id === req.params.id);
    if (!activity) {
      throw new Error('Activity not found');
    }

    activity.routeId = null;
    updatedActivity = activity;
  });

  res.json({ activity: updatedActivity });
});

activitiesRouter.post('/:id/participants', async (req, res) => {
  const parsed = updateParticipantsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let updatedActivity: Activity | undefined;

  await updateData((data) => {
    const activity = data.activities.find((candidate) => candidate.id === req.params.id);
    if (!activity) {
      throw new Error('Activity not found');
    }

    const uniqueParticipantIds = Array.from(new Set([activity.userId, ...parsed.data.userIds]));
    const allParticipantsExist = uniqueParticipantIds.every((userId) => data.users.some((user) => user.id === userId && !user.disabled));
    if (!allParticipantsExist) {
      throw new Error('Some participant users do not exist');
    }

    activity.participantUserIds = uniqueParticipantIds;
    updatedActivity = activity;
  });

  res.json({ activity: updatedActivity });
});

activitiesRouter.delete('/:id/participants/:userId', async (req, res) => {
  let updatedActivity: Activity | undefined;

  await updateData((data) => {
    const activity = data.activities.find((candidate) => candidate.id === req.params.id);
    if (!activity) {
      throw new Error('Activity not found');
    }

    if (req.params.userId === activity.userId) {
      throw new Error('Activity owner cannot be removed from participants');
    }

    const existingParticipantIds = normalizeParticipants(activity);
    activity.participantUserIds = existingParticipantIds.filter((userId) => userId !== req.params.userId);
    updatedActivity = activity;
  });

  res.json({ activity: updatedActivity });
});

activitiesRouter.delete('/:id', async (req, res) => {
  let deletedActivity: Activity | undefined;

  await updateData((data) => {
    const index = data.activities.findIndex((candidate) => candidate.id === req.params.id);
    if (index === -1) {
      throw new Error('Activity not found');
    }

    deletedActivity = data.activities[index];
    data.activities.splice(index, 1);
  });

  if (deletedActivity?.gpxStorage.provider === 'local') {
    try {
      await fs.unlink(deletedActivity.gpxStorage.pathOrUrl);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        console.error('Failed to delete local GPX file:', error);
      }
    }
  }

  res.json({ ok: true });
});
