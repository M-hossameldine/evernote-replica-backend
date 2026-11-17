import {
  OpenAPIRegistry,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';

import { AppError, type ErrorDetail } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { errorResponseSchema } from '../errors/error-response.js';
import { authenticate } from '../middleware/authenticate.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type ObjectSchema = z.ZodObject;
type Output<T> = T extends z.ZodType ? z.output<T> : undefined;

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid request',
  401: 'Not authenticated',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict with the current state of the resource',
  413: 'Payload too large',
  429: 'Too many requests',
  500: 'Unexpected server error',
  503: 'Service unavailable',
};

export type HandlerContext<
  B extends z.ZodType | undefined,
  Q extends ObjectSchema | undefined,
  P extends ObjectSchema | undefined,
  A extends boolean,
> = {
  req: Request;
  res: Response;
  body: Output<B>;
  query: Output<Q>;
  params: Output<P>;
  /** The authenticated user's id (only on routes with `auth: true`). */
  userId: A extends true ? string : undefined;
};

export type RouteDefinition<
  B extends z.ZodType | undefined,
  Q extends ObjectSchema | undefined,
  P extends ObjectSchema | undefined,
  A extends boolean,
> = {
  method: Method;
  /** Express-style path relative to the API base, e.g. `/notes/:id`. */
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  /** Require a bearer access token. */
  auth?: A;
  /** Documented security schemes (defaults to bearer when `auth` is set). */
  security?: RouteConfig['security'];
  middleware?: RequestHandler[];
  request?: { body?: B; query?: Q; params?: P };
  /** Success status. Defaults to 200, or 204 when there is no `response`. */
  status?: number;
  /** Schema of `data` in the `{ data }` success envelope. */
  response?: z.ZodType;
  responseDescription?: string;
  /** Extra documented error statuses (400/401/500 are added automatically). */
  errors?: number[];
  handler: (ctx: HandlerContext<B, Q, P, A>) => unknown;
};

function toOpenApiPath(path: string) {
  return path.replace(/:(\w+)/g, '{$1}');
}

function parsePart(
  schema: z.ZodType | undefined,
  value: unknown,
  location: string,
  details: ErrorDetail[]
) {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    details.push({
      location,
      path: issue.path.length ? issue.path.join('.') : undefined,
      message: issue.message,
    });
  }
  return undefined;
}

/**
 * Wraps an Express router so every route is validated with Zod and documented
 * in OpenAPI from the same definition — the docs can't drift from the code.
 *
 * Success responses use the `{ data }` envelope; errors use `ErrorResponse`.
 */
export class ApiRouter {
  readonly router = Router();
  readonly registry = new OpenAPIRegistry();
  constructor(private readonly basePath: string) {
    // Schemas carrying `.meta({ id })` become reusable components on their own.
    this.registry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    this.registry.registerComponent('securitySchemes', 'refreshCookie', {
      type: 'apiKey',
      in: 'cookie',
      name: 'refresh_token',
    });
  }

  route<
    B extends z.ZodType | undefined = undefined,
    Q extends ObjectSchema | undefined = undefined,
    P extends ObjectSchema | undefined = undefined,
    A extends boolean = false,
  >(def: RouteDefinition<B, Q, P, A>): this {
    const successStatus = def.status ?? (def.response ? 200 : 204);

    const handler: RequestHandler = async (req, res) => {
      const details: ErrorDetail[] = [];
      const body = parsePart(
        def.request?.body,
        req.body ?? {},
        'body',
        details
      );
      const query = parsePart(def.request?.query, req.query, 'query', details);
      const params = parsePart(
        def.request?.params,
        req.params,
        'params',
        details
      );

      if (details.length) {
        throw AppError.badRequest(
          ErrorCode.VALIDATION_ERROR,
          'Request validation failed',
          details
        );
      }

      const data = await def.handler({
        req,
        res,
        body,
        query,
        params,
        userId: req.auth?.userId,
      } as HandlerContext<B, Q, P, A>);

      if (def.response) {
        res.status(successStatus).json({ data });
      } else {
        res.status(successStatus).end();
      }
    };

    this.router[def.method](
      def.path,
      ...(def.auth ? [authenticate] : []),
      ...(def.middleware ?? []),
      handler
    );

    this.document(def, successStatus);
    return this;
  }

  private document<
    B extends z.ZodType | undefined,
    Q extends ObjectSchema | undefined,
    P extends ObjectSchema | undefined,
    A extends boolean,
  >(def: RouteDefinition<B, Q, P, A>, successStatus: number) {
    const errorStatuses = new Set<number>(def.errors ?? []);
    if (def.request?.body || def.request?.query || def.request?.params) {
      errorStatuses.add(400);
    }
    if (def.auth) errorStatuses.add(401);
    errorStatuses.add(500);

    const responses: RouteConfig['responses'] = {
      [successStatus]: def.response
        ? {
            description: def.responseDescription ?? 'Success',
            content: {
              'application/json': {
                schema: z.object({ data: def.response }),
              },
            },
          }
        : { description: def.responseDescription ?? 'No content' },
    };

    for (const status of [...errorStatuses].sort((a, b) => a - b)) {
      responses[status] = {
        description: ERROR_DESCRIPTIONS[status] ?? 'Error',
        content: { 'application/json': { schema: errorResponseSchema } },
      };
    }

    this.registry.registerPath({
      method: def.method,
      path: `${this.basePath}${toOpenApiPath(def.path)}`,
      summary: def.summary,
      description: def.description,
      tags: def.tags,
      security: def.security ?? (def.auth ? [{ bearerAuth: [] }] : undefined),
      request: {
        body: def.request?.body
          ? {
              required: true,
              content: { 'application/json': { schema: def.request.body } },
            }
          : undefined,
        query: def.request?.query,
        params: def.request?.params,
      },
      responses,
    });
  }
}
