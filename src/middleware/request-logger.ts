import { randomUUID } from 'node:crypto';

import { pinoHttp } from 'pino-http';

import { logger } from '../lib/logger.js';

const SAFE_REQUEST_ID = /^[\w-]{1,128}$/;

/** Structured access logs with a request id that is echoed in `x-request-id`. */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: req => req.url === '/health' },
  serializers: {
    req: req => ({ id: req.id, method: req.method, url: req.url }),
    res: res => ({ statusCode: res.statusCode }),
  },
});
