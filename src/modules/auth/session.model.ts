import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One row per issued refresh token. Tokens rotate on every refresh; rotated
 * tokens stay (revoked) until they expire so that reuse of a stolen token can
 * be detected and the whole family revoked.
 */
const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    /** All tokens rotated from the same login share a family. */
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// MongoDB deletes the document once `expiresAt` has passed.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionFields = InferSchemaType<typeof sessionSchema>;

export const SessionModel = model('Session', sessionSchema);
