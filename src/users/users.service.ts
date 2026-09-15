import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
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

    return this.toPublicUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const data = {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
    };

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
      });
      return this.toPublicUser(user);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma conta com este e-mail.');
      }
      if (this.isNotFoundError(error)) {
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

    if (user.roles.includes(role)) {
      return this.getMe(userId);
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: { roles: { push: role } },
      });
      if (role === Role.GUEST) {
        await transaction.guestProfile.create({ data: { userId } });
      } else {
        await transaction.ownerProfile.create({ data: { userId } });
      }
    });

    return this.getMe(userId);
  }

  private toPublicUser(
    user: User & { guestProfile?: unknown; ownerProfile?: unknown },
  ) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      roles: user.roles,
      guestProfile: user.guestProfile,
      ownerProfile: user.ownerProfile,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private isNotFoundError(error: unknown): error is { code: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2025'
    );
  }
}
