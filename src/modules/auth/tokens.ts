import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { ErrorCode } from '../../errors/error-codes.js';

const ISSUER = 'evernote-replica-api';
const AUDIENCE = 'evernote-replica-web';

export function signAccessToken(userId: string) {
  const token = jwt.sign({ type: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
  return { token, expiresIn: env.JWT_ACCESS_TTL_SECONDS };
}

export function verifyAccessToken(token: string): { userId: string } {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload === 'string' ||
      payload.type !== 'access' ||
      !payload.sub
    ) {
      throw new Error('Unexpected token payload');
    }
    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized(
        ErrorCode.TOKEN_EXPIRED,
        'Access token has expired'
      );
    }
    throw AppError.unauthorized(
      ErrorCode.TOKEN_INVALID,
      'Invalid access token'
    );
  }
}

/** A high-entropy opaque token (refresh / password reset). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Opaque tokens are stored hashed so a database leak doesn't leak sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
