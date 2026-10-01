import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaType, Prisma } from '../generated/prisma/client';
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
import { MAX_ROOM_IMAGES } from './room-catalog';

type Transaction = Prisma.TransactionClient;

const roomDetailInclude = {
  media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  property: { select: { id: true, title: true, status: true } },
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

  async create(userId: string, propertyId: string, dto: CreateRoomDto) {
    const room = await this.prisma.$transaction(async (transaction) => {
      await this.propertiesService.lockOwned(transaction, userId, propertyId);
      const created = await transaction.room.create({
        data: { ...dto, propertyId },
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
    };
  }

  async update(userId: string, roomId: string, dto: UpdateRoomDto) {
    await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwnedRoomProperty(
        transaction,
        userId,
        roomId,
      );
      await transaction.room.update({ where: { id: roomId }, data: dto });
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
    const stored = await this.mediaService.store(file, `rooms/${roomId}`, [
      MediaType.IMAGE,
    ]);

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwnedRoomProperty(transaction, userId, roomId);
        const existing = await transaction.roomMedia.findMany({
          where: { roomId },
          select: { position: true },
        });
        if (existing.length >= MAX_ROOM_IMAGES) {
          throw new UnprocessableEntityException(
            `O quarto pode ter no máximo ${MAX_ROOM_IMAGES} fotos.`,
          );
        }
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

  private toDetail({ media, ...room }: RoomDetail) {
    return {
      ...room,
      media: media.map((item) => this.mediaService.toResponse(item)),
    };
  }
}

function roomNotFound() {
  return new NotFoundException('Quarto não encontrado.');
}
