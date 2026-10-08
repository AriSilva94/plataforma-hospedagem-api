import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isUniqueConstraintError } from '../infrastructure/prisma/prisma-error';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PublicUser, toPublicUser } from '../users/public-user';
import { EmailQueue } from './email-queue';
import { EMAIL_VERIFICATION_VALIDITY_MINUTES } from './email-verification.policy';
import { EmailService } from './email.service';
import { generateToken, hashToken, minutesFromNow } from './one-time-token';
import { AuthTokens, TokenService } from './token.service';

export type EmailConfirmation =
  | { kind: 'registered'; tokens: AuthTokens; user: PublicUser }
  | { kind: 'verified' };

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly emailQueue: EmailQueue,
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
    await this.emailService.sendEmailConfirmation(pending.email, token);
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

  async confirm(token: string): Promise<EmailConfirmation> {
    const tokenHash = hashToken(token);
    return (
      (await this.completeRegistration(tokenHash)) ??
      (await this.verifyExistingAccount(tokenHash))
    );
  }

  private async completeRegistration(
    tokenHash: string,
  ): Promise<EmailConfirmation | undefined> {
    const pending = await this.prisma.pendingRegistration.findUnique({
      where: { tokenHash },
    });
    if (!pending) {
      return undefined;
    }
    if (pending.expiresAt <= new Date()) {
      throw invalidLink();
    }

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
            passwordHash: pending.passwordHash,
            emailVerifiedAt: new Date(),
            roles: [],
          },
        });
      });
      const tokens = await this.tokenService.createSession(user);
      await this.emailQueue.enqueueWelcome(user.id);
      return { kind: 'registered', tokens, user: toPublicUser(user) };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw invalidLink();
      }
      throw error;
    }
  }

  private async verifyExistingAccount(
    tokenHash: string,
  ): Promise<EmailConfirmation> {
    const verification = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
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
    return { kind: 'verified' };
  }
}

function invalidLink(): UnauthorizedException {
  return new UnauthorizedException(
    'O link de confirmação é inválido ou expirou.',
  );
}
