import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { readData, updateData } from '../services/dataStore.js';
import type { Route } from '../types/models.js';

const visibilitySchema = z.enum(['public', 'private']);

const createRouteSchema = z.object({
  name: z.string().min(1).max(120),
  visibility: visibilitySchema.default('private'),
  routeLineGeoJson: z
    .object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)
    })
    .optional()
});

const updateVisibilitySchema = z.object({
  visibility: visibilitySchema
});

const routeListQuerySchema = z.object({
  scope: z.enum(['all', 'public', 'private', 'mine']).default('all')
});

function normalizeRouteVisibility(route: Route): 'public' | 'private' {
  return route.visibility === 'private' ? 'private' : 'public';
}

function canViewRoute(route: Route, userId: string): boolean {
  const visibility = normalizeRouteVisibility(route);
  return visibility === 'public' || route.createdBy === userId;
}

function canManageRoute(route: Route, userId: string, role: 'user' | 'admin'): boolean {
  return role === 'admin' || route.createdBy === userId;
}

export const routesRouter = Router();
routesRouter.use(requireAuth);

routesRouter.get('/', async (req, res) => {
  const parsedQuery = routeListQuerySchema.safeParse({ scope: req.query.scope ?? 'all' });
  if (!parsedQuery.success) {
    res.status(400).json({ message: 'Invalid query' });
    return;
  }

  const data = await readData();
  const userId = req.currentUser!.id;

  const routes = data.routes
    .filter((route) => {
      const visibility = normalizeRouteVisibility(route);

      if (parsedQuery.data.scope === 'public') {
        return visibility === 'public';
      }

      if (parsedQuery.data.scope === 'private') {
        return visibility === 'private' && route.createdBy === userId;
      }

      if (parsedQuery.data.scope === 'mine') {
        return route.createdBy === userId;
      }

      return canViewRoute(route, userId);
    })
    .map((route) => ({ ...route, visibility: normalizeRouteVisibility(route) }));

  res.json({ routes });
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
      visibility: parsed.data.visibility,
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

  if (!canViewRoute(route, req.currentUser!.id)) {
    res.status(403).json({ message: 'Запрещено' });
    return;
  }

  route.visibility = normalizeRouteVisibility(route);

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

routesRouter.patch('/:id/visibility', async (req, res) => {
  const parsed = updateVisibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  let updatedRoute: Route | undefined;

  await updateData((data) => {
    const route = data.routes.find((candidate) => candidate.id === req.params.id);
    if (!route) {
      throw new Error('Route not found');
    }

    if (!canManageRoute(route, req.currentUser!.id, req.currentUser!.role)) {
      throw new Error('Запрещено');
    }

    route.visibility = parsed.data.visibility;
    updatedRoute = route;
  });

  res.json({ route: updatedRoute });
});

routesRouter.delete('/:id', async (req, res) => {
  await updateData((data) => {
    const route = data.routes.find((candidate) => candidate.id === req.params.id);
    if (!route) {
      throw new Error('Route not found');
    }

    if (!canManageRoute(route, req.currentUser!.id, req.currentUser!.role)) {
      throw new Error('Запрещено');
    }

    const routeIndex = data.routes.findIndex((candidate) => candidate.id === req.params.id);
    data.routes.splice(routeIndex, 1);

    for (const activity of data.activities) {
      if (activity.routeId === req.params.id) {
        activity.routeId = null;
      }
    }
  });

  res.json({ ok: true });
});
