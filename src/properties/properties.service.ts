import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaType,
  Prisma,
  PropertyStatus,
  RoomStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ReorderMediaDto } from '../media/dto/reorder-media.dto';
import {
  MediaService,
  UploadedMediaFile,
  nextPosition,
} from '../media/media.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ReplaceSharedAreasDto } from './dto/replace-shared-areas.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { MAX_PROPERTY_IMAGES, MAX_PROPERTY_VIDEOS } from './property-catalog';
import {
  missingPublishRequirements,
  publishRequirementLabels,
} from './property-publish';

type Transaction = Prisma.TransactionClient;
type LockedProperty = { id: string; status: PropertyStatus };

const mediaOrder: Prisma.PropertyMediaOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' },
];

const propertyDetailInclude = {
  sharedAreas: { orderBy: { position: 'asc' } },
  media: { orderBy: mediaOrder },
  rooms: {
    orderBy: { createdAt: 'asc' },
    include: {
      media: {
        where: { type: MediaType.IMAGE },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      },
    },
  },
} satisfies Prisma.PropertyInclude;

const propertyOmit = { ownerProfileId: true } satisfies Prisma.PropertyOmit;

type PropertyDetail = Prisma.PropertyGetPayload<{
  include: typeof propertyDetailInclude;
  omit: typeof propertyOmit;
}>;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async list(userId: string) {
    const properties = await this.prisma.property.findMany({
      where: { ownerProfile: { userId } },
      orderBy: { updatedAt: 'desc' },
      include: {
        media: {
          where: { type: MediaType.IMAGE },
          orderBy: mediaOrder,
          take: 1,
        },
        rooms: { select: { status: true, priceCents: true } },
      },
    });

    return properties.map((property) => {
      const availablePrices = property.rooms
        .filter((room) => room.status === RoomStatus.AVAILABLE)
        .map((room) => room.priceCents);
      return {
        id: property.id,
        title: property.title,
        type: property.type,
        status: property.status,
        featured: property.featured,
        neighborhood: property.neighborhood,
        city: property.city,
        state: property.state,
        coverUrl: this.mediaService.coverUrl(property.media),
        roomCount: property.rooms.length,
        availableRoomCount: availablePrices.length,
        minAvailablePriceCents:
          availablePrices.length > 0 ? Math.min(...availablePrices) : null,
        updatedAt: property.updatedAt,
      };
    });
  }

  async create(userId: string, dto: CreatePropertyDto) {
    const ownerProfile = await this.prisma.ownerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ownerProfile) {
      throw new ForbiddenException(
        'Adicione o perfil de proprietário para cadastrar imóveis.',
      );
    }

    const property = await this.prisma.property.create({
      data: { ...dto, ownerProfileId: ownerProfile.id },
      select: { id: true },
    });
    return this.get(userId, property.id);
  }

  async get(userId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerProfile: { userId } },
      include: propertyDetailInclude,
      omit: propertyOmit,
    });
    if (!property) {
      throw propertyNotFound();
    }
    return this.toDetail(property);
  }

  async update(userId: string, propertyId: string, dto: UpdatePropertyDto) {
    await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwned(transaction, userId, propertyId);
      await transaction.property.update({
        where: { id: propertyId },
        data: dto,
      });
      await this.assertListedComplete(transaction, property);
    });
    return this.get(userId, propertyId);
  }

  async updateStatus(
    userId: string,
    propertyId: string,
    status: PropertyStatus,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwned(transaction, userId, propertyId);
      if (property.status === status) {
        return;
      }
      if (status === PropertyStatus.DRAFT) {
        throw new UnprocessableEntityException(
          'Um imóvel publicado não pode voltar a ser rascunho.',
        );
      }
      if (
        status === PropertyStatus.UNAVAILABLE &&
        property.status !== PropertyStatus.ACTIVE
      ) {
        throw new UnprocessableEntityException(
          'Somente imóveis ativos podem ficar indisponíveis.',
        );
      }
      if (status === PropertyStatus.ACTIVE) {
        await this.assertComplete(
          transaction,
          propertyId,
          'Para ativar o imóvel, informe',
        );
      }
      await transaction.property.update({
        where: { id: propertyId },
        data: { status },
      });
    });
    return this.get(userId, propertyId);
  }

  async remove(userId: string, propertyId: string): Promise<void> {
    const storageKeys = await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwned(transaction, userId, propertyId);
      if (property.status !== PropertyStatus.DRAFT) {
        throw new UnprocessableEntityException(
          'Somente rascunhos podem ser excluídos. Marque o imóvel como indisponível.',
        );
      }
      const propertyMedia = await transaction.propertyMedia.findMany({
        where: { propertyId },
        select: { storageKey: true },
      });
      const roomMedia = await transaction.roomMedia.findMany({
        where: { room: { propertyId } },
        select: { storageKey: true },
      });
      await transaction.property.delete({ where: { id: propertyId } });
      return [...propertyMedia, ...roomMedia].map((media) => media.storageKey);
    });
    await this.mediaService.removeQuietly(storageKeys);
  }

  async replaceSharedAreas(
    userId: string,
    propertyId: string,
    { areas }: ReplaceSharedAreasDto,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      await transaction.propertySharedArea.deleteMany({
        where: { propertyId },
      });
      await transaction.propertySharedArea.createMany({
        data: areas.map((area, position) => ({
          propertyId,
          type: area.type,
          label: area.label ?? null,
          description: area.description ?? null,
          position,
        })),
      });
    });
    return this.get(userId, propertyId);
  }

  async addMedia(
    userId: string,
    propertyId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.findOwned(userId, propertyId);
    const stored = await this.mediaService.store(
      file,
      `properties/${propertyId}`,
      [MediaType.IMAGE, MediaType.VIDEO],
    );

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwned(transaction, userId, propertyId);
        const existing = await transaction.propertyMedia.findMany({
          where: { propertyId },
          select: { type: true, position: true },
        });
        const sameType = existing.filter((item) => item.type === stored.type);
        const limit =
          stored.type === MediaType.IMAGE
            ? MAX_PROPERTY_IMAGES
            : MAX_PROPERTY_VIDEOS;
        if (sameType.length >= limit) {
          throw new UnprocessableEntityException(
            stored.type === MediaType.IMAGE
              ? `O imóvel pode ter no máximo ${limit} fotos.`
              : `O imóvel pode ter no máximo ${limit} vídeos.`,
          );
        }
        return transaction.propertyMedia.create({
          data: {
            ...stored,
            propertyId,
            position: nextPosition(existing),
          },
        });
      });
      return this.mediaService.toResponse(media);
    } catch (error) {
      await this.mediaService.removeQuietly([stored.storageKey]);
      throw error;
    }
  }

  async reorderMedia(
    userId: string,
    propertyId: string,
    { mediaIds }: ReorderMediaDto,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      const current = await transaction.propertyMedia.findMany({
        where: { propertyId },
        select: { id: true },
      });
      this.mediaService.assertCompleteOrder(
        current.map((media) => media.id),
        mediaIds,
      );
      for (const [position, id] of mediaIds.entries()) {
        await transaction.propertyMedia.update({
          where: { id },
          data: { position },
        });
      }
    });
    return this.get(userId, propertyId);
  }

  async removeMedia(
    userId: string,
    propertyId: string,
    mediaId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwned(transaction, userId, propertyId);
      const media = await transaction.propertyMedia.findFirst({
        where: { id: mediaId, propertyId },
        select: { id: true, storageKey: true },
      });
      if (!media) {
        throw new NotFoundException('Mídia não encontrada.');
      }
      await transaction.propertyMedia.delete({ where: { id: media.id } });
      await this.assertListedComplete(transaction, property);
      return media.storageKey;
    });
    await this.mediaService.removeQuietly([storageKey]);
  }

  async findOwned(userId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerProfile: { userId } },
      select: { id: true, status: true },
    });
    if (!property) {
      throw propertyNotFound();
    }
    return property;
  }

  async lockOwned(
    transaction: Transaction,
    userId: string,
    propertyId: string,
  ): Promise<LockedProperty> {
    const [property] = await transaction.$queryRaw<LockedProperty[]>`
      SELECT p.id, p.status
      FROM properties p
      JOIN owner_profiles o ON o.id = p.owner_profile_id
      WHERE p.id = ${propertyId}::uuid AND o.user_id = ${userId}::uuid
      FOR UPDATE OF p`;
    if (!property) {
      throw propertyNotFound();
    }
    return property;
  }

  async assertListedComplete(
    transaction: Transaction,
    property: LockedProperty,
  ): Promise<void> {
    if (property.status !== PropertyStatus.DRAFT) {
      await this.assertComplete(
        transaction,
        property.id,
        'Um imóvel publicado precisa manter',
      );
    }
  }

  private async assertComplete(
    transaction: Transaction,
    propertyId: string,
    prefix: string,
  ): Promise<void> {
    const property = await transaction.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: {
        description: true,
        postalCode: true,
        street: true,
        number: true,
        neighborhood: true,
        city: true,
        state: true,
      },
    });
    const imageCount = await transaction.propertyMedia.count({
      where: { propertyId, type: MediaType.IMAGE },
    });
    const listableRoomCount = await transaction.room.count({
      where: { propertyId, status: { not: RoomStatus.INACTIVE } },
    });

    const missing = missingPublishRequirements({
      ...property,
      imageCount,
      listableRoomCount,
    });

    if (missing.length > 0) {
      throw new UnprocessableEntityException(
        `${prefix}: ${missing.map((item) => publishRequirementLabels[item]).join(', ')}.`,
      );
    }
  }

  private toDetail({ media, rooms, ...property }: PropertyDetail) {
    return {
      ...property,
      missingRequirements: missingPublishRequirements({
        ...property,
        imageCount: media.filter((item) => item.type === MediaType.IMAGE)
          .length,
        listableRoomCount: rooms.filter(
          (room) => room.status !== RoomStatus.INACTIVE,
        ).length,
      }),
      media: media.map((item) => this.mediaService.toResponse(item)),
      rooms: rooms.map(({ media: roomMedia, ...room }) => ({
        id: room.id,
        title: room.title,
        status: room.status,
        priceCents: room.priceCents,
        capacity: room.capacity,
        bathroomType: room.bathroomType,
        acceptedAudiences: room.acceptedAudiences,
        coverUrl: this.mediaService.coverUrl(roomMedia),
      })),
    };
  }
}

function propertyNotFound() {
  return new NotFoundException('Imóvel não encontrado.');
}
