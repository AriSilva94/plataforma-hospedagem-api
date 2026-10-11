import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Role, User } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
} from '../infrastructure/prisma/prisma-error';
import { isCityOfState } from '../locations/brazilian-cities';
import {
  ListingPersonalDataField,
  MINIMUM_AGE_YEARS,
  latestAdultBirthDate,
  listingPersonalDataSelect,
} from './personal-data';
import { toPublicUser } from './public-user';
import { UpdateGuestProfileDto } from './dto/update-guest-profile.dto';
import { UpdateMeDto } from './dto/update-me.dto';

const EARLIEST_BIRTH_DATE = new Date('1900-01-01');
const LISTING_PERSONAL_DATA_FIELDS: ListingPersonalDataField[] = [
  'phone',
  'birthDate',
  'city',
  'state',
];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { guestProfile: true, ownerProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return this.withProfiles(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const personalData = {
      phone: dto.phone,
      birthDate: this.parseBirthDate(dto.birthDate),
      city: dto.city,
      state: dto.state,
    };
    await this.assertPersonalDataAllowed(userId, personalData);

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name || undefined, ...personalData },
        include: { guestProfile: true, ownerProfile: true },
      });
      return this.withProfiles(user);
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundException('Usuário não encontrado.');
      }
      throw error;
    }
  }

  async addProfile(userId: string, role: 'GUEST' | 'OWNER') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const updatedUser = await transaction.user.updateMany({
          where: { id: userId, NOT: { roles: { has: role } } },
          data: { roles: { push: role } },
        });
        if (updatedUser.count !== 1) {
          return;
        }
        if (role === Role.GUEST) {
          await transaction.guestProfile.create({ data: { userId } });
        } else {
          await transaction.ownerProfile.create({ data: { userId } });
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    return this.getMe(userId);
  }

  async updateGuestProfile(userId: string, dto: UpdateGuestProfileDto) {
    try {
      await this.prisma.guestProfile.update({
        where: { userId },
        data: { genderIdentity: dto.genderIdentity },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundException('Perfil de hóspede não encontrado.');
      }
      throw error;
    }
    return this.getMe(userId);
  }

  private parseBirthDate(value: string | null | undefined) {
    if (value === undefined) {
      return undefined;
    }
    if (!value) {
      return null;
    }
    const birthDate = new Date(value);
    if (birthDate < EARLIEST_BIRTH_DATE) {
      throw new BadRequestException('Data de nascimento inválida.');
    }
    if (birthDate > latestAdultBirthDate(new Date())) {
      throw new BadRequestException(
        `É necessário ter pelo menos ${MINIMUM_AGE_YEARS} anos.`,
      );
    }
    return birthDate;
  }

  private async assertPersonalDataAllowed(
    userId: string,
    changes: {
      phone?: string | null;
      birthDate?: Date | null;
      city?: string | null;
      state?: string | null;
    },
  ) {
    const cleared = LISTING_PERSONAL_DATA_FIELDS.filter(
      (field) => changes[field] === null,
    );
    const changesLocation =
      changes.city !== undefined || changes.state !== undefined;
    if (cleared.length === 0 && !changesLocation) {
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...listingPersonalDataSelect,
        ownerProfile: {
          select: { _count: { select: { properties: true } } },
        },
      },
    });
    if (!user) {
      return;
    }
    if (
      user.ownerProfile?._count.properties &&
      cleared.some((field) => user[field] !== null)
    ) {
      throw new UnprocessableEntityException(
        'Telefone, data de nascimento, cidade e estado são obrigatórios para quem tem imóveis cadastrados.',
      );
    }

    const state = changes.state === undefined ? user.state : changes.state;
    const city = changes.city === undefined ? user.city : changes.city;
    if (city !== null && (state === null || !isCityOfState(state, city))) {
      throw new BadRequestException(
        'Selecione uma cidade do estado informado.',
      );
    }
  }

  private withProfiles(
    user: User & { guestProfile?: unknown; ownerProfile?: unknown },
  ) {
    return {
      ...toPublicUser(user),
      guestProfile: user.guestProfile,
      ownerProfile: user.ownerProfile,
    };
  }
}
