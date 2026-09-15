import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from './email.service';
import { PasswordService } from './password.service';
import { AuthTokens, TokenService } from './token.service';

type PublicUser = Pick<
  User,
  'id' | 'name' | 'email' | 'status' | 'roles' | 'createdAt' | 'updatedAt'
>;

export type AuthResult = AuthTokens & { user: PublicUser };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (transaction) =>
        transaction.user.create({
          data: {
            name: dto.name.trim(),
            email,
            passwordHash,
            roles: [dto.role],
            ...(dto.role === Role.GUEST
              ? { guestProfile: { create: {} } }
              : { ownerProfile: { create: {} } }),
          },
        }),
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma conta com este e-mail.');
      }
      throw error;
    }
    const tokens = await this.tokenService.createSession(user);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const isValidPassword =
      user &&
      (await this.passwordService.verify(user.passwordHash, dto.password));

    if (!isValidPassword || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const tokens = await this.tokenService.createSession(user);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await this.emailService.sendPasswordReset(user.email, token);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        'O link de redefinição é inválido ou expirou.',
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    await this.prisma.$transaction(async (transaction) => {
      const consumedToken = await transaction.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumedToken.count !== 1) {
        throw new UnauthorizedException(
          'O link de redefinição é inválido ou expirou.',
        );
      }
      await transaction.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await transaction.authSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokenService.rotateSession(refreshToken);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.tokenService.revokeSession(refreshToken);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      roles: user.roles,
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
}
