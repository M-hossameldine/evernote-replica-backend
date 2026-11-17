import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/errors/app-error.js';
import { ErrorCode } from '../src/errors/error-codes.js';
import { sendMail } from '../src/lib/mailer.js';
import { verifyGoogleIdToken } from '../src/modules/auth/google.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { NoteModel } from '../src/modules/notes/note.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import {
  ORIGIN,
  bearer,
  createTestClient,
  getRefreshCookie,
  getSetCookies,
  registerUser,
  type TestClient,
} from './helpers.js';

vi.mock('../src/lib/mailer.js', () => ({ sendMail: vi.fn() }));
vi.mock('../src/modules/auth/google.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

const mockedSendMail = vi.mocked(sendMail);
const mockedVerifyGoogle = vi.mocked(verifyGoogleIdToken);

let client: TestClient;

beforeEach(() => {
  client = createTestClient();
  vi.clearAllMocks();
});

describe('POST /auth/register', () => {
  it('creates the user, a welcome note, and a session', async () => {
    const res = await client.post('/api/v1/auth/register').send({
      name: '  Ada Lovelace ',
      email: ' Ada@Example.com ',
      password: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toBe(900);
    expect(res.body.data).not.toHaveProperty('refreshToken');

    const cookie = getSetCookies(res).find(c => c.startsWith('refresh_token='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const notes = await NoteModel.find({ userId: res.body.data.user.id });
    expect(notes.map(n => n.title)).toEqual(['Welcome to Evernote!']);
    expect(await SessionModel.countDocuments()).toBe(1);

    const stored = await UserModel.findOne({ email: 'ada@example.com' }).select(
      '+passwordHash'
    );
    expect(stored?.passwordHash).not.toBe('password123');
  });

  it('rejects a duplicate email with AUTH_EMAIL_IN_USE', async () => {
    await registerUser(client, { email: 'dup@example.com' });
    const res = await client.post('/api/v1/auth/register').send({
      name: 'Other',
      email: 'DUP@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_EMAIL_IN_USE);
  });

  it('returns the unified validation error shape', async () => {
    const res = await client
      .post('/api/v1/auth/register')
      .set('x-request-id', 'req-123')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBe('req-123');
    expect(res.body).toEqual({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        requestId: 'req-123',
        details: expect.arrayContaining([
          expect.objectContaining({ location: 'body', path: 'name' }),
          {
            location: 'body',
            path: 'email',
            message: 'Invalid email address',
          },
          {
            location: 'body',
            path: 'password',
            message: 'Password must be at least 8 characters',
          },
        ]),
      },
    });
  });

  it('returns INVALID_JSON for malformed bodies', async () => {
    const res = await client
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_JSON);
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials', async () => {
    const { credentials } = await registerUser(client);
    const res = await client.post('/api/v1/auth/login').send({
      email: credentials.email.toUpperCase(),
      password: credentials.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(getRefreshCookie(res)).toBeDefined();
  });

  it.each([
    ['wrong password', 'known', 'wrong-password'],
    ['unknown email', 'unknown', 'password123'],
  ])('rejects %s with the same error', async (_label, which, password) => {
    const { credentials } = await registerUser(client);
    const res = await client.post('/api/v1/auth/login').send({
      email: which === 'known' ? credentials.email : 'nobody@example.com',
      password,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      message: 'Incorrect email or password',
    });
  });
});

describe('access tokens', () => {
  it('rejects requests without a token', async () => {
    const res = await client.get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('reports expired tokens as TOKEN_EXPIRED', async () => {
    const { user } = await registerUser(client);
    const expired = jwt.sign(
      { type: 'access' },
      process.env.JWT_ACCESS_SECRET!,
      {
        subject: user.id,
        issuer: 'evernote-replica-api',
        audience: 'evernote-replica-web',
        expiresIn: -10,
      }
    );

    const res = await client.get('/api/v1/users/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });

  it('rejects tokens signed with another secret', async () => {
    const forged = jwt.sign({ type: 'access' }, 'x'.repeat(40), {
      subject: '665f1c2e8b3e4a0012345678',
    });
    const res = await client.get('/api/v1/users/me').set(bearer(forged));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const { refreshCookie } = await registerUser(client);

    const res = await client
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const rotated = getRefreshCookie(res);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(refreshCookie);

    const me = await client
      .get('/api/v1/users/me')
      .set(bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);
  });

  it('revokes the whole family when an old token is reused', async () => {
    const { refreshCookie } = await registerUser(client);

    const first = await client
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    const rotated = getRefreshCookie(first)!;

    const replay = await client
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
    expect(getSetCookies(replay).join()).toMatch(/refresh_token=;/);

    // The legitimately rotated token is now revoked too.
    const afterReuse = await client
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotated);
    expect(afterReuse.status).toBe(401);
  });

  it('rejects requests without a cookie', async () => {
    const res = await client.post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
  });

  it('rejects unknown origins (CSRF guard)', async () => {
    const { refreshCookie } = await registerUser(client);
    const res = await client
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.ORIGIN_NOT_ALLOWED);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { refreshCookie } = await registerUser(client);

    const res = await client
      .post('/api/v1/auth/logout')
      .set('Cookie', refreshCookie);
    expect(res.status).toBe(204);
    expect(getSetCookies(res).join()).toMatch(/refresh_token=;/);

    const refresh = await client
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(refresh.status).toBe(401);
  });

  it('succeeds without a cookie', async () => {
    const res = await client.post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('password reset', () => {
  const extractToken = () => {
    const mail = mockedSendMail.mock.calls.at(-1)![0];
    const url = new URL(mail.text.match(/https?:\/\/\S+/)![0]);
    return { mail, url, token: url.searchParams.get('token')! };
  };

  it('emails a reset link and lets the user set a new password', async () => {
    const { credentials, refreshCookie } = await registerUser(client);

    const forgot = await client
      .post('/api/v1/auth/forgot-password')
      .send({ email: credentials.email });
    expect(forgot.status).toBe(202);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);

    const { mail, url, token } = extractToken();
    expect(mail.to).toBe(credentials.email);
    expect(url.origin + url.pathname).toBe(
      'http://localhost:5173/auth/reset-password'
    );

    const reset = await client
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password' });
    expect(reset.status).toBe(204);

    // Old password no longer works, the new one does.
    const oldLogin = await client
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await client
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: 'brand-new-password' });
    expect(newLogin.status).toBe(200);

    // Existing sessions were revoked.
    const refresh = await client
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(refresh.status).toBe(401);

    // The token is single-use.
    const reuse = await client
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'another-password' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe(ErrorCode.AUTH_RESET_TOKEN_INVALID);
  });

  it('does not reveal whether an email exists', async () => {
    const res = await client
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(202);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', async () => {
    const { credentials } = await registerUser(client);
    await client
      .post('/api/v1/auth/forgot-password')
      .send({ email: credentials.email });
    const { token } = extractToken();

    await UserModel.updateOne(
      { email: credentials.email },
      { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1000) } }
    );

    const res = await client
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_RESET_TOKEN_INVALID);
  });
});

describe('POST /auth/google', () => {
  const profile = {
    googleId: 'google-123',
    email: 'Grace@Example.com',
    emailVerified: true,
    name: 'Grace Hopper',
    picture: 'https://example.com/grace.png',
  };

  it('creates a new account on first sign-in', async () => {
    mockedVerifyGoogle.mockResolvedValue(profile);

    const res = await client
      .post('/api/v1/auth/google')
      .send({ idToken: 'google-id-token' });

    expect(res.status).toBe(200);
    expect(mockedVerifyGoogle).toHaveBeenCalledWith(
      'google-id-token',
      process.env.GOOGLE_CLIENT_ID
    );
    expect(res.body.data.user).toMatchObject({
      email: 'grace@example.com',
      name: 'Grace Hopper',
      avatarUrl: profile.picture,
    });
    expect(getRefreshCookie(res)).toBeDefined();
    expect(await NoteModel.countDocuments()).toBe(1);

    // Second sign-in reuses the same account.
    const again = await client
      .post('/api/v1/auth/google')
      .send({ idToken: 'google-id-token' });
    expect(again.body.data.user.id).toBe(res.body.data.user.id);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('links Google to an existing password account with the same email', async () => {
    const { user, credentials } = await registerUser(client, {
      email: 'grace@example.com',
    });
    mockedVerifyGoogle.mockResolvedValue(profile);

    const res = await client
      .post('/api/v1/auth/google')
      .send({ idToken: 'google-id-token' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);

    // Password login still works.
    const login = await client.post('/api/v1/auth/login').send(credentials);
    expect(login.status).toBe(200);
  });

  it('rejects unverified Google emails', async () => {
    mockedVerifyGoogle.mockResolvedValue({ ...profile, emailVerified: false });
    const res = await client
      .post('/api/v1/auth/google')
      .send({ idToken: 'google-id-token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_GOOGLE_EMAIL_UNVERIFIED);
  });

  it('rejects invalid Google tokens', async () => {
    mockedVerifyGoogle.mockRejectedValue(
      new AppError({
        status: 401,
        code: ErrorCode.AUTH_GOOGLE_TOKEN_INVALID,
        message: 'Invalid Google credential',
      })
    );
    const res = await client
      .post('/api/v1/auth/google')
      .send({ idToken: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_GOOGLE_TOKEN_INVALID);
  });

  it('a Google-only account cannot log in with a password', async () => {
    mockedVerifyGoogle.mockResolvedValue(profile);
    await client.post('/api/v1/auth/google').send({ idToken: 'x' });

    const res = await client
      .post('/api/v1/auth/login')
      .send({ email: 'grace@example.com', password: 'anything-at-all' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
  });
});
