import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  availabilityWindowEnd,
  isValidIsoDate,
  todayInSaoPaulo,
  weekdayOf,
} from '../availability/availability-rules';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { canonicalCityOfState } from '../locations/brazilian-cities';
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
    { cursor: encodedCursor, limit, ...filters }: ListPublicRoomsDto,
    featured: boolean,
    featuringWhere: (now: Date) => Prisma.RoomWhereInput,
  ) {
    const cursor = encodedCursor
      ? decodeRoomListingCursor(encodedCursor, new Date())
      : undefined;
    const asOf = cursor?.asOf ?? new Date();
    const startedAt = performance.now();
    const where: Prisma.RoomWhereInput = {
      AND: [featuringWhere(asOf), ...filterWhere(filters)],
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
        `rooms.list featured=${featured} filtered=${Object.values(filters).some((value) => value !== undefined)} durationMs=${elapsed(startedAt)} results=${page.length} firstPage=${!cursor}`,
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

function filterWhere({
  city,
  state,
  types,
  maxPriceCents,
  audience,
  checkIn,
}: Omit<ListPublicRoomsDto, 'cursor' | 'limit'>): Prisma.RoomWhereInput[] {
  return [
    city && state
      ? { property: { state, city: canonicalCity(state, city) } }
      : {},
    types?.length ? { property: { type: { in: types } } } : {},
    maxPriceCents === undefined ? {} : { priceCents: { lte: maxPriceCents } },
    audience ? { acceptedAudiences: { has: audience } } : {},
    checkInWhere(checkIn),
  ];
}

function checkInWhere(checkIn: string | undefined): Prisma.RoomWhereInput {
  const today = todayInSaoPaulo();
  if (
    !checkIn ||
    !isValidIsoDate(checkIn) ||
    checkIn < today ||
    checkIn > availabilityWindowEnd(today)
  ) {
    return {};
  }
  return {
    NOT: { blockedWeekdays: { has: weekdayOf(checkIn) } },
    blockedDates: { none: { date: new Date(`${checkIn}T00:00:00Z`) } },
  };
}

function canonicalCity(state: string, city: string): string {
  const canonical = canonicalCityOfState(state, city);
  if (!canonical) {
    throw new BadRequestException('Cidade não encontrada na UF informada.');
  }
  return canonical;
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
