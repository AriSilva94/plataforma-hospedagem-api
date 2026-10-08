import { User } from '../generated/prisma/client';

export type PublicUser = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerifiedAt'
  | 'status'
  | 'roles'
  | 'createdAt'
  | 'updatedAt'
>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    status: user.status,
    roles: user.roles,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
