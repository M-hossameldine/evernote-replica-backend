import {
  OpenApiGeneratorV31,
  type OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';

export function generateOpenApiDocument(registry: OpenAPIRegistry) {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Evernote Replica API',
      version: '1.0.0',
      description: [
        'REST API for the Evernote Replica app.',
        '',
        '**Auth:** `POST /auth/login` (or register / google) returns a short-lived `accessToken` and sets an httpOnly `refresh_token` cookie.',
        'Send the access token as `Authorization: Bearer <token>`. When a request fails with `TOKEN_EXPIRED`, call `POST /auth/refresh` with credentials included.',
        '',
        '**Responses:** success bodies are `{ "data": ... }`; errors are `{ "error": { code, message, details?, requestId } }`.',
      ].join('\n'),
    },
    servers: [{ url: '/' }],
    tags: [
      {
        name: 'Auth',
        description: 'Sign up, log in, sessions, password reset',
      },
      { name: 'Users', description: 'Current user profile' },
      { name: 'Notes', description: 'Notes, trash, tags and search' },
    ],
  });
}
