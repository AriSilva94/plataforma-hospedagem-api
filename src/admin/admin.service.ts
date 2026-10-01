import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PropertyStatus,
  Role,
  RoomStatus,
  UserStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  listedRoomWhere,
  visiblePropertyWhere,
} from '../properties/public-listing';
import { activeFeaturingWhere } from '../rooms/room-featuring';
import { ListAdminPropertiesDto } from './dto/list-admin-properties.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';

export const LOW_COMPLETENESS_THRESHOLD = 50;
const NEW_USERS_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const newUsersSince = new Date(
      now.getTime() - NEW_USERS_WINDOW_DAYS * DAY_MS,
    );
    const user = this.prisma.user;
    const room = this.prisma.room;

    const [
      usersTotal,
      usersInactive,
      guests,
      owners,
      admins,
      newUsers,
      propertiesByStatus,
      listedProperties,
      roomsByStatus,
      listedRooms,
      listedCompleteness,
      lowCompletenessRooms,
      activeFeaturings,
      scheduledFeaturings,
    ] = await Promise.all([
      user.count(),
      user.count({ where: { status: UserStatus.INACTIVE } }),
      user.count({ where: { roles: { has: Role.GUEST } } }),
      user.count({ where: { roles: { has: Role.OWNER } } }),
      user.count({ where: { roles: { has: Role.ADMIN } } }),
      user.count({ where: { createdAt: { gte: newUsersSince } } }),
      this.prisma.property.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.property.count({ where: visiblePropertyWhere }),
      room.groupBy({ by: ['status'], _count: { _all: true } }),
      room.count({ where: listedRoomWhere }),
      room.aggregate({
        where: listedRoomWhere,
        _avg: { completenessScore: true },
      }),
      room.count({
        where: {
          ...listedRoomWhere,
          completenessScore: { lt: LOW_COMPLETENESS_THRESHOLD },
        },
      }),
      room.count({ where: activeFeaturingWhere(now) }),
      room.count({ where: { featuredFrom: { gt: now } } }),
    ]);

    const propertyCount = countBy(propertiesByStatus, PropertyStatus);
    const roomCount = countBy(roomsByStatus, RoomStatus);

    return {
      users: {
        total: usersTotal,
        inactive: usersInactive,
        guests,
        owners,
        admins,
        newLast7Days: newUsers,
      },
      properties: {
        total: sum(propertyCount),
        active: propertyCount.ACTIVE,
        unavailable: propertyCount.UNAVAILABLE,
        draft: propertyCount.DRAFT,
        listed: listedProperties,
      },
      rooms: {
        total: sum(roomCount),
        available: roomCount.AVAILABLE,
        unavailable: roomCount.UNAVAILABLE,
        inactive: roomCount.INACTIVE,
        listed: listedRooms,
        averageListedCompleteness:
          listedCompleteness._avg.completenessScore === null
            ? null
            : Math.round(listedCompleteness._avg.completenessScore),
        lowCompletenessListed: lowCompletenessRooms,
        lowCompletenessThreshold: LOW_COMPLETENESS_THRESHOLD,
      },
      featuring: {
        active: activeFeaturings,
        scheduled: scheduledFeaturings,
      },
    };
  }

  async users({ q, role, status, page, limit }: ListAdminUsersDto) {
    const where: Prisma.UserWhereInput = {
      AND: [
        q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        role ? { roles: { has: role } } : {},
        status ? { status } : {},
      ],
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          roles: true,
          createdAt: true,
          ownerProfile: {
            select: { _count: { select: { properties: true } } },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(({ ownerProfile, ...item }) => ({
        ...item,
        propertyCount: ownerProfile?._count.properties ?? 0,
      })),
      page,
      limit,
      total,
    };
  }

  async properties({ q, status, page, limit }: ListAdminPropertiesDto) {
    const where: Prisma.PropertyWhereInput = {
      AND: [
        q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                {
                  ownerProfile: {
                    user: {
                      OR: [
                        { name: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {},
        status ? { status } : {},
      ],
    };
    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          city: true,
          state: true,
          createdAt: true,
          ownerProfile: {
            select: { user: { select: { name: true, email: true } } },
          },
          _count: { select: { rooms: true } },
        },
      }),
      this.prisma.property.count({ where }),
    ]);
    const ids = properties.map((property) => property.id);
    const [listed, availableRooms] = await Promise.all([
      this.prisma.property.findMany({
        where: { id: { in: ids }, ...visiblePropertyWhere },
        select: { id: true },
      }),
      this.prisma.room.groupBy({
        by: ['propertyId'],
        where: { propertyId: { in: ids }, status: RoomStatus.AVAILABLE },
        _count: { _all: true },
      }),
    ]);
    const listedIds = new Set(listed.map((property) => property.id));
    const availableByProperty = new Map(
      availableRooms.map((group) => [group.propertyId, group._count._all]),
    );

    return {
      items: properties.map(({ ownerProfile, _count, ...property }) => ({
        ...property,
        owner: ownerProfile.user,
        roomCount: _count.rooms,
        availableRoomCount: availableByProperty.get(property.id) ?? 0,
        listed: listedIds.has(property.id),
      })),
      page,
      limit,
      total,
    };
  }
}

function countBy<T extends string>(
  groups: { status: T; _count: { _all: number } }[],
  statuses: Record<string, T>,
): Record<T, number> {
  const counts = Object.fromEntries(
    Object.values(statuses).map((status) => [status, 0]),
  ) as Record<T, number>;
  for (const group of groups) {
    counts[group.status] = group._count._all;
  }
  return counts;
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
