/**
 * Creates (or recreates) a demo user with sample notes for local development.
 * Usage: `npm run db:seed`
 *
 * The demo credentials come from SEED_DEMO_EMAIL / SEED_DEMO_PASSWORD in
 * `.env`. Re-running the script resets the demo user's data; other users are
 * never touched. Refuses to run with NODE_ENV=production.
 */
import bcrypt from 'bcryptjs';

import { env } from '../src/config/env.js';
import {
  connectDatabase,
  describeConnectionError,
  disconnectDatabase,
} from '../src/lib/db.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { NoteModel } from '../src/modules/notes/note.model.js';
import { UserModel } from '../src/modules/users/user.model.js';

const log = (message = '') => process.stdout.write(`${message}\n`);

const DEMO_EMAIL = (
  process.env.SEED_DEMO_EMAIL || 'demo@evernote-replica.local'
).toLowerCase();
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const sampleNotes = [
  {
    title: 'Welcome to Evernote!',
    text: 'Start creating your notes...',
    tags: [],
    updatedAt: daysAgo(10),
  },
  {
    title: 'Groceries',
    text: 'Milk\nEggs\nBread\nCoffee beans\nTomatoes',
    tags: ['home', 'shopping'],
    updatedAt: daysAgo(1),
  },
  {
    title: 'Sprint planning',
    text: 'Goals:\n- Migrate auth to the new API\n- Notes CRUD against MongoDB\n- Deploy backend to Railway',
    tags: ['work'],
    updatedAt: daysAgo(0.2),
  },
  {
    title: 'Book ideas',
    text: 'A detective who only solves crimes using Git history.',
    tags: ['ideas', 'writing'],
    updatedAt: daysAgo(4),
  },
  {
    title: 'Trip to Alexandria',
    text: 'Visit the Bibliotheca Alexandrina and the Citadel of Qaitbay.',
    tags: ['travel'],
    updatedAt: daysAgo(7),
  },
];

const trashedNotes = [
  {
    title: 'Old meeting notes',
    text: 'Nothing important here anymore.',
    tags: ['work'],
    updatedAt: daysAgo(20),
    deletedAt: daysAgo(2),
  },
  {
    title: 'Draft that did not work out',
    text: 'Lorem ipsum...',
    tags: [],
    updatedAt: daysAgo(15),
    deletedAt: daysAgo(5),
  },
];

async function main() {
  if (env.isProduction && !process.argv.includes('--force')) {
    log(
      '✗ Refusing to seed with NODE_ENV=production (pass --force to override).'
    );
    process.exitCode = 1;
    return;
  }
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
    log('✗ Set SEED_DEMO_PASSWORD (at least 8 characters) in .env first.');
    process.exitCode = 1;
    return;
  }

  try {
    await connectDatabase({
      uri: env.MONGODB_URI,
      dbName: env.MONGODB_DB_NAME,
    });
  } catch (err) {
    log(`✗ Connection failed: ${(err as Error).message}`);
    const hint = describeConnectionError(err);
    if (hint) log(`  Hint: ${hint}`);
    process.exitCode = 1;
    return;
  }

  // Start from a clean slate for the demo user only.
  const existing = await UserModel.findOne({ email: DEMO_EMAIL });
  if (existing) {
    await Promise.all([
      NoteModel.deleteMany({ userId: existing._id }),
      SessionModel.deleteMany({ userId: existing._id }),
    ]);
    await existing.deleteOne();
  }

  const user = await UserModel.create({
    name: 'Demo User',
    email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS),
  });

  const docs = [
    ...sampleNotes.map(note => ({ ...note, status: 'active' as const })),
    ...trashedNotes.map(note => ({ ...note, status: 'trash' as const })),
  ].map(note => ({
    ...note,
    userId: user._id,
    createdAt: new Date(note.updatedAt.getTime() - DAY),
  }));

  // `timestamps: false` keeps the hand-picked dates instead of "now".
  await Promise.all(
    docs.map(doc => new NoteModel(doc).save({ timestamps: false }))
  );

  log(`✓ Seeded database "${user.db.name}"`);
  log(`  Demo user: ${DEMO_EMAIL} (password: SEED_DEMO_PASSWORD from .env)`);
  log(
    `  Notes:     ${sampleNotes.length} active, ${trashedNotes.length} in trash`
  );
}

try {
  await main();
} finally {
  await disconnectDatabase();
}
