import { User } from '../generated/prisma/client';

export type PublicUser = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerifiedAt'
  | 'phone'
  | 'city'
  | 'state'
  | 'status'
  | 'roles'
  | 'createdAt'
  | 'updatedAt'
> & { birthDate: string | null; hasPassword: boolean };

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    phone: user.phone,
    birthDate: user.birthDate?.toISOString().slice(0, 10) ?? null,
    city: user.city,
    state: user.state,
    status: user.status,
    hasPassword: user.passwordHash !== null,
    roles: user.roles,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
