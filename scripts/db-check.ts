/**
 * Verifies the MongoDB connection from `.env`, builds every model's indexes,
 * and prints a short report. Usage: `npm run db:check`
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import {
  connectDatabase,
  describeConnectionError,
  disconnectDatabase,
  redactMongoUri,
} from '../src/lib/db.js';
// Importing the models registers them with Mongoose.
import '../src/modules/auth/session.model.js';
import '../src/modules/notes/note.model.js';
import '../src/modules/users/user.model.js';

const log = (message = '') => process.stdout.write(`${message}\n`);

async function main() {
  log(`Connecting to ${redactMongoUri(env.MONGODB_URI)}`);
  const started = Date.now();

  try {
    await connectDatabase({
      uri: env.MONGODB_URI,
      dbName: env.MONGODB_DB_NAME,
    });
  } catch (err) {
    log(`\n✗ Connection failed: ${(err as Error).message}`);
    const hint = describeConnectionError(err);
    if (hint) log(`  Hint: ${hint}`);
    process.exitCode = 1;
    return;
  }

  const db = mongoose.connection.db!;
  await db.admin().ping();
  log(`✓ Connected in ${Date.now() - started} ms`);
  log(`  Host:     ${mongoose.connection.host}`);
  log(`  Database: ${db.databaseName}`);

  if (db.databaseName === 'test') {
    log(
      '  ⚠ Using the default "test" database. Set MONGODB_DB_NAME in .env (e.g. evernote-replica-dev).'
    );
  }

  log('\nIndexes (created if missing):');
  for (const model of Object.values(mongoose.models)) {
    await model.init();
    await model.createIndexes();
    const [indexes, count] = await Promise.all([
      model.collection.indexes(),
      model.estimatedDocumentCount(),
    ]);
    log(`  ${model.collection.collectionName} (${count} documents)`);
    for (const index of indexes) {
      const flags = [
        index.unique && 'unique',
        index.sparse && 'sparse',
        index.expireAfterSeconds !== undefined && 'ttl',
      ].filter(Boolean);
      log(
        `    - ${JSON.stringify(index.key)}${flags.length ? ` [${flags.join(', ')}]` : ''}`
      );
    }
  }

  log('\n✓ Database is ready');
}

try {
  await main();
} finally {
  await disconnectDatabase();
}
