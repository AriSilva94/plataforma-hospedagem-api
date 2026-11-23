import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  RoomStatus,
  RoomVerificationStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { resolveHouseServices } from '../common/house-services';
import { visiblePropertyWhere } from './public-listing';
import { bedSelection } from '../rooms/room-catalog';
import {
  availabilityWindowEnd,
  isRangeFree,
  isValidIsoDate,
  toDbDate,
  todayInSaoPaulo,
} from '../availability/availability-rules';
import { PublicPropertyQueryDto } from './dto/public-property-query.dto';

type Period = { checkIn: string; checkOut: string };

const consultedPeriod = ({
  checkIn,
  checkOut = checkIn,
}: PublicPropertyQueryDto): Period | null =>
  checkIn &&
  checkOut &&
  isValidIsoDate(checkIn) &&
  isValidIsoDate(checkOut) &&
  checkOut >= checkIn
    ? { checkIn, checkOut }
    : null;

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
  hasCleaner: true,
  cleaningFrequency: true,
  smokingPolicy: true,
  sharedBathroomCount: true,
  sharedAreas: {
    orderBy: { position: 'asc' },
    select: {
      type: true,
      label: true,
      description: true,
      media: { orderBy: mediaOrder },
    },
  },
  sharedBathrooms: {
    orderBy: { position: 'asc' },
    select: { position: true, media: true },
  },
  media: { orderBy: mediaOrder },
  ownerProfile: {
    select: {
      id: true,
      createdAt: true,
      user: { select: { name: true, avatarKey: true } },
    },
  },
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
      hasCleaner: true,
      cleaningFrequency: true,
      smokingPolicy: true,
      verificationStatus: true,
      blockedWeekdays: true,
      beds: bedSelection,
      media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  },
} satisfies Prisma.PropertySelect;

const publicDetailSelectFor = ({ checkIn, checkOut }: Period) =>
  ({
    ...publicDetailSelect,
    rooms: {
      ...publicDetailSelect.rooms,
      select: {
        ...publicDetailSelect.rooms.select,
        blockedDates: {
          where: { date: { gte: toDbDate(checkIn), lte: toDbDate(checkOut) } },
          select: { date: true },
        },
      },
    },
  }) satisfies Prisma.PropertySelect;

@Injectable()
export class PublicPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async get(propertyId: string, query: PublicPropertyQueryDto = {}) {
    const today = todayInSaoPaulo();
    const period = consultedPeriod(query);
    const evaluated = period ?? { checkIn: today, checkOut: today };
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...visiblePropertyWhere },
      select: publicDetailSelectFor(evaluated),
    });
    if (!property) {
      throw new NotFoundException('Imóvel não encontrado.');
    }

    const { ownerProfile, ...rest } = property;

    return {
      ...rest,
      host: {
        id: ownerProfile.id,
        name: ownerProfile.user.name,
        avatarUrl: this.mediaService.publicUrl(ownerProfile.user.avatarKey),
        since: ownerProfile.createdAt,
      },
      availability: {
        today,
        windowEnd: availabilityWindowEnd(today),
        period,
      },
      media: property.media.map((item) => this.mediaService.toResponse(item)),
      sharedAreas: property.sharedAreas.map(({ media, ...area }) => ({
        ...area,
        media: media.map((item) => this.mediaService.toResponse(item)),
      })),
      sharedBathrooms: property.sharedBathrooms.map(({ position, media }) => ({
        position,
        media: media ? [this.mediaService.toResponse(media)] : [],
      })),
      rooms: property.rooms.map(
        ({ verificationStatus, blockedWeekdays, blockedDates, ...room }) => ({
          ...room,
          ...resolveHouseServices(property, room),
          verified: verificationStatus === RoomVerificationStatus.VERIFIED,
          availabilityStatus: isRangeFree(
            evaluated.checkIn,
            evaluated.checkOut,
            {
              blockedWeekdays,
              blockedDates: blockedDates.map(({ date }) =>
                date.toISOString().slice(0, 10),
              ),
            },
            today,
          )
            ? ('AVAILABLE' as const)
            : ('BLOCKED' as const),
          media: room.media.map((item) => this.mediaService.toResponse(item)),
        }),
      ),
    };
  }
}
