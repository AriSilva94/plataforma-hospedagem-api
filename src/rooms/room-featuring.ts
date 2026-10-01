import { Prisma } from '../generated/prisma/client';

export interface FeaturingPeriod {
  featuredFrom: Date | null;
  featuredUntil: Date | null;
}

export const FEATURING_STATUSES = [
  'NONE',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
] as const;

export type FeaturingStatus = (typeof FEATURING_STATUSES)[number];

export function activeFeaturingWhere(now: Date): Prisma.RoomWhereInput {
  return { featuredFrom: { lte: now }, featuredUntil: { gt: now } };
}

export function withoutActiveFeaturingWhere(now: Date): Prisma.RoomWhereInput {
  return {
    OR: [
      { featuredFrom: null },
      { featuredFrom: { gt: now } },
      { featuredUntil: { lte: now } },
    ],
  };
}

export function featuringStatusWhere(
  status: FeaturingStatus,
  now: Date,
): Prisma.RoomWhereInput {
  const where: Record<FeaturingStatus, Prisma.RoomWhereInput> = {
    NONE: { featuredFrom: null },
    SCHEDULED: { featuredFrom: { gt: now } },
    ACTIVE: activeFeaturingWhere(now),
    ENDED: { featuredUntil: { lte: now } },
  };
  return where[status];
}

export function featuringStatusOf(
  { featuredFrom, featuredUntil }: FeaturingPeriod,
  now: Date,
): FeaturingStatus {
  if (!featuredFrom || !featuredUntil) {
    return 'NONE';
  }
  if (featuredFrom > now) {
    return 'SCHEDULED';
  }
  return featuredUntil > now ? 'ACTIVE' : 'ENDED';
}
