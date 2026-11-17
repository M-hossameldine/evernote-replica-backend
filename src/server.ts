import { createApp } from './app.js';
import { env } from './config/env.js';
import {
  connectDatabase,
  describeConnectionError,
  disconnectDatabase,
} from './lib/db.js';
import { logger } from './lib/logger.js';

process.on('unhandledRejection', reason => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});

try {
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
} catch (err) {
  logger.fatal(
    { err, hint: describeConnectionError(err) },
    'Could not connect to MongoDB'
  );
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, docs: env.DOCS_ENABLED ? '/docs' : 'disabled' },
    'API listening'
  );
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    await disconnectDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
