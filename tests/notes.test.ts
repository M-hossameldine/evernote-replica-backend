import { beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/errors/error-codes.js';
import {
  bearer,
  createTestClient,
  registerUser,
  type TestClient,
} from './helpers.js';

let client: TestClient;
let auth: { Authorization: string };

const createNote = async (
  body: Partial<{ title: string; text: string; tags: string[] }> = {}
) => {
  const res = await client.post('/api/v1/notes').set(auth).send(body);
  expect(res.status).toBe(201);
  return res.body.data as {
    id: string;
    title: string;
    text: string;
    tags: string[];
    status: string;
    deletedAt: string | null;
  };
};

const listNotes = async (query: Record<string, string> = {}) => {
  const res = await client.get('/api/v1/notes').query(query).set(auth);
  expect(res.status).toBe(200);
  return res.body.data as Array<{ id: string; title: string }>;
};

beforeEach(async () => {
  client = createTestClient();
  const { accessToken } = await registerUser(client);
  auth = bearer(accessToken);
});

describe('notes CRUD', () => {
  it('lists the welcome note for a new user', async () => {
    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: 'Welcome to Evernote!',
      status: 'active',
      tags: [],
      deletedAt: null,
    });
  });

  it('creates a note with defaults', async () => {
    const note = await createNote();
    expect(note).toMatchObject({
      title: '',
      text: '',
      tags: [],
      status: 'active',
      deletedAt: null,
    });
  });

  it('normalizes and de-duplicates tags', async () => {
    const note = await createNote({ tags: [' Work ', 'work', 'Ideas'] });
    expect(note.tags).toEqual(['work', 'ideas']);
  });

  it('gets, updates, and sorts by last update', async () => {
    const first = await createNote({ title: 'First' });
    await createNote({ title: 'Second' });

    const update = await client
      .patch(`/api/v1/notes/${first.id}`)
      .set(auth)
      .send({ text: 'Updated body' });
    expect(update.status).toBe(200);
    expect(update.body.data).toMatchObject({
      title: 'First',
      text: 'Updated body',
    });

    const fetched = await client.get(`/api/v1/notes/${first.id}`).set(auth);
    expect(fetched.body.data.text).toBe('Updated body');

    const titles = (await listNotes()).map(n => n.title);
    expect(titles[0]).toBe('First');
  });

  it('rejects empty updates', async () => {
    const note = await createNote();
    const res = await client
      .patch(`/api/v1/notes/${note.id}`)
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('validates note ids', async () => {
    const res = await client.get('/api/v1/notes/not-an-id').set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({
      location: 'params',
      path: 'id',
    });
  });

  it('returns 404 for missing notes', async () => {
    const res = await client
      .get('/api/v1/notes/665f1c2e8b3e4a0012345678')
      .set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCode.NOTE_NOT_FOUND);
  });

  it("hides other users' notes", async () => {
    const note = await createNote({ title: 'Private' });
    const other = await registerUser(client);
    const otherAuth = bearer(other.accessToken);

    const get = await client.get(`/api/v1/notes/${note.id}`).set(otherAuth);
    expect(get.status).toBe(404);

    const patch = await client
      .patch(`/api/v1/notes/${note.id}`)
      .set(otherAuth)
      .send({ title: 'Hacked' });
    expect(patch.status).toBe(404);

    const otherList = await client.get('/api/v1/notes').set(otherAuth);
    expect(
      otherList.body.data.map((n: { title: string }) => n.title)
    ).not.toContain('Private');
  });

  it('requires authentication', async () => {
    const res = await client.get('/api/v1/notes');
    expect(res.status).toBe(401);
  });
});

describe('trash', () => {
  it('moves notes to trash and restores them', async () => {
    const note = await createNote({ title: 'Trash me' });

    const trashed = await client
      .post(`/api/v1/notes/${note.id}/trash`)
      .set(auth);
    expect(trashed.status).toBe(200);
    expect(trashed.body.data.status).toBe('trash');
    expect(trashed.body.data.deletedAt).toEqual(expect.any(String));

    expect((await listNotes()).map(n => n.id)).not.toContain(note.id);
    expect((await listNotes({ status: 'trash' })).map(n => n.id)).toEqual([
      note.id,
    ]);

    const restored = await client
      .post(`/api/v1/notes/${note.id}/restore`)
      .set(auth);
    expect(restored.body.data).toMatchObject({
      status: 'active',
      deletedAt: null,
    });
    expect(await listNotes({ status: 'trash' })).toEqual([]);
  });

  it('does not allow editing trashed notes', async () => {
    const note = await createNote();
    await client.post(`/api/v1/notes/${note.id}/trash`).set(auth);

    const res = await client
      .patch(`/api/v1/notes/${note.id}`)
      .set(auth)
      .send({ title: 'Edit' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCode.NOTE_IN_TRASH);
  });

  it('only permanently deletes notes that are in trash', async () => {
    const note = await createNote();

    const tooEarly = await client.delete(`/api/v1/notes/${note.id}`).set(auth);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe(ErrorCode.NOTE_NOT_IN_TRASH);

    await client.post(`/api/v1/notes/${note.id}/trash`).set(auth);
    const deleted = await client.delete(`/api/v1/notes/${note.id}`).set(auth);
    expect(deleted.status).toBe(204);

    const get = await client.get(`/api/v1/notes/${note.id}`).set(auth);
    expect(get.status).toBe(404);
  });

  it('empties the trash without touching active notes', async () => {
    const a = await createNote({ title: 'a' });
    const b = await createNote({ title: 'b' });
    await createNote({ title: 'keep' });
    await client.post(`/api/v1/notes/${a.id}/trash`).set(auth);
    await client.post(`/api/v1/notes/${b.id}/trash`).set(auth);

    const res = await client.delete('/api/v1/notes/trash').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deletedCount: 2 });

    expect(await listNotes({ status: 'trash' })).toEqual([]);
    expect((await listNotes()).map(n => n.title)).toContain('keep');
  });
});

describe('filtering', () => {
  it('filters by tag', async () => {
    await createNote({ title: 'Work note', tags: ['work'] });
    await createNote({ title: 'Home note', tags: ['home'] });

    const titles = (await listNotes({ tag: 'WORK' })).map(n => n.title);
    expect(titles).toEqual(['Work note']);
  });

  it('searches title and text case-insensitively, treating input literally', async () => {
    await createNote({ title: 'Groceries', text: 'milk, eggs' });
    await createNote({ title: 'Ideas', text: 'Buy MILK later' });
    await createNote({ title: 'Regex (a+b)', text: '' });

    const milk = (await listNotes({ q: 'milk' })).map(n => n.title).sort();
    expect(milk).toEqual(['Groceries', 'Ideas']);

    const literal = (await listNotes({ q: '(a+b)' })).map(n => n.title);
    expect(literal).toEqual(['Regex (a+b)']);
  });

  it('rejects unknown status values', async () => {
    const res = await client
      .get('/api/v1/notes')
      .query({ status: 'archived' })
      .set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({
      location: 'query',
      path: 'status',
    });
  });
});
