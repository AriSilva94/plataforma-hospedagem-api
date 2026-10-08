import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '../generated/prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { isUniqueConstraintError } from '../infrastructure/prisma/prisma-error';
import { PublicUser, toPublicUser } from '../users/public-user';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailQueue } from './email-queue';
import { EmailService } from './email.service';
import { PASSWORD_RESET_VALIDITY_MINUTES } from './password-reset.policy';
import { PasswordService } from './password.service';
import { AccessGrant, AuthTokens, TokenService } from './token.service';

export type AuthResult = AuthTokens & { user: PublicUser };

function minutes(value: number): number {
  return value * 60 * 1000;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly emailQueue: EmailQueue,
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
    await this.enqueueEmail(
      'boas-vindas',
      user.id,
      this.emailQueue.enqueueWelcome(user.id),
    );
    return { ...tokens, user: toPublicUser(user) };
  }

  private async enqueueEmail(
    description: string,
    userId: string,
    enqueued: Promise<void>,
  ): Promise<void> {
    try {
      await enqueued;
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar e-mail de ${description} para o usuário ${userId}: ${describeError(error)}`,
      );
    }
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
    await this.emailQueue.enqueuePasswordReset(dto.email);
  }

  async issuePasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await transaction.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });
      await transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(
            Date.now() + minutes(PASSWORD_RESET_VALIDITY_MINUTES),
          ),
        },
      });
    });

    await this.emailService.sendPasswordReset(user.email, token);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { status: true } } },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date() ||
      resetToken.user.status !== 'ACTIVE'
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
    await this.enqueueEmail(
      'aviso de senha alterada',
      resetToken.userId,
      this.emailQueue.enqueuePasswordChanged(resetToken.userId),
    );
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
