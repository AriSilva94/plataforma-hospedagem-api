import {
  Prisma,
  PropertyStatus,
  RoomStatus,
  UserStatus,
} from '../generated/prisma/client';

export const listedPropertyWhere = {
  status: PropertyStatus.ACTIVE,
  ownerProfile: { user: { status: UserStatus.ACTIVE } },
} satisfies Prisma.PropertyWhereInput;

export const visiblePropertyWhere = {
  ...listedPropertyWhere,
  rooms: { some: { status: RoomStatus.AVAILABLE } },
} satisfies Prisma.PropertyWhereInput;

export const listedRoomWhere = {
  status: RoomStatus.AVAILABLE,
  property: listedPropertyWhere,
} satisfies Prisma.RoomWhereInput;
