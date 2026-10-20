import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { PublicUser, toPublicUser } from '../users/public-user';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailQueue } from './email-queue';
import { EMAIL_VERIFICATION_VALIDITY_MINUTES } from './email-verification.policy';
import { EmailService } from './email.service';
import { LoginAttempts } from './login-attempts';
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
    private readonly mediaService: MediaService,
    private readonly loginAttempts: LoginAttempts,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    const pending = await this.prisma.pendingRegistration.create({
      data: {
        name: dto.name,
        email: dto.email,
        expiresAt: minutesFromNow(EMAIL_VERIFICATION_VALIDITY_MINUTES),
      },
    });
    await this.emailQueue.enqueueRegistration(pending.id, pending.email);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    await this.loginAttempts.assertAllowed(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const isValidPassword = await this.passwordService.verifyIfPresent(
      user?.passwordHash,
      dto.password,
    );

    if (!user || !isValidPassword || user.status !== 'ACTIVE') {
      await this.loginAttempts.recordFailure(dto.email);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    await this.loginAttempts.clear(dto.email);
    const tokens = await this.tokenService.createSession(user);
    return {
      ...tokens,
      user: toPublicUser(user, this.mediaService.publicUrl(user.avatarKey)),
    };
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
      await this.revokeSessions(transaction, resetToken.userId);
    });
    await this.emailQueue.enqueuePasswordChanged(resetToken.userId);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Esta conta ainda não tem senha. Use a recuperação de senha para definir uma.',
      );
    }
    if (
      !(await this.passwordService.verify(
        user.passwordHash,
        dto.currentPassword,
      ))
    ) {
      throw new BadRequestException('Senha atual incorreta.');
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);
    const tokens = await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await transaction.passwordResetToken.deleteMany({ where: { userId } });
      await this.revokeSessions(transaction, userId);
      return this.tokenService.createSession(user, transaction);
    });
    await this.emailQueue.enqueuePasswordChanged(userId);
    return tokens;
  }

  async deactivateAccount(
    userId: string,
    dto: DeactivateAccountDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (
      user.passwordHash &&
      !(
        dto.currentPassword &&
        (await this.passwordService.verify(
          user.passwordHash,
          dto.currentPassword,
        ))
      )
    ) {
      throw new BadRequestException('Senha atual incorreta.');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: { status: 'INACTIVE' },
      });
      await this.revokeSessions(transaction, userId);
      await transaction.passwordResetToken.deleteMany({ where: { userId } });
      await transaction.emailVerificationToken.deleteMany({
        where: { userId },
      });
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens | AccessGrant> {
    return this.tokenService.rotateSession(refreshToken);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.tokenService.revokeSession(refreshToken);
  }

  private async revokeSessions(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
