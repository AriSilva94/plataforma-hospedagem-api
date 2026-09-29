import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthProvider, User } from '../generated/prisma/client';
import { isEmail } from 'class-validator';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { isUniqueConstraintError } from '../infrastructure/prisma/prisma-error';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

type GoogleTokenResponse = { id_token: string };
type GoogleIdentity = { subject: string; email: string; name: string };

@Injectable()
export class GoogleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;
  private readonly jwks = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );

  constructor(
    private readonly prisma: PrismaService,
    environment: EnvironmentService,
  ) {
    this.clientId = environment.getOrThrow('GOOGLE_CLIENT_ID');
    this.clientSecret = environment.getOrThrow('GOOGLE_CLIENT_SECRET');
    this.callbackUrl = environment.getOrThrow('GOOGLE_CALLBACK_URL');
  }

  authorizationUrl(state: string, nonce: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
    }).toString();
    return url.toString();
  }

  async authenticateCallback(code: string, nonce: string): Promise<User> {
    const token = await this.exchangeCode(code);
    const identity = await this.verifyIdToken(token.id_token, nonce);
    const where = {
      provider_providerSubject: {
        provider: AuthProvider.GOOGLE,
        providerSubject: identity.subject,
      },
    };

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existingIdentity =
          await transaction.externalAuthIdentity.findUnique({
            where,
            include: { user: true },
          });
        if (existingIdentity) {
          return existingIdentity.user;
        }

        const user =
          (await transaction.user.findUnique({
            where: { email: identity.email },
          })) ??
          (await transaction.user.create({
            data: {
              name: identity.name,
              email: identity.email,
              passwordHash: null,
              roles: [],
            },
          }));

        await transaction.externalAuthIdentity.create({
          data: {
            provider: AuthProvider.GOOGLE,
            providerSubject: identity.subject,
            userId: user.id,
          },
        });
        return user;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const persistedIdentity =
          await this.prisma.externalAuthIdentity.findUnique({
            where,
            include: { user: true },
          });
        if (persistedIdentity) {
          return persistedIdentity.user;
        }
      }
      throw error;
    }
  }

  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.callbackUrl,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!response.ok) {
        throw new UnauthorizedException(
          'Não foi possível autenticar com Google.',
        );
      }
      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('id_token' in body) ||
        typeof body.id_token !== 'string' ||
        body.id_token.length === 0
      ) {
        throw new UnauthorizedException(
          'Não foi possível autenticar com Google.',
        );
      }
      return { id_token: body.id_token };
    } catch {
      throw new UnauthorizedException(
        'Não foi possível autenticar com Google.',
      );
    }
  }

  private async verifyIdToken(
    token: string,
    nonce: string,
  ): Promise<GoogleIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        audience: this.clientId,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
      });
      if (
        payload.nonce !== nonce ||
        typeof payload.sub !== 'string' ||
        payload.sub.trim().length === 0 ||
        typeof payload.email !== 'string' ||
        !isEmail(payload.email) ||
        payload.email_verified !== true ||
        typeof payload.name !== 'string' ||
        payload.name.trim().length === 0
      ) {
        throw new UnauthorizedException(
          'Não foi possível autenticar com Google.',
        );
      }
      return {
        subject: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name,
      };
    } catch {
      throw new UnauthorizedException(
        'Não foi possível autenticar com Google.',
      );
    }
  }
}
