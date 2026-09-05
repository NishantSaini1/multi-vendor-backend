import { Router, Request, Response } from 'express';
import { isDatabaseConnected } from '../config/database';
import { isRedisConnected } from '../config/redis';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const dbConnected = isDatabaseConnected();
  const redisConnected = await isRedisConnected();
  const healthy = dbConnected && redisConnected;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'healthy' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    redis: redisConnected ? 'connected' : 'disconnected',
  });
});

router.get('/database', (_req: Request, res: Response) => {
  const dbConnected = isDatabaseConnected();
  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    status: dbConnected ? 'healthy' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
  });
});

router.get('/redis', async (_req: Request, res: Response) => {
  const redisConnected = await isRedisConnected();
  res.status(redisConnected ? 200 : 503).json({
    success: redisConnected,
    status: redisConnected ? 'healthy' : 'degraded',
    redis: redisConnected ? 'connected' : 'disconnected',
  });
});

export default router;
