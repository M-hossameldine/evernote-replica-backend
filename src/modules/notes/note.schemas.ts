import { isValidObjectId } from 'mongoose';
import { z } from 'zod';

import { NOTE_STATUSES, type NoteDocument } from './note.model.js';

export const objectIdSchema = z
  .string()
  .refine(value => isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value), {
    message: 'Invalid id',
  })
  .meta({ example: '665f1c2e8b3e4a0012345678' });

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Tag cannot be empty')
  .max(32, 'Tag must be at most 32 characters');

const tagsSchema = z
  .array(tagSchema)
  .max(20, 'A note can have at most 20 tags')
  .meta({ example: ['work', 'ideas'] });

const titleSchema = z.string().max(500, 'Title must be at most 500 characters');
const textSchema = z
  .string()
  .max(500_000, 'Note text must be at most 500,000 characters');

export const noteStatusSchema = z.enum(NOTE_STATUSES);

export const noteSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    status: noteStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Note' });

export type NoteDto = z.infer<typeof noteSchema>;

export const noteIdParamsSchema = z.object({ id: objectIdSchema });

export const listNotesQuerySchema = z.object({
  status: noteStatusSchema.default('active'),
  tag: tagSchema.optional().meta({ description: 'Only notes with this tag' }),
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: 'Case-insensitive search in title and text' }),
});

export const createNoteBodySchema = z
  .object({
    title: titleSchema.default(''),
    text: textSchema.default(''),
    tags: tagsSchema.default([]),
  })
  .meta({ id: 'CreateNoteRequest' });

export const updateNoteBodySchema = z
  .object({
    title: titleSchema.optional(),
    text: textSchema.optional(),
    tags: tagsSchema.optional(),
  })
  .refine(body => Object.values(body).some(value => value !== undefined), {
    message: 'Provide at least one of: title, text, tags',
  })
  .meta({ id: 'UpdateNoteRequest' });

export const emptyTrashResponseSchema = z.object({
  deletedCount: z.number().int(),
});

export function toNoteDto(note: NoteDocument): NoteDto {
  return {
    id: note.id as string,
    title: note.title,
    text: note.text,
    tags: note.tags,
    status: note.status,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
  };
}
