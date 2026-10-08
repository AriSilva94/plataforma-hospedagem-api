import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PublicUser, toPublicUser } from '../users/public-user';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailQueue } from './email-queue';
import { EMAIL_VERIFICATION_VALIDITY_MINUTES } from './email-verification.policy';
import { EmailService } from './email.service';
import { generateToken, hashToken, minutesFromNow } from './one-time-token';
import { PASSWORD_RESET_VALIDITY_MINUTES } from './password-reset.policy';
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
    private readonly emailQueue: EmailQueue,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await this.passwordService.hash(dto.password);
    const pending = await this.prisma.pendingRegistration.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        expiresAt: minutesFromNow(EMAIL_VERIFICATION_VALIDITY_MINUTES),
      },
    });
    await this.emailQueue.enqueueRegistration(pending.id, pending.email);
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

    const { token, tokenHash } = generateToken();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await transaction.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });
      await transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: minutesFromNow(PASSWORD_RESET_VALIDITY_MINUTES),
        },
      });
    });

    await this.emailService.sendPasswordReset(user.email, token);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { user: { select: { status: true, emailVerifiedAt: true } } },
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
        data: {
          passwordHash,
          emailVerifiedAt: resetToken.user.emailVerifiedAt ?? new Date(),
        },
      });
      await transaction.emailVerificationToken.deleteMany({
        where: { userId: resetToken.userId },
      });
      await transaction.authSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.emailQueue.enqueuePasswordChanged(resetToken.userId);
  }

  async refresh(refreshToken: string): Promise<AuthTokens | AccessGrant> {
    return this.tokenService.rotateSession(refreshToken);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.tokenService.revokeSession(refreshToken);
  }
}
