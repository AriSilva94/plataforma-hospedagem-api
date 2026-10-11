import { Prisma, User } from '../generated/prisma/client';

export const MINIMUM_AGE_YEARS = 18;

export const listingPersonalDataSelect = {
  phone: true,
  birthDate: true,
  city: true,
  state: true,
} satisfies Prisma.UserSelect;

export type ListingPersonalDataField = keyof typeof listingPersonalDataSelect;

export function hasListingPersonalData(
  user: Pick<User, ListingPersonalDataField>,
): boolean {
  return Boolean(user.phone && user.birthDate && user.city && user.state);
}

export function latestAdultBirthDate(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear() - MINIMUM_AGE_YEARS,
      now.getUTCMonth(),
      now.getUTCDate(),
    ),
  );
}
