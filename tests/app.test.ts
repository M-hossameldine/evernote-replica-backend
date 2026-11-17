import { beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/errors/error-codes.js';
import {
  ORIGIN,
  bearer,
  createTestClient,
  registerUser,
  type TestClient,
} from './helpers.js';

let client: TestClient;

beforeEach(() => {
  client = createTestClient();
});

describe('app', () => {
  it('reports health', async () => {
    const res = await client.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('returns ROUTE_NOT_FOUND for unknown routes', async () => {
    const res = await client.get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCode.ROUTE_NOT_FOUND);
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('allows credentialed CORS only for configured origins', async () => {
    const allowed = await client.get('/health').set('Origin', ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await client
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves an OpenAPI document covering every route', async () => {
    const res = await client.get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/google',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/auth/forgot-password',
        '/api/v1/auth/reset-password',
        '/api/v1/users/me',
        '/api/v1/notes',
        '/api/v1/notes/trash',
        '/api/v1/notes/{id}',
        '/api/v1/notes/{id}/trash',
        '/api/v1/notes/{id}/restore',
      ])
    );
    expect(res.body.components.schemas).toHaveProperty('ErrorResponse');
    expect(res.body.components.schemas).toHaveProperty('Note');
  });

  it('serves Swagger UI', async () => {
    const res = await client.get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});

describe('users', () => {
  it('gets and updates the current user', async () => {
    const { accessToken, user } = await registerUser(client);

    const me = await client.get('/api/v1/users/me').set(bearer(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ id: user.id, email: user.email });

    const updated = await client
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ name: '  New Name ' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('New Name');
  });
});
