import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { listedRoomWhere } from '../properties/public-listing';
import { ListPublicRoomsDto } from './dto/list-public-rooms.dto';
import {
  activeFeaturingWhere,
  withoutActiveFeaturingWhere,
} from './room-featuring';
import {
  PublicRoomCardRow,
  publicRoomCardSelect,
  toPublicRoomCard,
} from './public-room-card';
import {
  RoomListingCursor,
  decodeRoomListingCursor,
  encodeRoomListingCursor,
} from './room-listing-cursor';

const rankingOrder: Prisma.RoomOrderByWithRelationInput[] = [
  { rankingScore: 'desc' },
  { id: 'asc' },
];

@Injectable()
export class PublicRoomsService {
  private readonly logger = new Logger(PublicRoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  list(dto: ListPublicRoomsDto) {
    return this.paginate(dto, false, withoutActiveFeaturingWhere);
  }

  listFeatured(dto: ListPublicRoomsDto) {
    return this.paginate(dto, true, activeFeaturingWhere);
  }

  private async paginate(
    { cursor: encodedCursor, limit, city, state }: ListPublicRoomsDto,
    featured: boolean,
    featuringWhere: (now: Date) => Prisma.RoomWhereInput,
  ) {
    const cursor = encodedCursor
      ? decodeRoomListingCursor(encodedCursor, new Date())
      : undefined;
    const asOf = cursor?.asOf ?? new Date();
    const startedAt = performance.now();
    const where: Prisma.RoomWhereInput = {
      AND: [
        featuringWhere(asOf),
        city && state
          ? { property: { state, city: { equals: city, mode: 'insensitive' } } }
          : {},
      ],
    };

    try {
      const [rooms, total] = await Promise.all([
        this.segment(where, cursor, limit + 1),
        cursor
          ? undefined
          : this.prisma.room.count({
              where: { AND: [listedRoomWhere, where] },
            }),
      ]);
      const page = rooms.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rooms.length > limit && last
          ? encodeRoomListingCursor({
              asOf,
              featured,
              rankingScore: last.rankingScore,
              id: last.id,
            })
          : null;

      this.logger.log(
        `rooms.list featured=${featured} filtered=${Boolean(city)} durationMs=${elapsed(startedAt)} results=${page.length} firstPage=${!cursor}`,
      );

      return {
        items: page.map((room) =>
          toPublicRoomCard(this.mediaService, room, featured),
        ),
        nextCursor,
        ...(total === undefined ? {} : { total }),
      };
    } catch (error) {
      this.logger.error(
        `rooms.list failed featured=${featured} durationMs=${elapsed(startedAt)} firstPage=${!cursor}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private segment(
    where: Prisma.RoomWhereInput,
    cursor: RoomListingCursor | undefined,
    take: number,
  ): Promise<PublicRoomCardRow[]> {
    return this.prisma.room.findMany({
      where: {
        AND: [listedRoomWhere, where, cursor ? afterCursorWhere(cursor) : {}],
      },
      orderBy: rankingOrder,
      take,
      select: publicRoomCardSelect,
    });
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
