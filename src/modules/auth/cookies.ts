import type { CookieOptions, Request, Response } from 'express';

import { env } from '../../config/env.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';
/** The cookie is only sent to auth endpoints, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date
) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value ? value : undefined;
}
