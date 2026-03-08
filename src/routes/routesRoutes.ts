import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { parseGpx } from '../services/gpxParser.js';
import { loadGpx, storeGpx } from '../services/gpxStorage.js';
import { readData, updateData } from '../services/dataStore.js';
import type { Route } from '../types/models.js';
import { limitPoints, privacyCut, simplifyCoords, toLineString } from '../utils/geo.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxGpxSizeMb * 1024 * 1024
  }
});

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
const updateRatingSchema = z.object({
  rating: z.number().int().min(1).max(10)
});
const updateParticipantsSchema = z.object({
  userIds: z.array(z.string().min(1))
});
const uploadRouteSchema = z.object({
  routeName: z.string().min(1).max(120),
  routeVisibility: visibilitySchema.default('private'),
  routeRating: z.number().int().min(1).max(10),
  trimMeters: z.number().min(0).default(0)
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
      rating: null,
      routeLineGeoJson: parsed.data.routeLineGeoJson!,
      createdAt: new Date().toISOString()
    };

    data.routes.push(createdRoute);
  });

  res.status(201).json({ route: createdRoute });
});

routesRouter.post('/upload', upload.single('gpx'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'GPX file is required' });
    return;
  }

  const parsedPayload = uploadRouteSchema.safeParse({
    routeName: req.body.routeName,
    routeVisibility: req.body.routeVisibility ?? 'private',
    routeRating: Number(req.body.routeRating),
    trimMeters: Number(req.body.trimMeters ?? 0)
  });
  if (!parsedPayload.success) {
    res.status(400).json({ message: 'Invalid payload' });
    return;
  }

  const parsedGpx = await parseGpx(req.file.buffer);
  const requestedParticipants = parseParticipantUserIds(req.body.participantUserIds);
  let coords = parsedGpx.points;

  if (parsedPayload.data.trimMeters > 0 && Number.isFinite(parsedPayload.data.trimMeters)) {
    coords = privacyCut(coords, parsedPayload.data.trimMeters);
  }

  coords = simplifyCoords(coords, 0.00004);
  coords = limitPoints(coords, config.maxSimplifiedPoints);

  if (coords.length < 2) {
    res.status(400).json({ message: 'Track becomes too short after processing' });
    return;
  }

  const routeId = uuidv4();
  const storedGpx = await storeGpx(routeId, req.file.buffer);
  const routeLineGeoJson = toLineString(coords);
  let createdRoute: Route | undefined;

  await updateData((data) => {
    const participantUserIds = Array.from(new Set([req.currentUser!.id, ...requestedParticipants]));
    const allParticipantsExist = participantUserIds.every((userId) => data.users.some((user) => user.id === userId && !user.disabled));
    if (!allParticipantsExist) {
      throw new Error('Some participant users do not exist');
    }

    createdRoute = {
      id: routeId,
      name: parsedPayload.data.routeName.trim(),
      createdBy: req.currentUser!.id,
      visibility: parsedPayload.data.routeVisibility,
      rating: parsedPayload.data.routeRating,
      participantUserIds,
      gpxStorage: storedGpx,
      routeLineGeoJson,
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

routesRouter.get('/:id/download', async (req, res) => {
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

  if (!route.gpxStorage) {
    res.status(404).json({ message: 'GPX file is not available for this route' });
    return;
  }

  const payload = await loadGpx(route.id, route.gpxStorage);
  res.setHeader('Content-Type', payload.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  res.send(payload.buffer);
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

routesRouter.patch('/:id/rating', async (req, res) => {
  const parsed = updateRatingSchema.safeParse(req.body);
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

    route.rating = parsed.data.rating;
    updatedRoute = route;
  });

  res.json({ route: updatedRoute });
});

routesRouter.patch('/:id/participants', async (req, res) => {
  const parsed = updateParticipantsSchema.safeParse(req.body);
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

    const uniqueParticipantIds = Array.from(new Set([route.createdBy, ...parsed.data.userIds]));
    const allParticipantsExist = uniqueParticipantIds.every((userId) => data.users.some((user) => user.id === userId && !user.disabled));
    if (!allParticipantsExist) {
      throw new Error('Some participant users do not exist');
    }

    route.participantUserIds = uniqueParticipantIds;
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
