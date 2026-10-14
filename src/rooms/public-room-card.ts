import {
  MediaType,
  Prisma,
  RoomVerificationStatus,
} from '../generated/prisma/client';
import { MediaService } from '../media/media.service';

const coverMedia = {
  where: { type: MediaType.IMAGE },
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  take: 1,
  select: { type: true, storageKey: true },
} satisfies Prisma.RoomMediaFindManyArgs & Prisma.PropertyMediaFindManyArgs;

export const publicRoomCardSelect = {
  id: true,
  title: true,
  priceCents: true,
  rankingScore: true,
  verificationStatus: true,
  media: coverMedia,
  property: {
    select: {
      id: true,
      title: true,
      type: true,
      neighborhood: true,
      city: true,
      state: true,
      media: coverMedia,
    },
  },
} satisfies Prisma.RoomSelect;

export type PublicRoomCardRow = Prisma.RoomGetPayload<{
  select: typeof publicRoomCardSelect;
}>;

export function toPublicRoomCard(
  mediaService: MediaService,
  { media, property, ...room }: PublicRoomCardRow,
  featured: boolean,
) {
  const { media: propertyMedia, ...propertySummary } = property;
  return {
    id: room.id,
    title: room.title,
    priceCents: room.priceCents,
    featured,
    verified: room.verificationStatus === RoomVerificationStatus.VERIFIED,
    coverUrl:
      mediaService.coverUrl(media) ?? mediaService.coverUrl(propertyMedia),
    property: propertySummary,
  };
}
