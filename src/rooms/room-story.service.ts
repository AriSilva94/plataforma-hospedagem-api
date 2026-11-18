import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaType, Prisma, RoomStoryStatus } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  MediaService,
  UploadedMediaFile,
  nextPosition,
} from '../media/media.service';
import { listedRoomWhere } from '../properties/public-listing';
import { PropertiesService } from '../properties/properties.service';
import { MAX_ROOM_STORY_MEDIA } from './room-catalog';
import { activeFeaturingWhere } from './room-featuring';

const PUBLIC_STORIES_LIMIT = 20;

const storyMediaOrder = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.RoomStoryMediaOrderByWithRelationInput[];

@Injectable()
export class RoomStoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly propertiesService: PropertiesService,
    private readonly mediaService: MediaService,
  ) {}

  async listPublic() {
    const rooms = await this.prisma.room.findMany({
      where: {
        AND: [
          listedRoomWhere,
          activeFeaturingWhere(new Date()),
          { storyStatus: RoomStoryStatus.APPROVED, storyMedia: { some: {} } },
        ],
      },
      orderBy: [{ rankingScore: 'desc' }, { id: 'asc' }],
      take: PUBLIC_STORIES_LIMIT,
      select: {
        id: true,
        title: true,
        priceCents: true,
        capacity: true,
        acceptedAudiences: true,
        property: {
          select: { id: true, neighborhood: true, city: true, state: true },
        },
        storyMedia: { orderBy: storyMediaOrder },
      },
    });

    return {
      items: rooms.map((room) => ({
        roomId: room.id,
        propertyId: room.property.id,
        title: room.title,
        priceCents: room.priceCents,
        capacity: room.capacity,
        acceptedAudiences: room.acceptedAudiences,
        neighborhood: room.property.neighborhood,
        city: room.property.city,
        state: room.property.state,
        media: room.storyMedia.map((media) => ({
          id: media.id,
          type: media.type,
          url: this.mediaService.publicUrl(media.storageKey),
        })),
      })),
    };
  }

  async addMedia(
    userId: string,
    roomId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.assertOwnedRoom(userId, roomId);
    await this.assertHasSlot(roomId);
    const stored = await this.mediaService.store(
      file,
      `rooms/${roomId}/story`,
      [MediaType.IMAGE, MediaType.VIDEO],
    );

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwnedRoomProperty(transaction, userId, roomId);
        const existing = await transaction.roomStoryMedia.findMany({
          where: { roomId },
          select: { position: true },
        });
        if (existing.length >= MAX_ROOM_STORY_MEDIA) {
          throw storyLimitReached();
        }
        const created = await transaction.roomStoryMedia.create({
          data: { ...stored, roomId, position: nextPosition(existing) },
        });
        await resubmit(transaction, roomId);
        return created;
      });
      return this.mediaService.toResponse(media);
    } catch (error) {
      await this.mediaService.removeQuietly([stored.storageKey]);
      throw error;
    }
  }

  async removeMedia(
    userId: string,
    roomId: string,
    mediaId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedRoomProperty(transaction, userId, roomId);
      const media = await transaction.roomStoryMedia.findFirst({
        where: { id: mediaId, roomId },
        select: { id: true, storageKey: true },
      });
      if (!media) {
        throw new NotFoundException('Mídia não encontrada.');
      }
      await transaction.roomStoryMedia.delete({ where: { id: media.id } });
      await resubmit(transaction, roomId);
      return media.storageKey;
    });
    await this.mediaService.removeQuietly([storageKey]);
  }

  private async assertHasSlot(roomId: string) {
    const count = await this.prisma.roomStoryMedia.count({ where: { roomId } });
    if (count >= MAX_ROOM_STORY_MEDIA) {
      throw storyLimitReached();
    }
  }

  private async assertOwnedRoom(userId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, property: { ownerProfile: { userId } } },
      select: { id: true },
    });
    if (!room) {
      throw roomNotFound();
    }
  }

  private async lockOwnedRoomProperty(
    transaction: Prisma.TransactionClient,
    userId: string,
    roomId: string,
  ) {
    const room = await transaction.room.findFirst({
      where: { id: roomId, property: { ownerProfile: { userId } } },
      select: { propertyId: true },
    });
    if (!room) {
      throw roomNotFound();
    }
    await this.propertiesService.lockOwned(
      transaction,
      userId,
      room.propertyId,
    );
  }
}

function resubmit(transaction: Prisma.TransactionClient, roomId: string) {
  return transaction.room.update({
    where: { id: roomId },
    data: {
      storyStatus: RoomStoryStatus.PENDING,
      storyRejectedReason: null,
    },
  });
}

function storyLimitReached() {
  return new UnprocessableEntityException(
    `O story pode ter no máximo ${MAX_ROOM_STORY_MEDIA} mídias.`,
  );
}

function roomNotFound() {
  return new NotFoundException('Quarto não encontrado.');
}
