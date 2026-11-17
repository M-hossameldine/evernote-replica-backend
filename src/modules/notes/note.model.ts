import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';

export const NOTE_STATUSES = ['active', 'trash'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

const noteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '', maxlength: 500 },
    text: { type: String, default: '' },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: NOTE_STATUSES,
      default: 'active',
      required: true,
    },
    /** Set when the note is moved to trash, cleared on restore. */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Main listing query: a user's notes by status, most recently edited first.
noteSchema.index({ userId: 1, status: 1, updatedAt: -1 });
// Filtering by tag.
noteSchema.index({ userId: 1, tags: 1 });

export type NoteFields = InferSchemaType<typeof noteSchema>;
export type NoteDocument = HydratedDocument<NoteFields>;

export const NoteModel = model('Note', noteSchema);
