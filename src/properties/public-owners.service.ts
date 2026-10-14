import { Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import {
  publicRoomCardSelect,
  toPublicRoomCard,
} from '../rooms/public-room-card';
import { listedRoomWhere } from './public-listing';

@Injectable()
export class PublicOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async get(ownerProfileId: string) {
    const owner = await this.prisma.ownerProfile.findFirst({
      where: { id: ownerProfileId, user: { status: UserStatus.ACTIVE } },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!owner) {
      throw new NotFoundException('Anfitrião não encontrado.');
    }

    const rooms = await this.prisma.room.findMany({
      where: { AND: [listedRoomWhere, { property: { ownerProfileId } }] },
      orderBy: [{ rankingScore: 'desc' }, { id: 'asc' }],
      select: publicRoomCardSelect,
    });

    return {
      id: owner.id,
      name: owner.user.name,
      rooms: rooms.map((room) =>
        toPublicRoomCard(this.mediaService, room, false),
      ),
    };
  }
}
