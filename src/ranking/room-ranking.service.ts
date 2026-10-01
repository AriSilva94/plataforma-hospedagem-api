import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MediaType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  CompletenessCriterion,
  CompletenessSnapshot,
  PROPERTY_COMPLETENESS_FIELDS,
  evaluateCompleteness,
} from './room-completeness';
import { RANKING_VERSION, rankingScoreFor } from './room-ranking';

type Client = Prisma.TransactionClient;

const imageCount = { where: { type: MediaType.IMAGE } };

const snapshotSelect = {
  id: true,
  description: true,
  amenities: true,
  additionalInfo: true,
  _count: { select: { media: imageCount } },
  property: {
    select: {
      description: true,
      houseRules: true,
      generalInfo: true,
      features: true,
      referencePoints: true,
      _count: { select: { sharedAreas: true, media: imageCount } },
    },
  },
} satisfies Prisma.RoomSelect;

type SnapshotRow = Prisma.RoomGetPayload<{ select: typeof snapshotSelect }>;

@Injectable()
export class RoomRankingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoomRankingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recalculateStale();
  }

  recalculateRoom(transaction: Client, roomId: string): Promise<number> {
    return this.recalculate(transaction, { id: roomId });
  }

  recalculateProperty(
    transaction: Client,
    propertyId: string,
  ): Promise<number> {
    return this.recalculate(transaction, { propertyId });
  }

  async recalculatePropertyIfChanged(
    transaction: Client,
    propertyId: string,
    changes: Partial<
      Record<(typeof PROPERTY_COMPLETENESS_FIELDS)[number], unknown>
    >,
  ): Promise<void> {
    if (
      PROPERTY_COMPLETENESS_FIELDS.some((field) => changes[field] !== undefined)
    ) {
      await this.recalculateProperty(transaction, propertyId);
    }
  }

  async missingCompleteness(roomId: string): Promise<CompletenessCriterion[]> {
    const room = await this.prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: snapshotSelect,
    });
    return evaluateCompleteness(toSnapshot(room)).missing;
  }

  async recalculateStale(): Promise<number> {
    const stale = await this.prisma.room.findMany({
      where: { rankingVersion: { lt: RANKING_VERSION } },
      select: { propertyId: true },
      distinct: ['propertyId'],
    });

    let updated = 0;
    for (const { propertyId } of stale) {
      try {
        updated += await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT id FROM properties WHERE id = ${propertyId}::uuid FOR UPDATE`;
          return this.recalculate(transaction, {
            propertyId,
            rankingVersion: { lt: RANKING_VERSION },
          });
        });
      } catch (error) {
        this.logger.error(
          `Falha ao recalcular o ranking dos quartos do imóvel ${propertyId}.`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (stale.length > 0) {
      this.logger.log(
        `Ranking v${RANKING_VERSION} recalculado para ${updated} quartos desatualizados.`,
      );
    }
    return updated;
  }

  private async recalculate(
    transaction: Client,
    where: Prisma.RoomWhereInput,
  ): Promise<number> {
    const rooms = await transaction.room.findMany({
      where,
      select: snapshotSelect,
    });
    if (rooms.length === 0) {
      return 0;
    }

    const values = rooms.map((room) => {
      const { score } = evaluateCompleteness(toSnapshot(room));
      const ranking = rankingScoreFor({ completenessScore: score });
      return Prisma.sql`(${room.id}::uuid, ${score}::int, ${ranking}::int)`;
    });

    return transaction.$executeRaw`
      UPDATE rooms AS r
      SET completeness_score = v.completeness_score,
          ranking_score = v.ranking_score,
          ranking_version = ${RANKING_VERSION},
          ranking_updated_at = now() AT TIME ZONE 'UTC'
      FROM (VALUES ${Prisma.join(values)}) AS v(id, completeness_score, ranking_score)
      WHERE r.id = v.id`;
  }
}

function toSnapshot(room: SnapshotRow): CompletenessSnapshot {
  return {
    room: {
      description: room.description,
      amenities: room.amenities,
      additionalInfo: room.additionalInfo,
      imageCount: room._count.media,
    },
    property: {
      description: room.property.description,
      houseRules: room.property.houseRules,
      generalInfo: room.property.generalInfo,
      features: room.property.features,
      referencePoints: room.property.referencePoints,
      sharedAreaCount: room.property._count.sharedAreas,
      imageCount: room.property._count.media,
    },
  };
}
