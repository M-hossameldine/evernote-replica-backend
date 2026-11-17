import { z } from 'zod';

import type { ApiRouter } from '../../lib/api-router.js';
import {
  createNoteBodySchema,
  emptyTrashResponseSchema,
  listNotesQuerySchema,
  noteIdParamsSchema,
  noteSchema,
  toNoteDto,
  updateNoteBodySchema,
} from './note.schemas.js';
import * as notes from './note.service.js';

export function registerNoteRoutes(api: ApiRouter) {
  const tags = ['Notes'];

  api.route({
    method: 'get',
    path: '/notes',
    tags,
    summary: 'List notes',
    description:
      'Returns all matching notes (no pagination yet). Active notes are sorted by `updatedAt`, trash by `deletedAt`, newest first.',
    auth: true,
    request: { query: listNotesQuerySchema },
    response: z.array(noteSchema),
    handler: async ({ userId, query }) =>
      (await notes.listNotes(userId, query)).map(toNoteDto),
  });

  api.route({
    method: 'post',
    path: '/notes',
    tags,
    summary: 'Create a note',
    auth: true,
    request: { body: createNoteBodySchema },
    status: 201,
    response: noteSchema,
    handler: async ({ userId, body }) =>
      toNoteDto(await notes.createNote(userId, body)),
  });

  // Registered before `/notes/:id` so "trash" is never read as an id.
  api.route({
    method: 'delete',
    path: '/notes/trash',
    tags,
    summary: 'Empty the trash (permanently delete all trashed notes)',
    auth: true,
    response: emptyTrashResponseSchema,
    handler: ({ userId }) => notes.emptyTrash(userId),
  });

  api.route({
    method: 'get',
    path: '/notes/:id',
    tags,
    summary: 'Get a note',
    auth: true,
    request: { params: noteIdParamsSchema },
    response: noteSchema,
    errors: [404],
    handler: async ({ userId, params }) =>
      toNoteDto(await notes.getNote(userId, params.id)),
  });

  api.route({
    method: 'patch',
    path: '/notes/:id',
    tags,
    summary: 'Update a note',
    description: 'Only active notes can be edited.',
    auth: true,
    request: { params: noteIdParamsSchema, body: updateNoteBodySchema },
    response: noteSchema,
    errors: [404, 409],
    handler: async ({ userId, params, body }) =>
      toNoteDto(await notes.updateNote(userId, params.id, body)),
  });

  api.route({
    method: 'delete',
    path: '/notes/:id',
    tags,
    summary: 'Permanently delete a note',
    description: 'Only notes in trash can be deleted permanently.',
    auth: true,
    request: { params: noteIdParamsSchema },
    errors: [404, 409],
    handler: async ({ userId, params }) => {
      await notes.deleteNotePermanently(userId, params.id);
    },
  });

  api.route({
    method: 'post',
    path: '/notes/:id/trash',
    tags,
    summary: 'Move a note to trash',
    auth: true,
    request: { params: noteIdParamsSchema },
    response: noteSchema,
    errors: [404],
    handler: async ({ userId, params }) =>
      toNoteDto(await notes.moveToTrash(userId, params.id)),
  });

  api.route({
    method: 'post',
    path: '/notes/:id/restore',
    tags,
    summary: 'Restore a note from trash',
    auth: true,
    request: { params: noteIdParamsSchema },
    response: noteSchema,
    errors: [404],
    handler: async ({ userId, params }) =>
      toNoteDto(await notes.restoreFromTrash(userId, params.id)),
  });
}
