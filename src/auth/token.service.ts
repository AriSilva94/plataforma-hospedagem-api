import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtPayload, SignOptions, sign, verify } from 'jsonwebtoken';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { PasswordService } from './password.service';

type AccessPayload = { sub: string; sessionId: string };
type RefreshPayload = { sub: string; sessionId: string };
type SessionUser = { id: string; roles: Role[]; status: UserStatus };
type SessionState = {
  revokedAt: Date | null;
  expiresAt: Date;
  user: SessionUser;
};

export type AuthTokens = { accessToken: string; refreshToken: string };
export type AuthenticatedUser = { id: string; roles: Role[] };

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async createSession(
    user: {
      id: string;
      roles: Role[];
    },
    transaction: Prisma.TransactionClient = this.prisma,
  ): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const refreshToken = this.signRefreshToken(user.id, sessionId);
    const accessToken = this.signAccessToken(user, sessionId);
    await transaction.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: await this.passwordService.hash(refreshToken),
        expiresAt: this.refreshExpiration(),
      },
    });
    return { accessToken, refreshToken };
  }

  // O access token só autoriza enquanto a sessão que o emitiu continuar ativa,
  // para que logout e redefinição de senha revoguem o acesso imediatamente.
  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const payload = this.verifyAccessToken(accessToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: { select: { id: true, roles: true, status: true } },
      },
    });

    if (!this.isActiveSession(session) || session.user.id !== payload.sub) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    return { id: session.user.id, roles: session.user.roles };
  }

  async rotateSession(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (
      !this.isActiveSession(session) ||
      session.user.id !== payload.sub ||
      !(await this.passwordService.verify(
        session.refreshTokenHash,
        refreshToken,
      ))
    ) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const revokedSession = await transaction.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revokedSession.count !== 1) {
        throw new UnauthorizedException('Sessão inválida.');
      }
      return this.createSession(session.user, transaction);
    });
  }

  async revokeSession(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    let sessionId: string;
    try {
      sessionId = this.verifyRefreshToken(refreshToken).sessionId;
    } catch {
      return;
    }

    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private isActiveSession<T extends SessionState>(
    session: T | null,
  ): session is T {
    return (
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt > new Date() &&
      session.user.status === UserStatus.ACTIVE
    );
  }

  private signAccessToken(
    user: { id: string; roles: Role[] },
    sessionId: string,
  ): string {
    return sign({ sub: user.id, sessionId }, this.accessSecret(), {
      expiresIn: this.environmentService.getOrThrow(
        'ACCESS_TOKEN_TTL',
      ) as SignOptions['expiresIn'],
    });
  }

  private signRefreshToken(userId: string, sessionId: string): string {
    return sign(
      { sub: userId, sessionId },
      this.environmentService.getOrThrow('REFRESH_TOKEN_SECRET'),
      { expiresIn: this.refreshTtl() as SignOptions['expiresIn'] },
    );
  }

  private verifyAccessToken(token: string): AccessPayload {
    return this.toAccessPayload(this.verifyToken(token, this.accessSecret()));
  }

  private verifyRefreshToken(token: string): RefreshPayload {
    return this.toRefreshPayload(
      this.verifyToken(
        token,
        this.environmentService.getOrThrow('REFRESH_TOKEN_SECRET'),
      ),
    );
  }

  private verifyToken(token: string, secret: string): string | JwtPayload {
    try {
      return verify(token, secret);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
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
      typeof payload.sessionId !== 'string'
    ) {
      throw new UnauthorizedException('Token inválido.');
    }
    return {
      sub: payload.sub,
      sessionId: payload.sessionId,
    };
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
