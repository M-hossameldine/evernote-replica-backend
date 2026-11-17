import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { logger } from '../../lib/logger.js';
import { sendMail } from '../../lib/mailer.js';
import { createWelcomeNote } from '../notes/note.service.js';
import { UserModel, type UserDocument } from '../users/user.model.js';
import { toUserDto } from '../users/user.schemas.js';
import { passwordResetEmail } from './auth.emails.js';
import type { AuthResponse } from './auth.schemas.js';
import { verifyGoogleIdToken } from './google.js';
import { SessionModel } from './session.model.js';
import { generateOpaqueToken, hashToken, signAccessToken } from './tokens.js';

export type ClientMeta = { userAgent?: string; ip?: string };

export type AuthResult = AuthResponse & {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

// Compared against when the email is unknown, so response time doesn't reveal
// whether an account exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password', 10);

const invalidCredentials = () =>
  AppError.unauthorized(
    ErrorCode.AUTH_INVALID_CREDENTIALS,
    'Incorrect email or password'
  );

const invalidRefreshToken = () =>
  AppError.unauthorized(
    ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
    'Session is invalid or has expired, please log in again'
  );

async function createSession(
  userId: string,
  meta: ClientMeta,
  familyId: string = randomUUID()
) {
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await SessionModel.create({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 512),
    ip: meta.ip,
  });

  return { refreshToken, expiresAt };
}

async function issueAuth(
  user: UserDocument,
  meta: ClientMeta,
  familyId?: string
): Promise<AuthResult> {
  const { refreshToken, expiresAt } = await createSession(
    user.id as string,
    meta,
    familyId
  );
  const access = signAccessToken(user.id as string);

  return {
    user: toUserDto(user),
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function revokeAllSessions(userId: string) {
  await SessionModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function register(
  input: { name: string; email: string; password: string },
  meta: ClientMeta
): Promise<AuthResult> {
  if (await UserModel.exists({ email: input.email })) {
    throw AppError.conflict(
      ErrorCode.AUTH_EMAIL_IN_USE,
      'An account with this email already exists'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

  let user: UserDocument;
  try {
    user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });
  } catch (err) {
    // Lost a race with a concurrent registration for the same email.
    if ((err as { code?: number }).code === 11000) {
      throw AppError.conflict(
        ErrorCode.AUTH_EMAIL_IN_USE,
        'An account with this email already exists'
      );
    }
    throw err;
  }

  await createWelcomeNote(user.id as string);
  return issueAuth(user, meta);
}

export async function login(
  input: { email: string; password: string },
  meta: ClientMeta
): Promise<AuthResult> {
  const user = await UserModel.findOne({ email: input.email }).select(
    '+passwordHash'
  );

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  );

  if (!user?.passwordHash || !passwordMatches) throw invalidCredentials();

  return issueAuth(user, meta);
}

export async function loginWithGoogle(
  idToken: string,
  meta: ClientMeta
): Promise<AuthResult> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError({
      status: 503,
      code: ErrorCode.AUTH_GOOGLE_NOT_CONFIGURED,
      message: 'Google sign-in is not configured',
    });
  }

  const profile = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);

  if (!profile.emailVerified) {
    throw AppError.unauthorized(
      ErrorCode.AUTH_GOOGLE_EMAIL_UNVERIFIED,
      'Your Google email address is not verified'
    );
  }

  const email = profile.email.toLowerCase();

  let user = await UserModel.findOne({ googleId: profile.googleId });

  if (!user) {
    // Link Google to an existing password account with the same (verified)
    // email, or create a new account.
    user = await UserModel.findOne({ email });
    if (user) {
      user.googleId = profile.googleId;
      user.avatarUrl ??= profile.picture;
      await user.save();
    } else {
      user = await UserModel.create({
        email,
        name: profile.name?.trim() || email.split('@')[0],
        googleId: profile.googleId,
        avatarUrl: profile.picture,
      });
      await createWelcomeNote(user.id as string);
    }
  }

  return issueAuth(user, meta);
}

/**
 * Exchanges a refresh token for a new access token and a rotated refresh
 * token. Presenting an already-rotated token means it was stolen (or replayed),
 * so the whole session family is revoked.
 */
export async function refresh(
  refreshToken: string | undefined,
  meta: ClientMeta
): Promise<AuthResult> {
  if (!refreshToken) throw invalidRefreshToken();

  const session = await SessionModel.findOne({
    tokenHash: hashToken(refreshToken),
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw invalidRefreshToken();
  }

  if (session.revokedAt) {
    await SessionModel.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    logger.warn(
      { userId: String(session.userId), familyId: session.familyId },
      'Refresh token reuse detected; session family revoked'
    );
    throw invalidRefreshToken();
  }

  // Atomically claim the token so two concurrent refreshes can't both succeed.
  const claimed = await SessionModel.updateOne(
    { _id: session._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  if (claimed.modifiedCount !== 1) throw invalidRefreshToken();

  const user = await UserModel.findById(session.userId);
  if (!user) throw invalidRefreshToken();

  return issueAuth(user, meta, session.familyId);
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await SessionModel.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/** Always resolves the same way, whether or not the email has an account. */
export async function requestPasswordReset(email: string) {
  const user = await UserModel.findOne({ email });
  if (!user) return;

  const token = generateOpaqueToken();
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000
  );

  user.passwordReset = { tokenHash: hashToken(token), expiresAt };
  await user.save();

  const resetUrl = new URL('/auth/reset-password', env.APP_URL);
  resetUrl.searchParams.set('token', token);

  try {
    await sendMail(
      passwordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: resetUrl.toString(),
        expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      })
    );
  } catch (err) {
    // Don't reveal delivery problems (or account existence) to the caller.
    logger.error({ err }, 'Failed to send password reset email');
  }
}

export async function resetPassword(input: {
  token: string;
  password: string;
}) {
  const user = await UserModel.findOne({
    'passwordReset.tokenHash': hashToken(input.token),
    'passwordReset.expiresAt': { $gt: new Date() },
  });

  if (!user) {
    throw AppError.badRequest(
      ErrorCode.AUTH_RESET_TOKEN_INVALID,
      'This reset link is invalid or has expired'
    );
  }

  user.passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  user.passwordReset = undefined;
  await user.save();

  // Sign out everywhere: whoever had access before the reset loses it.
  await revokeAllSessions(user.id as string);
}
