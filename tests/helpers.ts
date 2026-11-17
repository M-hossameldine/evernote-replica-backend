import type { Response } from 'supertest';
import request from 'supertest';

import { createApp } from '../src/app.js';

export const ORIGIN = 'http://localhost:5173';

export function createTestClient() {
  return request(createApp());
}

export type TestClient = ReturnType<typeof createTestClient>;

let counter = 0;

export async function registerUser(
  client: TestClient,
  overrides: Partial<{ name: string; email: string; password: string }> = {}
) {
  counter += 1;
  const credentials = {
    name: 'Test User',
    email: `user${counter}@example.com`,
    password: 'password123',
    ...overrides,
  };

  const res = await client.post('/api/v1/auth/register').send(credentials);
  if (res.status !== 201) {
    throw new Error(
      `register failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  return {
    credentials,
    user: res.body.data.user as { id: string; email: string; name: string },
    accessToken: res.body.data.accessToken as string,
    refreshCookie: getRefreshCookie(res)!,
  };
}

/** Returns `refresh_token=<value>` from Set-Cookie, ready for a Cookie header. */
export function getRefreshCookie(res: Response): string | undefined {
  return getSetCookies(res)
    .find(cookie => cookie.startsWith('refresh_token='))
    ?.split(';')[0];
}

export function getSetCookies(res: Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  if (!header) return [];
  return Array.isArray(header) ? header : [String(header)];
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
