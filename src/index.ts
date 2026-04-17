import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config.js';
import { getDataProvider, getDataWriteTarget, initDataStore } from './services/dataStore.js';
import { authRouter } from './routes/authRoutes.js';
import { routesRouter } from './routes/routesRoutes.js';
import { activitiesRouter } from './routes/activitiesRoutes.js';
import { usersRouter } from './routes/usersRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

async function bootstrap(): Promise<void> {
  validateConfig();
  await initDataStore();

  const app = express();
  app.use(cors());
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/routes', routesRouter);
  app.use('/api/activities', activitiesRouter);

  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`Server started on http://localhost:${config.port}`);
    console.log(`Data provider: ${getDataProvider()}`);
    console.log(`Data write target: ${getDataWriteTarget()}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap server', error);
  process.exit(1);
});
