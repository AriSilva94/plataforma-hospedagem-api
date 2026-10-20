import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isUniqueConstraintError } from '../infrastructure/prisma/prisma-error';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { toPublicUser } from '../users/public-user';
import type { AuthResult } from './auth.service';
import { EmailQueue } from './email-queue';
import { EMAIL_VERIFICATION_VALIDITY_MINUTES } from './email-verification.policy';
import { EmailService } from './email.service';
import { generateToken, hashToken, minutesFromNow } from './one-time-token';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly emailQueue: EmailQueue,
    private readonly passwordService: PasswordService,
  ) {}

  async issueForRegistration(pendingRegistrationId: string): Promise<void> {
    await this.prisma.pendingRegistration.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    const pending = await this.prisma.pendingRegistration.findUnique({
      where: { id: pendingRegistrationId },
    });
    if (!pending) {
      return;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: pending.email },
      select: { id: true },
    });
    if (existingUser) {
      await this.prisma.pendingRegistration.delete({
        where: { id: pending.id },
      });
      await this.emailService.sendAccountExists(pending.email);
      return;
    }

    const { token, tokenHash } = generateToken();
    await this.prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { tokenHash },
    });
    await this.emailService.sendRegistrationConfirmation(pending.email, token);
  }

  async requestForUser(userId: string): Promise<void> {
    await this.emailQueue.enqueueEmailVerification(userId);
  }

  async issueForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) {
      return;
    }

    const { token, tokenHash } = generateToken();
    const verification = {
      email: user.email,
      tokenHash,
      expiresAt: minutesFromNow(EMAIL_VERIFICATION_VALIDITY_MINUTES),
    };
    await this.prisma.emailVerificationToken.upsert({
      where: { userId },
      create: { userId, ...verification },
      update: verification,
    });
    await this.emailService.sendEmailConfirmation(user.email, token);
  }

  async completeRegistration(
    token: string,
    password: string,
  ): Promise<AuthResult> {
    const pending = await this.prisma.pendingRegistration.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!pending || pending.expiresAt <= new Date()) {
      throw invalidLink();
    }

    const passwordHash = await this.passwordService.hash(password);
    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const consumed = await transaction.pendingRegistration.deleteMany({
          where: { email: pending.email },
        });
        if (consumed.count === 0) {
          throw invalidLink();
        }
        return transaction.user.create({
          data: {
            name: pending.name,
            email: pending.email,
            passwordHash,
            emailVerifiedAt: new Date(),
            roles: [],
          },
        });
      });
      const tokens = await this.tokenService.createSession(user);
      await this.emailQueue.enqueueWelcome(user.id);
      return { ...tokens, user: toPublicUser(user, null) };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw invalidLink();
      }
      throw error;
    }
  }

  async confirm(token: string): Promise<void> {
    const verification = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!verification || verification.expiresAt <= new Date()) {
      throw invalidLink();
    }

    await this.prisma.$transaction(async (transaction) => {
      const verified = await transaction.user.updateMany({
        where: { id: verification.userId, email: verification.email },
        data: { emailVerifiedAt: new Date() },
      });
      await transaction.emailVerificationToken.delete({
        where: { id: verification.id },
      });
      if (verified.count !== 1) {
        throw invalidLink();
      }
    });
  }
}

function invalidLink(): UnauthorizedException {
  return new UnauthorizedException(
    'O link de confirmação é inválido ou expirou.',
  );
}
