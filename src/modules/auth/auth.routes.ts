import type { Request, Response } from 'express';

import type { ApiRouter } from '../../lib/api-router.js';
import {
  createAuthRateLimiter,
  createPasswordResetRateLimiter,
} from '../../middleware/rate-limit.js';
import { verifyOrigin } from '../../middleware/verify-origin.js';
import {
  authResponseSchema,
  forgotPasswordBodySchema,
  googleBodySchema,
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from './auth.schemas.js';
import * as authService from './auth.service.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './cookies.js';

const clientMeta = (req: Request): authService.ClientMeta => ({
  userAgent: req.get('user-agent'),
  ip: req.ip,
});

/** Puts the refresh token in the cookie and returns the JSON-safe part. */
function respondWithAuth(res: Response, result: authService.AuthResult) {
  const { refreshToken, refreshTokenExpiresAt, ...body } = result;
  setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);
  return body;
}

export function registerAuthRoutes(api: ApiRouter) {
  const authLimiter = createAuthRateLimiter();
  const resetLimiter = createPasswordResetRateLimiter();
  const tags = ['Auth'];

  api.route({
    method: 'post',
    path: '/auth/register',
    tags,
    summary: 'Create an account with email and password',
    middleware: [authLimiter],
    request: { body: registerBodySchema },
    status: 201,
    response: authResponseSchema,
    errors: [409, 429],
    handler: async ({ req, res, body }) =>
      respondWithAuth(res, await authService.register(body, clientMeta(req))),
  });

  api.route({
    method: 'post',
    path: '/auth/login',
    tags,
    summary: 'Log in with email and password',
    middleware: [authLimiter],
    request: { body: loginBodySchema },
    response: authResponseSchema,
    errors: [401, 429],
    handler: async ({ req, res, body }) =>
      respondWithAuth(res, await authService.login(body, clientMeta(req))),
  });

  api.route({
    method: 'post',
    path: '/auth/google',
    tags,
    summary: 'Log in or sign up with a Google ID token',
    description:
      'Send the `credential` returned by Google Identity Services. Accounts are matched by Google id, then linked by verified email.',
    middleware: [authLimiter],
    request: { body: googleBodySchema },
    response: authResponseSchema,
    errors: [401, 429, 503],
    handler: async ({ req, res, body }) =>
      respondWithAuth(
        res,
        await authService.loginWithGoogle(body.idToken, clientMeta(req))
      ),
  });

  api.route({
    method: 'post',
    path: '/auth/refresh',
    tags,
    summary: 'Get a new access token using the refresh cookie',
    description:
      'Rotates the refresh cookie. Call with `credentials: "include"`. Reusing an old refresh token revokes the whole session.',
    security: [{ refreshCookie: [] }],
    middleware: [verifyOrigin, authLimiter],
    response: authResponseSchema,
    errors: [401, 403, 429],
    handler: async ({ req, res }) => {
      try {
        return respondWithAuth(
          res,
          await authService.refresh(readRefreshCookie(req), clientMeta(req))
        );
      } catch (err) {
        clearRefreshCookie(res);
        throw err;
      }
    },
  });

  api.route({
    method: 'post',
    path: '/auth/logout',
    tags,
    summary: 'Revoke the current session and clear the refresh cookie',
    security: [{ refreshCookie: [] }],
    middleware: [verifyOrigin],
    errors: [403],
    handler: async ({ req, res }) => {
      await authService.logout(readRefreshCookie(req));
      clearRefreshCookie(res);
    },
  });

  api.route({
    method: 'post',
    path: '/auth/forgot-password',
    tags,
    summary: 'Email a password reset link',
    description:
      'Always returns 202 so the response does not reveal whether the email has an account.',
    middleware: [resetLimiter],
    request: { body: forgotPasswordBodySchema },
    status: 202,
    responseDescription: 'Accepted',
    errors: [429],
    handler: async ({ body }) => {
      await authService.requestPasswordReset(body.email);
    },
  });

  api.route({
    method: 'post',
    path: '/auth/reset-password',
    tags,
    summary: 'Set a new password using a reset token',
    description: 'Signs the user out of every session.',
    middleware: [authLimiter],
    request: { body: resetPasswordBodySchema },
    errors: [429],
    handler: async ({ body }) => {
      await authService.resetPassword(body);
    },
  });
}
