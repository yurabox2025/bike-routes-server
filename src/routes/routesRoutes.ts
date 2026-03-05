import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { readData, updateData } from '../services/dataStore.js';
import type { Route } from '../types/models.js';

const createRouteSchema = z.object({
  name: z.string().min(1).max(120),
  routeLineGeoJson: z
    .object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)
    })
    .optional()
});

const routeFromActivitySchema = z.object({
  name: z.string().min(1).max(120)
});

export const routesRouter = Router();
routesRouter.use(requireAuth);

routesRouter.get('/', async (_req, res) => {
  const data = await readData();
  res.json({ routes: data.routes });
});

routesRouter.post('/', async (req, res) => {
  const parsed = createRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  if (!parsed.data.routeLineGeoJson) {
    res.status(400).json({ message: 'routeLineGeoJson is required for this endpoint' });
    return;
  }

  let createdRoute: Route | undefined;

  await updateData((data) => {
    createdRoute = {
      id: uuidv4(),
      name: parsed.data.name,
      createdBy: req.currentUser!.id,
      routeLineGeoJson: parsed.data.routeLineGeoJson!,
      createdAt: new Date().toISOString()
    };

    data.routes.push(createdRoute);
  });

  res.status(201).json({ route: createdRoute });
});

routesRouter.get('/:id', async (req, res) => {
  const data = await readData();
  const route = data.routes.find((candidate) => candidate.id === req.params.id);

  if (!route) {
    res.status(404).json({ message: 'Route not found' });
    return;
  }

  const completions = data.activities
    .filter((activity) => activity.routeId === route.id)
    .flatMap((activity) => {
      const participantIds =
        Array.isArray(activity.participantUserIds) && activity.participantUserIds.length > 0
          ? activity.participantUserIds
          : [activity.userId];

      return participantIds.map((participantId) => {
        const user = data.users.find((candidate) => candidate.id === participantId);
        return {
          activityId: activity.id,
          userId: participantId,
          userName: user?.name ?? 'Unknown',
          startedAt: activity.startedAt
        };
      });
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  res.json({ route, completions });
});

routesRouter.post('/from-activity/:activityId', async (req, res) => {
  const parsed = routeFromActivitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let createdRoute: Route | undefined;

  await updateData((data) => {
    const activity = data.activities.find((candidate) => candidate.id === req.params.activityId);
    if (!activity) {
      throw new Error('Activity not found');
    }

    createdRoute = {
      id: uuidv4(),
      name: parsed.data.name,
      createdBy: req.currentUser!.id,
      routeLineGeoJson: activity.polylineGeoJson,
      createdAt: new Date().toISOString()
    };

    data.routes.push(createdRoute);
  });

  res.status(201).json({ route: createdRoute });
});
