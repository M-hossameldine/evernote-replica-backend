import { describe, expect, it, vi } from 'vitest';

// Must run before `env` is parsed (vi.hoisted runs before imports).
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '3';
  process.env.PASSWORD_RESET_RATE_LIMIT_MAX = '2';
});

vi.mock('../src/lib/mailer.js', () => ({ sendMail: vi.fn() }));

const { ErrorCode } = await import('../src/errors/error-codes.js');
const { createTestClient } = await import('./helpers.js');

describe('rate limiting', () => {
  it('limits login attempts', async () => {
    const client = createTestClient();
    const attempt = () =>
      client
        .post('/api/v1/auth/login')
        .send({ email: 'a@example.com', password: 'wrong-password' });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt()).status).toBe(401);
    }

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(limited.headers['ratelimit-policy']).toBeDefined();
  });

  it('limits password reset emails more strictly', async () => {
    const client = createTestClient();
    const attempt = () =>
      client
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'a@example.com' });

    expect((await attempt()).status).toBe(202);
    expect((await attempt()).status).toBe(202);
    expect((await attempt()).status).toBe(429);
  });

  it('does not rate limit regular API routes', async () => {
    const client = createTestClient();
    for (let i = 0; i < 5; i += 1) {
      expect((await client.get('/api/v1/notes')).status).toBe(401);
    }
  });
});
