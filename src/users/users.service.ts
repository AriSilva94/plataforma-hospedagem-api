import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, User } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
} from '../infrastructure/prisma/prisma-error';
import { toPublicUser } from './public-user';
import { UpdateGuestProfileDto } from './dto/update-guest-profile.dto';
import { UpdateMeDto } from './dto/update-me.dto';

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
    const data = {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.email ? { email: dto.email } : {}),
    };

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
      });
      return this.withProfiles(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma conta com este e-mail.');
      }
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
