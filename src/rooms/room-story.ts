import { Prisma, RoomStoryStatus } from '../generated/prisma/client';
import { ROOM_STORY_TTL_MS } from './room-catalog';

export function activeStoryWhere(now: Date): Prisma.RoomWhereInput {
  return {
    storyStatus: RoomStoryStatus.APPROVED,
    storyMedia: { some: {} },
    storyApprovedAt: { gt: new Date(now.getTime() - ROOM_STORY_TTL_MS) },
  };
}

export function storyExpiresAt(room: {
  storyApprovedAt: Date | null;
}): Date | null {
  return room.storyApprovedAt
    ? new Date(room.storyApprovedAt.getTime() + ROOM_STORY_TTL_MS)
    : null;
}
