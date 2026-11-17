import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';

const rateLimitedError = () =>
  new AppError({
    status: 429,
    code: ErrorCode.RATE_LIMITED,
    message: 'Too many requests, please try again later',
  });

/**
 * Limiters are created per app instance so each test gets a fresh in-memory
 * store. For multiple Railway replicas, swap in a shared store (e.g. Redis).
 */
export function createAuthRateLimiter() {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(rateLimitedError()),
  });
}

/** Stricter limiter for endpoints that send email. */
export function createPasswordResetRateLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: env.PASSWORD_RESET_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(rateLimitedError()),
  });
}
