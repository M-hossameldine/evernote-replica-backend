import type { RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string };
  }
}

/** Requires a valid `Authorization: Bearer <access token>` header. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  const [scheme, token] = header?.split(' ') ?? [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw AppError.unauthorized(
      ErrorCode.UNAUTHENTICATED,
      'Missing bearer access token'
    );
  }

  req.auth = verifyAccessToken(token);
  next();
};
