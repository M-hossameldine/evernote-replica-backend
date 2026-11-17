import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // The first run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://set-by-test-setup',
      APP_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
      BCRYPT_ROUNDS: '4',
      GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
      AUTH_RATE_LIMIT_MAX: '1000',
      PASSWORD_RESET_RATE_LIMIT_MAX: '1000',
    },
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
