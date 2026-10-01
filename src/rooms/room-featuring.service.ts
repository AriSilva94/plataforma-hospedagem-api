import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { listedRoomWhere } from '../properties/public-listing';
import { AdminRoomSort, ListAdminRoomsDto } from './dto/list-admin-rooms.dto';
import { featuringStatusOf, featuringStatusWhere } from './room-featuring';

const adminRoomSelect = {
  id: true,
  title: true,
  status: true,
  completenessScore: true,
  featuredFrom: true,
  featuredUntil: true,
  property: {
    select: { id: true, title: true, status: true, city: true, state: true },
  },
} satisfies Prisma.RoomSelect;

const adminRoomOrders: Record<
  AdminRoomSort,
  Prisma.RoomOrderByWithRelationInput[]
> = {
  name: [{ property: { title: 'asc' } }, { title: 'asc' }, { id: 'asc' }],
  completeness: [{ completenessScore: 'asc' }, { id: 'asc' }],
};

type AdminRoomRow = Prisma.RoomGetPayload<{
  select: typeof adminRoomSelect;
}>;

@Injectable()
export class RoomFeaturingService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ q, featuring, listed, sort, page, limit }: ListAdminRoomsDto) {
    const now = new Date();
    const where: Prisma.RoomWhereInput = {
      AND: [
        q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { property: { title: { contains: q, mode: 'insensitive' } } },
                { property: { city: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {},
        featuring ? featuringStatusWhere(featuring, now) : {},
        listed === undefined
          ? {}
          : listed
            ? listedRoomWhere
            : { NOT: listedRoomWhere },
      ],
    };
    const [rooms, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        orderBy: adminRoomOrders[sort],
        skip: (page - 1) * limit,
        take: limit,
        select: adminRoomSelect,
      }),
      this.prisma.room.count({ where }),
    ]);
    const listedIds = await this.listedIds(rooms.map((room) => room.id));

    return {
      items: rooms.map((room) => toAdminRoom(room, listedIds, now)),
      page,
      limit,
      total,
    };
  }

  async feature(roomId: string, featuredFrom: Date, featuredUntil: Date) {
    if (featuredUntil <= featuredFrom) {
      throw new UnprocessableEntityException(
        'O fim do destaque deve ser posterior ao início.',
      );
    }
    const { count } = await this.prisma.room.updateMany({
      where: { id: roomId },
      data: { featuredFrom, featuredUntil },
    });
    if (count === 0) {
      throw roomNotFound();
    }
    return this.get(roomId);
  }

  async unfeature(roomId: string) {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.room.updateMany({
        where: {
          id: roomId,
          featuredFrom: { lt: now },
          featuredUntil: { gt: now },
        },
        data: { featuredUntil: now },
      });
      await transaction.room.updateMany({
        where: { id: roomId, featuredFrom: { gte: now } },
        data: { featuredFrom: null, featuredUntil: null },
      });
    });
    return this.get(roomId);
  }

  private async get(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: adminRoomSelect,
    });
    if (!room) {
      throw roomNotFound();
    }
    return toAdminRoom(room, await this.listedIds([room.id]), new Date());
  }

  private async listedIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const listed = await this.prisma.room.findMany({
      where: { id: { in: ids }, ...listedRoomWhere },
      select: { id: true },
    });
    return new Set(listed.map((room) => room.id));
  }
}

function toAdminRoom(room: AdminRoomRow, listed: Set<string>, now: Date) {
  return {
    ...room,
    listed: listed.has(room.id),
    featuringStatus: featuringStatusOf(room, now),
  };
}

function roomNotFound() {
  return new NotFoundException('Quarto não encontrado.');
}
