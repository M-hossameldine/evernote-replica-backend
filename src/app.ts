import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env.js';
import { generateOpenApiDocument } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './errors/error-handler.js';
import { ApiRouter } from './lib/api-router.js';
import { isDatabaseConnected } from './lib/db.js';
import { requestLogger } from './middleware/request-logger.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerNoteRoutes } from './modules/notes/note.routes.js';
import { registerUserRoutes } from './modules/users/user.routes.js';

export const API_BASE_PATH = '/api/v1';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      exposedHeaders: ['x-request-id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    })
  );

  app.get('/health', (_req, res) => {
    const database = isDatabaseConnected() ? 'up' : 'down';
    res
      .status(database === 'up' ? 200 : 503)
      .json({ status: database === 'up' ? 'ok' : 'degraded', database });
  });

  const api = new ApiRouter(API_BASE_PATH);
  registerAuthRoutes(api);
  registerUserRoutes(api);
  registerNoteRoutes(api);

  if (env.DOCS_ENABLED) {
    const document = generateOpenApiDocument(api.registry);
    app.get('/openapi.json', (_req, res) => {
      res.json(document);
    });
    // Mounted before helmet: Swagger UI needs a looser CSP than the API.
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(document, {
        customSiteTitle: 'Evernote Replica API',
        swaggerOptions: { persistAuthorization: true },
      })
    );
  }

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(API_BASE_PATH, api.router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
