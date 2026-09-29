import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { isUniqueConstraintError } from '../infrastructure/prisma/prisma-error';
import { PublicUser, toPublicUser } from '../users/public-user';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from './email.service';
import { PasswordService } from './password.service';
import { AccessGrant, AuthTokens, TokenService } from './token.service';

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
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
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
            name: dto.name,
            email: dto.email,
            passwordHash,
            roles: [],
          },
        }),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma conta com este e-mail.');
      }
      throw error;
    }
    const tokens = await this.tokenService.createSession(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const isValidPassword =
      user?.passwordHash &&
      (await this.passwordService.verify(user.passwordHash, dto.password));

    if (!isValidPassword || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const tokens = await this.tokenService.createSession(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
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
      await transaction.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
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

  async refresh(refreshToken: string): Promise<AuthTokens | AccessGrant> {
    return this.tokenService.rotateSession(refreshToken);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.tokenService.revokeSession(refreshToken);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
