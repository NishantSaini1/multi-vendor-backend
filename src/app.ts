import express, { Application, Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { corsOptions } from './config/corsWhitelist';
import { logger } from './utils/logger';
import { swaggerSpec } from './docs/swagger';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { generalRateLimiter } from './middleware/rateLimiter.middleware';

const app: Application = express();

// Render terminates TLS at a proxy; trust its X-Forwarded-For so req.ip (and
// therefore per-client rate limiting) is the caller, not the proxy.
if (env.isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(
  express.json({
    limit: '2mb',
    // Razorpay webhook signature verification needs the exact raw bytes the
    // signature was computed over — capture them here rather than adding a
    // separate raw-body parser ahead of just that one route.
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(mongoSanitize());
app.use(hpp());

if (!env.isTest) {
  app.use(
    morgan(env.isDevelopment ? 'dev' : 'combined', {
      stream: { write: (message: string) => logger.info(message.trim()) },
    }),
  );
}

app.use(generalRateLimiter);

app.use(`/api/${env.API_VERSION}`, apiRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
