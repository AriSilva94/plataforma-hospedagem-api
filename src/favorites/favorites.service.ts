import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { listedRoomWhere } from '../properties/public-listing';

const coverMedia = {
  where: { type: MediaType.IMAGE },
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  take: 1,
  select: { type: true, storageKey: true },
} satisfies Prisma.RoomMediaFindManyArgs & Prisma.PropertyMediaFindManyArgs;

const favoriteSelect = {
  createdAt: true,
  room: {
    select: {
      id: true,
      title: true,
      priceCents: true,
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
    },
  },
} satisfies Prisma.FavoriteSelect;

type FavoriteRow = Prisma.FavoriteGetPayload<{
  select: typeof favoriteSelect;
}>;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async list(userId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: favoriteSelect,
    });
    const listed = await this.listedRoomIds(
      favorites.map((favorite) => favorite.room.id),
    );
    return {
      items: favorites.map((favorite) =>
        this.toItem(favorite, listed.has(favorite.room.id)),
      ),
    };
  }

  async roomIds(userId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      select: { roomId: true },
    });
    return { roomIds: favorites.map((favorite) => favorite.roomId) };
  }

  async add(userId: string, roomId: string): Promise<void> {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, ...listedRoomWhere },
      select: { id: true },
    });
    if (!room) {
      throw new NotFoundException('Quarto não encontrado.');
    }
    await this.prisma.favorite.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { userId, roomId },
      update: {},
    });
  }

  async remove(userId: string, roomId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { userId, roomId } });
  }

  private async listedRoomIds(roomIds: string[]): Promise<Set<string>> {
    if (roomIds.length === 0) return new Set();
    const rooms = await this.prisma.room.findMany({
      where: { id: { in: roomIds }, ...listedRoomWhere },
      select: { id: true },
    });
    return new Set(rooms.map((room) => room.id));
  }

  private toItem({ createdAt, room }: FavoriteRow, available: boolean) {
    const { media: propertyMedia, ...property } = room.property;
    return {
      roomId: room.id,
      title: room.title,
      priceCents: room.priceCents,
      coverUrl:
        this.mediaService.coverUrl(room.media) ??
        this.mediaService.coverUrl(propertyMedia),
      available,
      favoritedAt: createdAt,
      property,
    };
  }
}
