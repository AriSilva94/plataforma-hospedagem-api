import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  RoomStatus,
  RoomVerificationStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { visiblePropertyWhere } from './public-listing';

const mediaOrder: Prisma.PropertyMediaOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' },
];

const publicDetailSelect = {
  id: true,
  title: true,
  type: true,
  description: true,
  houseRules: true,
  generalInfo: true,
  features: true,
  neighborhood: true,
  city: true,
  state: true,
  referencePoints: true,
  sharedAreas: {
    orderBy: { position: 'asc' },
    select: { type: true, label: true, description: true },
  },
  media: { orderBy: mediaOrder },
  ownerProfile: { select: { id: true, user: { select: { name: true } } } },
  rooms: {
    where: { status: RoomStatus.AVAILABLE },
    orderBy: [{ priceCents: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      priceCents: true,
      capacity: true,
      bathroomType: true,
      acceptedAudiences: true,
      amenities: true,
      additionalInfo: true,
      verificationStatus: true,
      media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  },
} satisfies Prisma.PropertySelect;

@Injectable()
export class PublicPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async get(propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...visiblePropertyWhere },
      select: publicDetailSelect,
    });
    if (!property) {
      throw new NotFoundException('Imóvel não encontrado.');
    }

    const { ownerProfile, ...rest } = property;

    return {
      ...rest,
      host: { id: ownerProfile.id, name: ownerProfile.user.name },
      media: property.media.map((item) => this.mediaService.toResponse(item)),
      rooms: property.rooms.map(({ verificationStatus, ...room }) => ({
        ...room,
        verified: verificationStatus === RoomVerificationStatus.VERIFIED,
        media: room.media.map((item) => this.mediaService.toResponse(item)),
      })),
    };
  }
}
