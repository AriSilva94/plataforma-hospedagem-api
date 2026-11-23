import {
  BadRequestException,
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
import { isCityOfState } from '../locations/brazilian-cities';
import { ReorderMediaDto } from '../media/dto/reorder-media.dto';
import {
  MediaService,
  UploadedMediaFile,
  nextPosition,
} from '../media/media.service';
import { evaluateCompleteness } from '../ranking/room-completeness';
import { RoomRankingService } from '../ranking/room-ranking.service';
import {
  hasListingPersonalData,
  listingPersonalDataSelect,
} from '../users/personal-data';
import { CreatePropertyDto } from './dto/create-property.dto';
import { ReplaceSharedAreasDto } from './dto/replace-shared-areas.dto';
import { ReplaceSharedBathroomsDto } from './dto/replace-shared-bathrooms.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { withConsistentCleaning } from '../common/house-services';
import {
  MAX_PROPERTY_IMAGES,
  MAX_PROPERTY_VIDEOS,
  MAX_SHARED_AREA_IMAGES,
} from './property-catalog';
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
  sharedAreas: {
    orderBy: { position: 'asc' },
    include: {
      media: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
    },
  },
  sharedBathrooms: { orderBy: { position: 'asc' }, include: { media: true } },
  media: { orderBy: mediaOrder },
  rooms: {
    orderBy: { createdAt: 'asc' },
    include: {
      media: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      },
      _count: {
        select: { media: { where: { type: MediaType.IMAGE } }, beds: true },
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
    private readonly roomRanking: RoomRankingService,
  ) {}

  async list(userId: string) {
    const properties = await this.prisma.property.findMany({
      where: { ownerProfile: { userId } },
      orderBy: { updatedAt: 'desc' },
      include: {
        media: { orderBy: mediaOrder, take: 1 },
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
        neighborhood: property.neighborhood,
        city: property.city,
        state: property.state,
        ...this.mediaService.cover(property.media),
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
      select: { id: true, user: { select: listingPersonalDataSelect } },
    });
    if (!ownerProfile) {
      throw new ForbiddenException(
        'Adicione o perfil de proprietário para cadastrar imóveis.',
      );
    }
    if (!hasListingPersonalData(ownerProfile.user)) {
      throw new UnprocessableEntityException(
        'Preencha telefone, data de nascimento, cidade e estado no seu perfil para cadastrar imóveis.',
      );
    }

    assertCityOfState(dto.state, dto.city);

    const property = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.property.create({
        data: {
          ...withConsistentCleaning(dto),
          ownerProfileId: ownerProfile.id,
        },
        select: { id: true },
      });
      await syncSharedBathroomCount(
        transaction,
        created.id,
        dto.sharedBathroomCount ?? 0,
      );
      return created;
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
    const removedKeys = await this.prisma.$transaction(async (transaction) => {
      const property = await this.lockOwned(transaction, userId, propertyId);
      const { state, city } = await transaction.property.update({
        where: { id: propertyId },
        data: withConsistentCleaning(dto),
        select: { state: true, city: true },
      });
      assertCityOfState(state, city);
      const keys =
        dto.sharedBathroomCount === undefined
          ? []
          : await syncSharedBathroomCount(
              transaction,
              propertyId,
              dto.sharedBathroomCount,
            );
      await this.assertListedComplete(transaction, property);
      await this.roomRanking.recalculatePropertyIfChanged(
        transaction,
        propertyId,
        dto,
      );
      return keys;
    });
    if (removedKeys.length > 0) {
      await this.mediaService.removeQuietly(removedKeys);
    }
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
      const sharedAreaMedia =
        await transaction.propertySharedAreaMedia.findMany({
          where: { sharedArea: { propertyId } },
          select: { storageKey: true },
        });
      const sharedBathroomMedia =
        await transaction.propertySharedBathroomMedia.findMany({
          where: { sharedBathroom: { propertyId } },
          select: { storageKey: true },
        });
      await transaction.property.delete({ where: { id: propertyId } });
      return [
        ...propertyMedia,
        ...roomMedia,
        ...sharedAreaMedia,
        ...sharedBathroomMedia,
      ].map((media) => media.storageKey);
    });
    await this.mediaService.removeQuietly(storageKeys);
  }

  async replaceSharedAreas(
    userId: string,
    propertyId: string,
    { areas }: ReplaceSharedAreasDto,
  ) {
    const removedKeys = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      const current = await transaction.propertySharedArea.findMany({
        where: { propertyId },
        select: { id: true },
      });
      const currentIds = new Set(current.map((area) => area.id));
      const keptIds = areas.flatMap((area) => (area.id ? [area.id] : []));
      if (
        new Set(keptIds).size !== keptIds.length ||
        keptIds.some((id) => !currentIds.has(id))
      ) {
        throw new BadRequestException('Área compartilhada inválida.');
      }
      const removedIds = [...currentIds].filter((id) => !keptIds.includes(id));
      const removedMedia = await transaction.propertySharedAreaMedia.findMany({
        where: { sharedAreaId: { in: removedIds } },
        select: { storageKey: true },
      });
      await transaction.propertySharedArea.deleteMany({
        where: { id: { in: removedIds } },
      });
      for (const [position, area] of areas.entries()) {
        const data = {
          type: area.type,
          label: area.label ?? null,
          description: area.description ?? null,
          position,
        };
        if (area.id) {
          await transaction.propertySharedArea.update({
            where: { id: area.id },
            data,
          });
        } else {
          await transaction.propertySharedArea.create({
            data: { ...data, propertyId },
          });
        }
      }
      await this.roomRanking.recalculateProperty(transaction, propertyId);
      return removedMedia.map((media) => media.storageKey);
    });
    if (removedKeys.length > 0) {
      await this.mediaService.removeQuietly(removedKeys);
    }
    return this.get(userId, propertyId);
  }

  async addSharedAreaMedia(
    userId: string,
    propertyId: string,
    sharedAreaId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.findOwned(userId, propertyId);
    await this.findOwnedSharedArea(this.prisma, propertyId, sharedAreaId);
    await this.mediaService.typeOf(file, [MediaType.IMAGE]);
    assertSharedAreaMediaLimit(
      await this.prisma.propertySharedAreaMedia.count({
        where: { sharedAreaId, type: MediaType.IMAGE },
      }),
    );
    const stored = await this.mediaService.store(
      file,
      `properties/${propertyId}/areas/${sharedAreaId}`,
      [MediaType.IMAGE],
    );

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwned(transaction, userId, propertyId);
        await this.findOwnedSharedArea(transaction, propertyId, sharedAreaId);
        const existing = await transaction.propertySharedAreaMedia.findMany({
          where: { sharedAreaId },
          select: { type: true, position: true },
        });
        assertSharedAreaMediaLimit(
          existing.filter((item) => item.type === MediaType.IMAGE).length,
        );
        return transaction.propertySharedAreaMedia.create({
          data: { ...stored, sharedAreaId, position: nextPosition(existing) },
        });
      });
      return this.mediaService.toResponse(media);
    } catch (error) {
      await this.mediaService.removeQuietly([stored.storageKey]);
      throw error;
    }
  }

  async reorderSharedAreaMedia(
    userId: string,
    propertyId: string,
    sharedAreaId: string,
    { mediaIds }: ReorderMediaDto,
  ) {
    const media = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      await this.findOwnedSharedArea(transaction, propertyId, sharedAreaId);
      const current = await transaction.propertySharedAreaMedia.findMany({
        where: { sharedAreaId },
        select: { id: true },
      });
      this.mediaService.assertCompleteOrder(
        current.map((item) => item.id),
        mediaIds,
      );
      for (const [position, id] of mediaIds.entries()) {
        await transaction.propertySharedAreaMedia.update({
          where: { id },
          data: { position },
        });
      }
      return transaction.propertySharedAreaMedia.findMany({
        where: { sharedAreaId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
    });
    return { media: media.map((item) => this.mediaService.toResponse(item)) };
  }

  async removeSharedAreaMedia(
    userId: string,
    propertyId: string,
    sharedAreaId: string,
    mediaId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      const media = await transaction.propertySharedAreaMedia.findFirst({
        where: { id: mediaId, sharedArea: { id: sharedAreaId, propertyId } },
        select: { id: true, storageKey: true },
      });
      if (!media) {
        throw new NotFoundException('Mídia não encontrada.');
      }
      await transaction.propertySharedAreaMedia.delete({
        where: { id: media.id },
      });
      return media.storageKey;
    });
    await this.mediaService.removeQuietly([storageKey]);
  }

  async replaceSharedBathrooms(
    userId: string,
    propertyId: string,
    { bathrooms }: ReplaceSharedBathroomsDto,
  ) {
    const removedKeys = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      const current = await transaction.propertySharedBathroom.findMany({
        where: { propertyId },
        select: { id: true },
      });
      const currentIds = new Set(current.map((bathroom) => bathroom.id));
      const keptIds = bathrooms.flatMap((bathroom) =>
        bathroom.id ? [bathroom.id] : [],
      );
      if (
        new Set(keptIds).size !== keptIds.length ||
        keptIds.some((id) => !currentIds.has(id))
      ) {
        throw new BadRequestException('Banheiro inválido.');
      }
      const removedIds = [...currentIds].filter((id) => !keptIds.includes(id));
      const removedMedia =
        await transaction.propertySharedBathroomMedia.findMany({
          where: { sharedBathroomId: { in: removedIds } },
          select: { storageKey: true },
        });
      await transaction.propertySharedBathroom.deleteMany({
        where: { id: { in: removedIds } },
      });
      for (const [position, bathroom] of bathrooms.entries()) {
        if (bathroom.id) {
          await transaction.propertySharedBathroom.update({
            where: { id: bathroom.id },
            data: { position },
          });
        } else {
          await transaction.propertySharedBathroom.create({
            data: { propertyId, position },
          });
        }
      }
      await transaction.property.update({
        where: { id: propertyId },
        data: { sharedBathroomCount: bathrooms.length },
      });
      await this.roomRanking.recalculateProperty(transaction, propertyId);
      return removedMedia.map((media) => media.storageKey);
    });
    if (removedKeys.length > 0) {
      await this.mediaService.removeQuietly(removedKeys);
    }
    return this.get(userId, propertyId);
  }

  async addSharedBathroomMedia(
    userId: string,
    propertyId: string,
    sharedBathroomId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.findOwned(userId, propertyId);
    await this.findOwnedSharedBathroom(
      this.prisma,
      propertyId,
      sharedBathroomId,
    );
    await this.mediaService.typeOf(file, [MediaType.IMAGE]);
    assertSharedBathroomWithoutPhoto(
      await this.prisma.propertySharedBathroomMedia.count({
        where: { sharedBathroomId },
      }),
    );
    const stored = await this.mediaService.store(
      file,
      `properties/${propertyId}/bathrooms/${sharedBathroomId}`,
      [MediaType.IMAGE],
    );

    try {
      const media = await this.prisma.$transaction(async (transaction) => {
        await this.lockOwned(transaction, userId, propertyId);
        await this.findOwnedSharedBathroom(
          transaction,
          propertyId,
          sharedBathroomId,
        );
        assertSharedBathroomWithoutPhoto(
          await transaction.propertySharedBathroomMedia.count({
            where: { sharedBathroomId },
          }),
        );
        return transaction.propertySharedBathroomMedia.create({
          data: { ...stored, sharedBathroomId, position: 0 },
        });
      });
      return this.mediaService.toResponse(media);
    } catch (error) {
      await this.mediaService.removeQuietly([stored.storageKey]);
      throw error;
    }
  }

  async removeSharedBathroomMedia(
    userId: string,
    propertyId: string,
    sharedBathroomId: string,
    mediaId: string,
  ): Promise<void> {
    const storageKey = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwned(transaction, userId, propertyId);
      const media = await transaction.propertySharedBathroomMedia.findFirst({
        where: {
          id: mediaId,
          sharedBathroom: { id: sharedBathroomId, propertyId },
        },
        select: { id: true, storageKey: true },
      });
      if (!media) {
        throw new NotFoundException('Mídia não encontrada.');
      }
      await transaction.propertySharedBathroomMedia.delete({
        where: { id: media.id },
      });
      return media.storageKey;
    });
    await this.mediaService.removeQuietly([storageKey]);
  }

  private async findOwnedSharedBathroom(
    client: Transaction,
    propertyId: string,
    sharedBathroomId: string,
  ): Promise<void> {
    const bathroom = await client.propertySharedBathroom.findFirst({
      where: { id: sharedBathroomId, propertyId },
      select: { id: true },
    });
    if (!bathroom) {
      throw new NotFoundException('Banheiro não encontrado.');
    }
  }

  private async findOwnedSharedArea(
    client: Transaction,
    propertyId: string,
    sharedAreaId: string,
  ): Promise<void> {
    const area = await client.propertySharedArea.findFirst({
      where: { id: sharedAreaId, propertyId },
      select: { id: true },
    });
    if (!area) {
      throw new NotFoundException('Área compartilhada não encontrada.');
    }
  }

  async addMedia(
    userId: string,
    propertyId: string,
    file: UploadedMediaFile | undefined,
  ) {
    await this.findOwned(userId, propertyId);
    const mediaType = await this.mediaService.typeOf(file, [
      MediaType.IMAGE,
      MediaType.VIDEO,
    ]);
    const currentCount = await this.prisma.propertyMedia.count({
      where: { propertyId, type: mediaType },
    });
    const currentLimit =
      mediaType === MediaType.IMAGE ? MAX_PROPERTY_IMAGES : MAX_PROPERTY_VIDEOS;
    if (currentCount >= currentLimit) {
      throw new UnprocessableEntityException(
        mediaType === MediaType.IMAGE
          ? `O imóvel pode ter no máximo ${currentLimit} fotos.`
          : `O imóvel pode ter no máximo ${currentLimit} vídeos.`,
      );
    }
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
        const created = await transaction.propertyMedia.create({
          data: {
            ...stored,
            propertyId,
            position: nextPosition(existing),
          },
        });
        await this.roomRanking.recalculateProperty(transaction, propertyId);
        return created;
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
      await this.roomRanking.recalculateProperty(transaction, propertyId);
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

  private toDetail({
    media,
    rooms,
    sharedAreas,
    sharedBathrooms,
    ...property
  }: PropertyDetail) {
    const propertyImageCount = media.filter(
      (item) => item.type === MediaType.IMAGE,
    ).length;
    return {
      ...property,
      sharedAreas: sharedAreas.map(({ media: areaMedia, ...area }) => ({
        ...area,
        media: areaMedia.map((item) => this.mediaService.toResponse(item)),
      })),
      sharedBathrooms: sharedBathrooms.map((bathroom) => ({
        id: bathroom.id,
        position: bathroom.position,
        media: bathroom.media
          ? [this.mediaService.toResponse(bathroom.media)]
          : [],
      })),
      missingRequirements: missingPublishRequirements({
        ...property,
        imageCount: propertyImageCount,
        listableRoomCount: rooms.filter(
          (room) => room.status !== RoomStatus.INACTIVE,
        ).length,
      }),
      media: media.map((item) => this.mediaService.toResponse(item)),
      rooms: rooms.map(({ media: roomMedia, _count, ...room }) => ({
        id: room.id,
        title: room.title,
        status: room.status,
        priceCents: room.priceCents,
        capacity: room.capacity,
        bathroomType: room.bathroomType,
        acceptedAudiences: room.acceptedAudiences,
        completenessScore: room.completenessScore,
        completenessMissing: evaluateCompleteness({
          room: {
            description: room.description,
            amenities: room.amenities,
            bedCount: _count.beds,
            additionalInfo: room.additionalInfo,
            imageCount: _count.media,
          },
          property: {
            description: property.description,
            houseRules: property.houseRules,
            generalInfo: property.generalInfo,
            features: property.features,
            referencePoints: property.referencePoints,
            sharedAreaCount: sharedAreas.length,
            sharedBathroomCount: property.sharedBathroomCount,
            imageCount: propertyImageCount,
          },
        }).missing,
        ...this.mediaService.cover(roomMedia),
        verificationStatus: room.verificationStatus,
        verificationRejectedReason: room.verificationRejectedReason,
      })),
    };
  }
}

