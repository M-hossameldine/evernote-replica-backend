import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    /** Absent for accounts that only ever signed in with Google. */
    passwordHash: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true },
    avatarUrl: { type: String },
    passwordReset: {
      type: new Schema(
        {
          tokenHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ 'passwordReset.tokenHash': 1 }, { sparse: true });

export type UserFields = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserFields>;

export const UserModel = model('User', userSchema);
