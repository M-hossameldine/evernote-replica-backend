import { OAuth2Client } from 'google-auth-library';

import { AppError } from '../../errors/app-error.js';
import { ErrorCode } from '../../errors/error-codes.js';

export type GoogleProfile = {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

const client = new OAuth2Client();

/**
 * Verifies a Google ID token (from Google Identity Services on the frontend)
 * against our OAuth client id and returns the profile it carries.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<GoogleProfile> {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Google token is missing subject or email');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (err) {
    throw new AppError({
      status: 401,
      code: ErrorCode.AUTH_GOOGLE_TOKEN_INVALID,
      message: 'Invalid Google credential',
      cause: err,
    });
  }
}
