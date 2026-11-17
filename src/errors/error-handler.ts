import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError } from './app-error.js';
import { ErrorCode } from './error-codes.js';
import type { ErrorResponse } from './error-response.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    AppError.notFound(
      ErrorCode.ROUTE_NOT_FOUND,
      `Route ${req.method} ${req.path} not found`
    )
  );
};

type BodyParserError = Error & { type?: string; status?: number };

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const parserError = err as BodyParserError;
  if (parserError?.type === 'entity.parse.failed') {
    return AppError.badRequest(
      ErrorCode.INVALID_JSON,
      'Request body is not valid JSON'
    );
  }
  if (parserError?.type === 'entity.too.large') {
    return new AppError({
      status: 413,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'Request body is too large',
    });
  }
  if ((err as { code?: number })?.code === 11000) {
    return AppError.conflict(ErrorCode.CONFLICT, 'Resource already exists');
  }

  return new AppError({
    status: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Something went wrong',
    cause: err,
  });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = toAppError(err);

  if (appError.status >= 500) {
    // pino-http picks this up and logs the original error with the request.
    res.err = err instanceof Error ? err : new Error(String(err));
  }

  const body: ErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details?.length ? { details: appError.details } : {}),
      requestId: req.id ? String(req.id) : undefined,
    },
  };

  res.status(appError.status).json(body);
};
