import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaType,
  Prisma,
  RoomStatus,
  RoomVerificationStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ReorderMediaDto } from '../media/dto/reorder-media.dto';
import {
  MediaService,
  UploadedMediaFile,
  nextPosition,
} from '../media/media.service';
import { PropertiesService } from '../properties/properties.service';
import { RoomRankingService } from '../ranking/room-ranking.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { withConsistentCleaning } from '../common/house-services';
import { MAX_ROOM_IMAGES, MAX_ROOM_VIDEOS, bedSelection } from './room-catalog';
import { storyExpiresAt } from './room-story';

type Transaction = Prisma.TransactionClient;

const roomDetailInclude = {
  beds: bedSelection,
  media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  storyMedia: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  property: {
    select: {
      id: true,
      title: true,
      status: true,
      hasCleaner: true,
      cleaningFrequency: true,
      smokingPolicy: true,
      _count: {
        select: { rooms: { where: { status: RoomStatus.AVAILABLE } } },
      },
    },
  },
} satisfies Prisma.RoomInclude;

const internalRoomFields = {
  rankingScore: true,
  rankingVersion: true,
  rankingUpdatedAt: true,
  featuredFrom: true,
  featuredUntil: true,
} satisfies Prisma.RoomOmit;

type RoomDetail = Prisma.RoomGetPayload<{
  include: typeof roomDetailInclude;
  omit: typeof internalRoomFields;
}>;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly propertiesService: PropertiesService,
    private readonly mediaService: MediaService,
    private readonly roomRanking: RoomRankingService,
  ) {}

  async summary(userId: string) {
    const ownedRoomsWhere: Prisma.RoomWhereInput = {
      property: { ownerProfile: { userId } },
    };
    const [total, available, pending, rejected] = await Promise.all([
      this.prisma.room.count({ where: ownedRoomsWhere }),
      this.prisma.room.count({
        where: { ...ownedRoomsWhere, status: RoomStatus.AVAILABLE },
      }),
      this.prisma.room.count({
        where: {
          ...ownedRoomsWhere,
          verificationStatus: RoomVerificationStatus.PENDING,
        },
      }),
      this.prisma.room.count({
        where: {
          ...ownedRoomsWhere,
          verificationStatus: RoomVerificationStatus.REJECTED,
        },
      }),
    ]);

    return {
      totalRooms: total,
      availableRooms: available,
      pendingVerificationRooms: pending,
      rejectedVerificationRooms: rejected,
    };
  }

  async create(userId: string, propertyId: string, dto: CreateRoomDto) {
    const room = await this.prisma.$transaction(async (transaction) => {
      await this.propertiesService.lockOwned(transaction, userId, propertyId);
      const { beds, ...fields } = dto;
      const created = await transaction.room.create({
        data: {
          ...withConsistentCleaning(fields),
          propertyId,
          beds: { create: beds ?? [] },
        },
        select: { id: true },
      });
      await this.roomRanking.recalculateRoom(transaction, created.id);
      return created;
    });
    return this.get(userId, room.id);
  }

  async get(userId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, property: { ownerProfile: { userId } } },
      include: roomDetailInclude,
      omit: internalRoomFields,
    });
    if (!room) {
      throw roomNotFound();
    }
    return {
      ...this.toDetail(room),
      completenessMissing: await this.roomRanking.missingCompleteness(room.id),
      storyViews: await this.storyViews(room),
    };
  }

  private async storyViews(room: { id: string; storyApprovedAt: Date | null }) {
    if (!room.storyApprovedAt) {
      return { unique: 0, total: 0 };
    }
    const totals = await this.prisma.roomStoryView.aggregate({
      where: { roomId: room.id, storyApprovedAt: room.storyApprovedAt },
      _count: { _all: true },
      _sum: { viewCount: true },
    });
    return { unique: totals._count._all, total: totals._sum.viewCount ?? 0 };
  }

  async update(userId: string, roomId: string, dto: UpdateRoomDto) {
    await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwnedRoomProperty(
        transaction,
        userId,
        roomId,
      );
      const { beds, ...fields } = dto;
      await transaction.room.update({
        where: { id: roomId },
        data: withConsistentCleaning(fields),
      });
      if (beds !== undefined) {
        await transaction.roomBed.deleteMany({ where: { roomId } });
        await transaction.roomBed.createMany({
          data: beds.map((bed) => ({ ...bed, roomId })),
        });
      }
      await this.propertiesService.assertListedComplete(transaction, property);
      await this.roomRanking.recalculateRoom(transaction, roomId);
    });
    return this.get(userId, roomId);
  }

  async remove(userId: string, roomId: string): Promise<void> {
    const storageKeys = await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwnedRoomProperty(
        transaction,
        userId,
        roomId,
      );
      const media = await transaction.roomMedia.findMany({
        where: { roomId },
        select: { storageKey: true },
      });
      await transaction.room.delete({ where: { id: roomId } });
      await this.propertiesService.assertListedComplete(transaction, property);
      return media.map((item) => item.storageKey);
    });
    await this.mediaService.removeQuietly(storageKeys);
  }

  async addMedia(
    userId: string,
    roomId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.findOwnedRoom(this.prisma, userId, roomId);
    const mediaType = await this.mediaService.typeOf(file, [
      MediaType.IMAGE,
      MediaType.VIDEO,
    ]);
    const currentCount = await this.prisma.roomMedia.count({
      where: { roomId, type: mediaType },
    });
    this.assertRoomMediaLimit(mediaType, currentCount);
    const stored = await this.mediaService.store(file, `rooms/${roomId}`, [
      MediaType.IMAGE,
      MediaType.VIDEO,
    ]);

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwnedRoomProperty(transaction, userId, roomId);
        const existing = await transaction.roomMedia.findMany({
          where: { roomId },
          select: { type: true, position: true },
        });
        this.assertRoomMediaLimit(
          stored.type,
          existing.filter((item) => item.type === stored.type).length,
        );
        const created = await transaction.roomMedia.create({
          data: { ...stored, roomId, position: nextPosition(existing) },
        });
        await this.roomRanking.recalculateRoom(transaction, roomId);
        return created;
      });
      return this.mediaService.toResponse(media);
    } catch (error) {
      await this.mediaService.removeQuietly([stored.storageKey]);
      throw error;
    }
  }

  async reorderMedia(
    userId: string,
    roomId: string,
    { mediaIds }: ReorderMediaDto,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedRoomProperty(transaction, userId, roomId);
      const current = await transaction.roomMedia.findMany({
        where: { roomId },
        select: { id: true },
      });
      this.mediaService.assertCompleteOrder(
        current.map((media) => media.id),
        mediaIds,
      );
      for (const [position, id] of mediaIds.entries()) {
        await transaction.roomMedia.update({
          where: { id },
          data: { position },
        });
      }
    });
    return this.get(userId, roomId);
  }

  async removeMedia(
    userId: string,
    roomId: string,
    mediaId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedRoomProperty(transaction, userId, roomId);
      const media = await transaction.roomMedia.findFirst({
        where: { id: mediaId, roomId },
        select: { id: true, storageKey: true },
      });
      if (!media) {
        throw new NotFoundException('Mídia não encontrada.');
      }
      await transaction.roomMedia.delete({ where: { id: media.id } });
      await this.roomRanking.recalculateRoom(transaction, roomId);
      return media.storageKey;
    });
    await this.mediaService.removeQuietly([storageKey]);
  }

  private assertRoomMediaLimit(type: MediaType, count: number) {
    const limit = type === MediaType.IMAGE ? MAX_ROOM_IMAGES : MAX_ROOM_VIDEOS;
    if (count >= limit) {
      throw new UnprocessableEntityException(
        type === MediaType.IMAGE
          ? `O quarto pode ter no máximo ${limit} fotos.`
          : `O quarto pode ter no máximo ${limit} vídeos.`,
      );
    }
  }

  private async findOwnedRoom(
    transaction: Transaction,
    userId: string,
    roomId: string,
  ) {
    const room = await transaction.room.findFirst({
      where: { id: roomId, property: { ownerProfile: { userId } } },
      select: { id: true, propertyId: true },
    });
    if (!room) {
      throw roomNotFound();
    }
    return room;
  }

  private async lockOwnedRoomProperty(
    transaction: Transaction,
    userId: string,
    roomId: string,
  ) {
    const room = await this.findOwnedRoom(transaction, userId, roomId);
    return this.propertiesService.lockOwned(
      transaction,
      userId,
      room.propertyId,
    );
  }

  private toDetail({ media, storyMedia, property, ...room }: RoomDetail) {
    const { _count, ...propertySummary } = property;
    return {
      ...room,
      storyExpiresAt: storyExpiresAt(room),
      property: { ...propertySummary, availableRoomCount: _count.rooms },
      media: media.map((item) => this.mediaService.toResponse(item)),
      storyMedia: storyMedia.map((item) => this.mediaService.toResponse(item)),
    };
  }
}

function roomNotFound() {
  return new NotFoundException('Quarto não encontrado.');
}
