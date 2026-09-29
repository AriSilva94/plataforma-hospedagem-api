import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtPayload, SignOptions, decode, sign, verify } from 'jsonwebtoken';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { PasswordService } from './password.service';

type TokenPayload = { sub: string; sessionId: string };
type SessionUser = { id: string; roles: Role[]; status: UserStatus };
type SessionState = {
  revokedAt: Date | null;
  expiresAt: Date;
  user: SessionUser;
};
type SessionLineage = { familyId: string; absoluteExpiresAt: Date };

export type AccessGrant = { accessToken: string; accessTokenExpiresAt: Date };
export type AuthTokens = AccessGrant & {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};
export type AuthenticatedUser = { id: string; roles: Role[] };

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_MAX_AGE_DAYS = 90;
const ROTATION_GRACE_MS = 60 * 1000;

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
    lineage: SessionLineage = this.newLineage(),
    sessionId: string = randomUUID(),
  ): Promise<AuthTokens> {
    const refreshTokenExpiresAt = new Date(
      Math.min(
        Date.now() + this.idleTtlDays() * DAY_IN_MS,
        lineage.absoluteExpiresAt.getTime(),
      ),
    );
    const refreshToken = this.signRefreshToken(
      user.id,
      sessionId,
      refreshTokenExpiresAt,
    );
    await transaction.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId: lineage.familyId,
        refreshTokenHash: await this.passwordService.hash(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        absoluteExpiresAt: lineage.absoluteExpiresAt,
      },
    });
    return {
      ...this.signAccessToken(user.id, sessionId),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

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

  async rotateSession(refreshToken: string): Promise<AuthTokens | AccessGrant> {
    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (
      !session ||
      session.user.id !== payload.sub ||
      session.user.status !== UserStatus.ACTIVE ||
      !(await this.passwordService.verify(
        session.refreshTokenHash,
        refreshToken,
      ))
    ) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    if (this.isActiveSession(session)) {
      const rotated = await this.replaceSession(session);
      if (rotated) {
        return rotated;
      }
    }

    return this.grantFromReplacedSession(session.id);
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

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { familyId: true },
    });
    if (session) {
      await this.revokeFamily(session.familyId);
    }
  }

  private replaceSession(session: {
    id: string;
    familyId: string;
    absoluteExpiresAt: Date;
    user: { id: string; roles: Role[] };
  }): Promise<AuthTokens | null> {
    const successorId = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const revokedSession = await transaction.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedBySessionId: successorId },
      });
      if (revokedSession.count !== 1) {
        return null;
      }
      return this.createSession(
        session.user,
        transaction,
        {
          familyId: session.familyId,
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
        successorId,
      );
    });
  }

  private async grantFromReplacedSession(
    sessionId: string,
  ): Promise<AccessGrant> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
    });

    if (!session?.replacedBySessionId || !session.revokedAt) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    if (session.revokedAt.getTime() < Date.now() - ROTATION_GRACE_MS) {
      await this.revokeFamily(session.familyId);
      throw new UnauthorizedException('Sessão inválida.');
    }

    const successor = await this.prisma.authSession.findUnique({
      where: { id: session.replacedBySessionId },
      include: { user: true },
    });
    if (!this.isActiveSession(successor)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return this.signAccessToken(successor.user.id, successor.id);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
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

  private newLineage(): SessionLineage {
    return {
      familyId: randomUUID(),
      absoluteExpiresAt: new Date(Date.now() + this.maxAgeDays() * DAY_IN_MS),
    };
  }

  private signAccessToken(userId: string, sessionId: string): AccessGrant {
    const accessToken = sign({ sub: userId, sessionId }, this.accessSecret(), {
      expiresIn: this.environmentService.getOrThrow(
        'ACCESS_TOKEN_TTL',
      ) as SignOptions['expiresIn'],
    });
    const { exp } = decode(accessToken) as JwtPayload & { exp: number };
    return {
      accessToken,
      accessTokenExpiresAt: new Date(exp * 1000),
    };
  }

  private signRefreshToken(
    userId: string,
    sessionId: string,
    expiresAt: Date,
  ): string {
    return sign(
      {
        sub: userId,
        sessionId,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.refreshSecret(),
    );
  }

  private verifyAccessToken(token: string): TokenPayload {
    return this.toTokenPayload(this.verifyToken(token, this.accessSecret()));
  }

  private verifyRefreshToken(token: string): TokenPayload {
    return this.toTokenPayload(this.verifyToken(token, this.refreshSecret()));
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

  private refreshSecret(): string {
    return this.environmentService.getOrThrow('REFRESH_TOKEN_SECRET');
  }

  private idleTtlDays(): number {
    return Number(this.environmentService.getOrThrow('REFRESH_TOKEN_TTL_DAYS'));
  }

  private maxAgeDays(): number {
    return Number(
      this.environmentService.get('SESSION_MAX_AGE_DAYS') ??
        DEFAULT_SESSION_MAX_AGE_DAYS,
    );
  }

  private toTokenPayload(payload: string | JwtPayload): TokenPayload {
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
