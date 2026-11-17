import { ErrorCode } from './error-codes.js';

export type ErrorDetail = {
  /** Where the problem is: `body`, `query`, `params`, ... */
  location?: string;
  /** Dot-separated path to the offending field, e.g. `tags.2`. */
  path?: string;
  message: string;
};

type AppErrorOptions = {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  cause?: unknown;
};

/** An expected, client-facing error. Anything else is reported as a 500. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];

  constructor({ status, code, message, details, cause }: AppErrorOptions) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    return new AppError({ status: 400, code, message, details });
  }

  static unauthorized(
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
    message = 'Authentication required'
  ) {
    return new AppError({ status: 401, code, message });
  }

  static forbidden(code: ErrorCode, message: string) {
    return new AppError({ status: 403, code, message });
  }

  static notFound(code: ErrorCode, message: string) {
    return new AppError({ status: 404, code, message });
  }

  static conflict(code: ErrorCode, message: string) {
    return new AppError({ status: 409, code, message });
  }
}
