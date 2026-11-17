import type { RequestHandler } from 'express';

import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';

/**
 * CSRF guard for endpoints authenticated by the refresh cookie.
 *
 * The refresh cookie is `SameSite=None` in production (the SPA and the API live
 * on different sites), so browsers attach it to cross-site requests. Browsers
 * always send `Origin` on cross-origin POSTs, so rejecting unknown origins
 * stops a malicious page from rotating or revoking a victim's session.
 * Requests without `Origin` (curl, server-to-server) are allowed.
 */
export const verifyOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');

  if (origin && !env.CORS_ORIGINS.includes(origin)) {
    throw AppError.forbidden(
      ErrorCode.ORIGIN_NOT_ALLOWED,
      'Request origin is not allowed'
    );
  }

  next();
};