async function syncSharedBathroomCount(
  transaction: Transaction,
  propertyId: string,
  count: number,
): Promise<string[]> {
  const current = await transaction.propertySharedBathroom.findMany({
    where: { propertyId },
    orderBy: { position: 'asc' },
    select: { id: true, media: { select: { storageKey: true } } },
  });
  const removed = current.slice(count);
  if (removed.length > 0) {
    await transaction.propertySharedBathroom.deleteMany({
      where: { id: { in: removed.map((bathroom) => bathroom.id) } },
    });
  }
  if (count > current.length) {
    await transaction.propertySharedBathroom.createMany({
      data: Array.from({ length: count - current.length }, (_, index) => ({
        propertyId,
        position: current.length + index,
      })),
    });
  }
  return removed.flatMap((bathroom) =>
    bathroom.media ? [bathroom.media.storageKey] : [],
  );
}

function assertSharedBathroomWithoutPhoto(photoCount: number) {
  if (photoCount > 0) {
    throw new UnprocessableEntityException(
      'Cada banheiro pode ter apenas 1 foto. Remova a atual para enviar outra.',
    );
  }
}

function assertSharedAreaMediaLimit(imageCount: number) {
  if (imageCount >= MAX_SHARED_AREA_IMAGES) {
    throw new UnprocessableEntityException(
      'Cada área pode ter apenas 1 foto. Remova a atual para enviar outra.',
    );
  }
}

function propertyNotFound() {
  return new NotFoundException('Imóvel não encontrado.');
}

function assertCityOfState(
  state: string | null | undefined,
  city: string | null | undefined,
) {
  if (city && (!state || !isCityOfState(state, city))) {
    throw new BadRequestException('Selecione uma cidade do estado informado.');
  }
}
