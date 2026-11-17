import { z } from 'zod';

import { ErrorCode } from './error-codes.js';

/**
 * The single error envelope returned by every endpoint:
 *
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Request validation failed",
 *     "details": [{ "location": "body", "path": "email", "message": "Invalid email address" }],
 *     "requestId": "6f1c..."
 *   }
 * }
 */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
      message: z.string(),
      details: z
        .array(
          z.object({
            location: z.string().optional(),
            path: z.string().optional(),
            message: z.string(),
          })
        )
        .optional(),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
