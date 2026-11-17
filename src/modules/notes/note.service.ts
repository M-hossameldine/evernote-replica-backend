import type { QueryFilter } from 'mongoose';

import { AppError } from '../../errors/app-error.js';
import { ErrorCode } from '../../errors/error-codes.js';
import {
  NoteModel,
  type NoteDocument,
  type NoteFields,
  type NoteStatus,
} from './note.model.js';

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const uniqueTags = (tags: string[]) => [...new Set(tags)];

const noteNotFound = () =>
  AppError.notFound(ErrorCode.NOTE_NOT_FOUND, 'Note not found');

/** Notes of other users are reported as "not found", never "forbidden". */
async function findOwnedNote(userId: string, noteId: string) {
  const note = await NoteModel.findOne({ _id: noteId, userId });
  if (!note) throw noteNotFound();
  return note;
}

export async function listNotes(
  userId: string,
  filters: { status: NoteStatus; tag?: string; q?: string }
): Promise<NoteDocument[]> {
  const query: QueryFilter<NoteFields> = { userId, status: filters.status };

  if (filters.tag) query.tags = filters.tag;

  if (filters.q) {
    // Fine for per-user note counts. For large datasets, move to Atlas Search.
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    query.$or = [{ title: pattern }, { text: pattern }];
  }

  const sortField = filters.status === 'trash' ? 'deletedAt' : 'updatedAt';
  return NoteModel.find(query).sort({ [sortField]: -1, _id: -1 });
}

export function getNote(userId: string, noteId: string) {
  return findOwnedNote(userId, noteId);
}

export function createNote(
  userId: string,
  input: { title: string; text: string; tags: string[] }
) {
  return NoteModel.create({ ...input, tags: uniqueTags(input.tags), userId });
}

export function createWelcomeNote(userId: string) {
  return createNote(userId, {
    title: 'Welcome to Evernote!',
    text: 'Start creating your notes...',
    tags: [],
  });
}

export async function updateNote(
  userId: string,
  noteId: string,
  input: { title?: string; text?: string; tags?: string[] }
) {
  const note = await findOwnedNote(userId, noteId);

  if (note.status === 'trash') {
    throw AppError.conflict(
      ErrorCode.NOTE_IN_TRASH,
      'Restore the note from trash before editing it'
    );
  }

  if (input.title !== undefined) note.title = input.title;
  if (input.text !== undefined) note.text = input.text;
  if (input.tags !== undefined) note.tags = uniqueTags(input.tags);

  return note.save();
}

/** Soft delete. Idempotent: trashing a trashed note keeps its `deletedAt`. */
export async function moveToTrash(userId: string, noteId: string) {
  const note = await findOwnedNote(userId, noteId);
  if (note.status === 'trash') return note;

  note.status = 'trash';
  note.deletedAt = new Date();
  return note.save();
}

export async function restoreFromTrash(userId: string, noteId: string) {
  const note = await findOwnedNote(userId, noteId);
  if (note.status === 'active') return note;

  note.status = 'active';
  note.deletedAt = null;
  return note.save();
}

/** Permanent delete, only allowed for notes already in trash. */
export async function deleteNotePermanently(userId: string, noteId: string) {
  const note = await findOwnedNote(userId, noteId);

  if (note.status !== 'trash') {
    throw AppError.conflict(
      ErrorCode.NOTE_NOT_IN_TRASH,
      'Move the note to trash before deleting it permanently'
    );
  }

  await note.deleteOne();
}

export async function emptyTrash(userId: string) {
  const { deletedCount } = await NoteModel.deleteMany({
    userId,
    status: 'trash',
  });
  return { deletedCount };
}
