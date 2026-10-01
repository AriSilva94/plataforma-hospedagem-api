import { Injectable, Logger } from '@nestjs/common';
import { MediaType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { listedRoomWhere } from '../properties/public-listing';
import { ListPublicRoomsDto } from './dto/list-public-rooms.dto';
import {
  activeFeaturingWhere,
  withoutActiveFeaturingWhere,
} from './room-featuring';
import {
  RoomListingCursor,
  decodeRoomListingCursor,
  encodeRoomListingCursor,
} from './room-listing-cursor';

const coverMedia = {
  where: { type: MediaType.IMAGE },
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  take: 1,
  select: { type: true, storageKey: true },
} satisfies Prisma.RoomMediaFindManyArgs & Prisma.PropertyMediaFindManyArgs;

const roomCardSelect = {
  id: true,
  title: true,
  priceCents: true,
  rankingScore: true,
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

const rankingOrder: Prisma.RoomOrderByWithRelationInput[] = [
  { rankingScore: 'desc' },
  { id: 'asc' },
];

type RoomCardRow = Prisma.RoomGetPayload<{ select: typeof roomCardSelect }>;
type RankedRoom = RoomCardRow & { featured: boolean };

@Injectable()
export class PublicRoomsService {
  private readonly logger = new Logger(PublicRoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async list({ cursor: encodedCursor, limit }: ListPublicRoomsDto) {
    const cursor = encodedCursor
      ? decodeRoomListingCursor(encodedCursor, new Date())
      : undefined;
    const asOf = cursor?.asOf ?? new Date();
    const startedAt = performance.now();

    try {
      const [rooms, total] = await Promise.all([
        this.ranked(cursor, limit + 1, asOf),
        cursor ? undefined : this.prisma.room.count({ where: listedRoomWhere }),
      ]);
      const page = rooms.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rooms.length > limit && last
          ? encodeRoomListingCursor({
              asOf,
              featured: last.featured,
              rankingScore: last.rankingScore,
              id: last.id,
            })
          : null;

      this.logger.log(
        `rooms.list durationMs=${elapsed(startedAt)} results=${page.length} featured=${page.filter((room) => room.featured).length} firstPage=${!cursor}`,
      );

      return {
        items: page.map((room) => this.toCard(room)),
        nextCursor,
        ...(total === undefined ? {} : { total }),
      };
    } catch (error) {
      this.logger.error(
        `rooms.list failed durationMs=${elapsed(startedAt)} firstPage=${!cursor}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async ranked(
    cursor: RoomListingCursor | undefined,
    take: number,
    asOf: Date,
  ): Promise<RankedRoom[]> {
    const featured =
      !cursor || cursor.featured
        ? await this.segment(activeFeaturingWhere(asOf), cursor, take)
        : [];
    if (featured.length >= take) {
      return featured.map((room) => ({ ...room, featured: true }));
    }

    const organic = await this.segment(
      withoutActiveFeaturingWhere(asOf),
      cursor?.featured ? undefined : cursor,
      take - featured.length,
    );
    return [
      ...featured.map((room) => ({ ...room, featured: true })),
      ...organic.map((room) => ({ ...room, featured: false })),
    ];
  }

  private segment(
    featuringWhere: Prisma.RoomWhereInput,
    cursor: RoomListingCursor | undefined,
    take: number,
  ): Promise<RoomCardRow[]> {
    return this.prisma.room.findMany({
      where: {
        AND: [
          listedRoomWhere,
          featuringWhere,
          cursor ? afterCursorWhere(cursor) : {},
        ],
      },
      orderBy: rankingOrder,
      take,
      select: roomCardSelect,
    });
  }

  private toCard({ media, property, featured, ...room }: RankedRoom) {
    const { media: propertyMedia, ...propertySummary } = property;
    return {
      id: room.id,
      title: room.title,
      priceCents: room.priceCents,
      featured,
      coverUrl:
        this.mediaService.coverUrl(media) ??
        this.mediaService.coverUrl(propertyMedia),
      property: propertySummary,
    };
  }
}

function afterCursorWhere({
  rankingScore,
  id,
}: RoomListingCursor): Prisma.RoomWhereInput {
  return {
    rankingScore: { lte: rankingScore },
    OR: [
      { rankingScore: { lt: rankingScore } },
      { rankingScore, id: { gt: id } },
    ],
  };
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
