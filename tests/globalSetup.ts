import { MongoMemoryServer } from 'mongodb-memory-server';

/** One in-memory MongoDB for the whole run; each test file uses its own db. */
export default async function globalSetup() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_TEST_URI = mongo.getUri();

  return async () => {
    await mongo.stop();
  };
}
