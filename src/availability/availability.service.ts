import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { listedRoomWhere } from '../properties/public-listing';
import {
  availabilityWindowEnd,
  isValidIsoDate,
  normalizeAvailability,
  todayInSaoPaulo,
} from './availability-rules';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  ownerGet(userId: string, roomId: string) {
    return this.read({ id: roomId, property: { ownerProfile: { userId } } });
  }

  async ownerReplace(
    userId: string,
    roomId: string,
    dto: UpdateAvailabilityDto,
  ) {
    const today = todayInSaoPaulo();
    const windowEnd = availabilityWindowEnd(today);
    for (const date of dto.blockedDates) {
      if (!isValidIsoDate(date)) {
        throw new BadRequestException('Data inválida.');
      }
      if (date < today || date > windowEnd) {
        throw new BadRequestException('Data fora do período permitido.');
      }
    }
    const { blockedWeekdays, blockedDates } = normalizeAvailability(dto);

    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.room.updateMany({
        where: { id: roomId, property: { ownerProfile: { userId } } },
        data: { blockedWeekdays },
      });
      if (updated.count === 0) {
        throw roomNotFound();
      }
      await transaction.roomBlockedDate.deleteMany({
        where: { roomId, date: { gte: toDate(today) } },
      });
      await transaction.roomBlockedDate.createMany({
        data: blockedDates.map((date) => ({ roomId, date: toDate(date) })),
      });
    });
    return this.ownerGet(userId, roomId);
  }

  publicGet(roomId: string) {
    return this.read({ id: roomId, ...listedRoomWhere });
  }

  private async read(where: Prisma.RoomWhereInput) {
    const today = todayInSaoPaulo();
    const room = await this.prisma.room.findFirst({
      where,
      select: {
        blockedWeekdays: true,
        blockedDates: {
          where: { date: { gte: toDate(today) } },
          orderBy: { date: 'asc' },
          select: { date: true },
        },
      },
    });
    if (!room) {
      throw roomNotFound();
    }
    const windowEnd = availabilityWindowEnd(today);
    return {
      today,
      windowEnd,
      blockedWeekdays: [...room.blockedWeekdays].sort((a, b) => a - b),
      blockedDates: room.blockedDates
        .map(({ date }) => toIsoDate(date))
        .filter((date) => date <= windowEnd),
    };
  }
}

const roomNotFound = () => new NotFoundException('Quarto não encontrado.');
