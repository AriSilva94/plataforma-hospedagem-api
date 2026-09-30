import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MediaType,
  Prisma,
  PropertyStatus,
  RoomStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { ListPublicPropertiesDto } from './dto/list-public-properties.dto';

const mediaOrder: Prisma.PropertyMediaOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' },
];

const listedProperty = {
  status: PropertyStatus.ACTIVE,
  rooms: { some: { status: RoomStatus.AVAILABLE } },
} satisfies Prisma.PropertyWhereInput;

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

  async list({ featured, page, limit }: ListPublicPropertiesDto) {
    const where: Prisma.PropertyWhereInput = {
      ...listedProperty,
      ...(featured === undefined ? {} : { featured }),
    };
    const total = await this.prisma.property.count({ where });
    const properties = await this.prisma.property.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        title: true,
        type: true,
        featured: true,
        neighborhood: true,
        city: true,
        state: true,
        media: {
          where: { type: MediaType.IMAGE },
          orderBy: mediaOrder,
          take: 1,
        },
        rooms: {
          where: { status: RoomStatus.AVAILABLE },
          orderBy: { priceCents: 'asc' },
          take: 1,
          select: { priceCents: true },
        },
      },
    });

    return {
      items: properties.map(({ media, rooms, ...property }) => ({
        ...property,
        coverUrl: this.mediaService.coverUrl(media),
        startingPriceCents: rooms[0].priceCents,
      })),
      page,
      limit,
      total,
    };
  }

  async get(propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...listedProperty },
      select: publicDetailSelect,
    });
    if (!property) {
      throw new NotFoundException('Imóvel não encontrado.');
    }

    return {
      ...property,
      media: property.media.map((item) => this.mediaService.toResponse(item)),
      rooms: property.rooms.map((room) => ({
        ...room,
        media: room.media.map((item) => this.mediaService.toResponse(item)),
      })),
    };
  }
}
