import mongoose from 'mongoose';

import { logger } from './logger.js';

let listenersAttached = false;
let closingIntentionally = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('disconnected', () => {
    if (closingIntentionally) logger.debug('MongoDB connection closed');
    else logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () =>
    logger.info('MongoDB reconnected')
  );
  mongoose.connection.on('error', err =>
    logger.error({ err }, 'MongoDB connection error')
  );
}

export async function connectDatabase(options: {
  uri: string;
  /** Takes precedence over a database name embedded in the URI. */
  dbName?: string;
}): Promise<void> {
  attachConnectionListeners();
  closingIntentionally = false;

  await mongoose.connect(options.uri, {
    dbName: options.dbName,
    serverSelectionTimeoutMS: 10_000,
    appName: 'evernote-replica-api',
  });

  logger.info(
    { host: mongoose.connection.host, db: mongoose.connection.name },
    'MongoDB connected'
  );
}

export async function disconnectDatabase(): Promise<void> {
  closingIntentionally = true;
  await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

/** Maps the usual Atlas connection failures to an actionable hint. */
export function describeConnectionError(err: unknown): string | undefined {
  const message = err instanceof Error ? `${err.name} ${err.message}` : '';

  if (/querySrv|ENOTFOUND|EREFUSED|ECONNREFUSED.*_mongodb/i.test(message)) {
    return 'DNS lookup of the Atlas host failed. Check the cluster host in MONGODB_URI; if it is correct, your DNS may not support SRV records: set your network DNS to 8.8.8.8 / 1.1.1.1, or use the standard (non-SRV) connection string from Atlas.';
  }
  if (/bad auth|authentication failed/i.test(message)) {
    return 'Atlas rejected the username/password. Check the database user (Database Access) and the password in MONGODB_URI (special characters must be URL-encoded).';
  }
  if (
    /whitelist|IP.*(access|allow)|ReplicaSetNoPrimary|Server selection timed out/i.test(
      message
    )
  ) {
    return 'Could not reach the cluster. Make sure Network Access in Atlas allows your IP (or 0.0.0.0/0), that the cluster is not paused, and that your network allows outbound traffic on port 27017.';
  }
  return undefined;
}

/** Removes credentials from a connection string so it can be logged. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, '//<credentials>@');
}
