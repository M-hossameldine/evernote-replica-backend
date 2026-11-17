import type { ApiRouter } from '../../lib/api-router.js';
import { AppError } from '../../errors/app-error.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { UserModel } from './user.model.js';
import { toUserDto, updateMeBodySchema, userSchema } from './user.schemas.js';

const userNotFound = () =>
  AppError.notFound(ErrorCode.USER_NOT_FOUND, 'User no longer exists');

export function registerUserRoutes(api: ApiRouter) {
  api.route({
    method: 'get',
    path: '/users/me',
    tags: ['Users'],
    summary: 'Get the current user',
    auth: true,
    response: userSchema,
    errors: [404],
    handler: async ({ userId }) => {
      const user = await UserModel.findById(userId);
      if (!user) throw userNotFound();
      return toUserDto(user);
    },
  });

  api.route({
    method: 'patch',
    path: '/users/me',
    tags: ['Users'],
    summary: 'Update the current user profile',
    auth: true,
    request: { body: updateMeBodySchema },
    response: userSchema,
    errors: [404],
    handler: async ({ userId, body }) => {
      const user = await UserModel.findByIdAndUpdate(
        userId,
        { $set: { name: body.name } },
        { returnDocument: 'after', runValidators: true }
      );
      if (!user) throw userNotFound();
      return toUserDto(user);
    },
  });
}
