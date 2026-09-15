import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtPayload, SignOptions, sign, verify } from 'jsonwebtoken';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { PasswordService } from './password.service';

type AccessPayload = { sub: string; roles: Role[] };
type RefreshPayload = { sub: string; sessionId: string };

export type AuthTokens = { accessToken: string; refreshToken: string };

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async createSession(user: {
    id: string;
    roles: Role[];
  }): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const refreshToken = await this.signRefreshToken(user.id, sessionId);
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: await this.passwordService.hash(refreshToken),
        expiresAt: this.refreshExpiration(),
      },
    });
    return { accessToken: await this.signAccessToken(user), refreshToken };
  }

  async rotateSession(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });
    const isValid =
      session &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      (await this.passwordService.verify(
        session.refreshTokenHash,
        refreshToken,
      ));

    if (!isValid) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const revokedSession = await this.prisma.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revokedSession.count !== 1) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    return this.createSession(session.user);
  }

  async revokeSession(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.prisma.authSession.updateMany({
        where: { id: payload.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      return;
    }
  }

  verifyAccessToken(token: string): Promise<AccessPayload> {
    return Promise.resolve(
      this.toAccessPayload(verify(token, this.accessSecret())),
    );
  }

  private signAccessToken(user: {
    id: string;
    roles: Role[];
  }): Promise<string> {
    return Promise.resolve(
      sign({ sub: user.id, roles: user.roles }, this.accessSecret(), {
        expiresIn: this.environmentService.getOrThrow(
          'ACCESS_TOKEN_TTL',
        ) as SignOptions['expiresIn'],
      }),
    );
  }

  private signRefreshToken(userId: string, sessionId: string): Promise<string> {
    return Promise.resolve(
      sign(
        { sub: userId, sessionId },
        this.environmentService.getOrThrow('REFRESH_TOKEN_SECRET'),
        {
          expiresIn: this.refreshTtl() as SignOptions['expiresIn'],
        },
      ),
    );
  }

  private verifyRefreshToken(token: string): Promise<RefreshPayload> {
    return Promise.resolve(
      this.toRefreshPayload(
        verify(
          token,
          this.environmentService.getOrThrow('REFRESH_TOKEN_SECRET'),
        ),
      ),
    );
  }

  private accessSecret(): string {
    return this.environmentService.getOrThrow('ACCESS_TOKEN_SECRET');
  }

  private refreshTtl(): string {
    return this.environmentService.getOrThrow('REFRESH_TOKEN_TTL');
  }

  private refreshExpiration(): Date {
    const days = Number(
      this.environmentService.getOrThrow('REFRESH_TOKEN_TTL_DAYS'),
    );
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private toAccessPayload(payload: string | JwtPayload): AccessPayload {
    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role) => Object.values(Role).includes(role as Role))
    ) {
      throw new UnauthorizedException('Token inválido.');
    }
    return { sub: payload.sub, roles: payload.roles as Role[] };
  }

  private toRefreshPayload(payload: string | JwtPayload): RefreshPayload {
    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sessionId !== 'string'
    ) {
      throw new UnauthorizedException('Token inválido.');
    }
    return { sub: payload.sub, sessionId: payload.sessionId };
  }
}
