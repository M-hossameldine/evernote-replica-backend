import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

beforeAll(async () => {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) throw new Error('MONGO_TEST_URI is not set (see globalSetup)');

  await mongoose.connect(uri, { dbName: `test-${randomUUID()}` });
  // Unique/TTL indexes must exist before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map(collection => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
