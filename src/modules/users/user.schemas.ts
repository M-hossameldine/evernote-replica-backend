import { z } from 'zod';

import type { UserDocument } from './user.model.js';

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters')
  .meta({ example: 'Ada Lovelace' });

export const userSchema = z
  .object({
    id: z.string().meta({ example: '665f1c2e8b3e4a0012345678' }),
    email: z.email().meta({ example: 'ada@example.com' }),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });

export type UserDto = z.infer<typeof userSchema>;

export const updateMeBodySchema = z
  .object({ name: nameSchema })
  .meta({ id: 'UpdateMeRequest' });

export function toUserDto(user: UserDocument): UserDto {
  return {
    id: user.id as string,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
