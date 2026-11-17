import { z } from 'zod';

import { nameSchema, userSchema } from '../users/user.schemas.js';

// Normalize first, then validate (z.email() would validate before trimming).
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(z.regexes.email, 'Invalid email address')
  .meta({ format: 'email', example: 'ada@example.com' });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .meta({ example: 'correct-horse-battery' });

export const registerBodySchema = z
  .object({ name: nameSchema, email: emailSchema, password: passwordSchema })
  .meta({ id: 'RegisterRequest' });

export const loginBodySchema = z
  .object({
    email: emailSchema,
    // Don't enforce password rules on login: rules may change over time.
    password: z.string().min(1, 'Password is required').max(128),
  })
  .meta({ id: 'LoginRequest' });

export const googleBodySchema = z
  .object({
    idToken: z.string().min(1).meta({
      description: 'Google ID token (credential) from Google Identity Services',
    }),
  })
  .meta({ id: 'GoogleLoginRequest' });

export const forgotPasswordBodySchema = z
  .object({ email: emailSchema })
  .meta({ id: 'ForgotPasswordRequest' });

export const resetPasswordBodySchema = z
  .object({
    token: z
      .string()
      .min(1)
      .meta({ description: 'Token from the reset email link' }),
    password: passwordSchema,
  })
  .meta({ id: 'ResetPasswordRequest' });

export const authResponseSchema = z
  .object({
    user: userSchema,
    accessToken: z.string(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().meta({ example: 900 }),
  })
  .meta({
    id: 'AuthResponse',
    description:
      'Also sets the httpOnly `refresh_token` cookie (path /api/v1/auth).',
  });

export type AuthResponse = z.infer<typeof authResponseSchema>;
