import express from 'express';
import { authRouter } from './routes/auth.routes';
import { extractRouter } from './routes/extract.routes';
import { healthRouter } from './routes/health.routes';
import { itineraryRouter } from './routes/itinerary.routes';
import { placesRouter } from './routes/places.routes';
import { routingRouter } from './routes/routing.routes';
import { transitRouter } from './routes/transit.routes';

export function createBackendApp() {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });
  app.options('*', (_req, res) => res.sendStatus(204));
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', extractRouter);
  app.use('/api', itineraryRouter);
  app.use('/api', placesRouter);
  app.use('/api', routingRouter);
  app.use('/api', transitRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'API_NOT_FOUND',
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  });
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message || 'Unexpected server error',
    });
  });

  return app;
}
