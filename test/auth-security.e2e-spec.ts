import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/auth/email.service';
import { TokenService } from '../src/auth/token.service';
import { GoogleAuthService } from '../src/auth/google-auth.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.module';
import { RedisThrottlerStorage } from '../src/infrastructure/redis/redis-throttler.storage';

describe('Segurança de autenticação (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let auth: AuthService;
  let tokens: TokenService;
  const userIds: string[] = [];
  const sendPasswordReset = jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined);
  const password = 'senha-segura-de-teste';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ sendPasswordReset })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    tokens = app.get(TokenService);
  });

  async function account() {
    const result = await auth.register({
      name: 'Teste de segurança',
      email: `review-${randomUUID()}@example.com`,
      password,
    });
    userIds.push(result.user.id);
    return result;
  }

  it('bloqueia acesso anônimo e campos de privilégio no cadastro', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Admin',
        email: 'invalid@example.com',
        password,
        role: 'ADMIN',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Admin',
        email: 'invalid@example.com',
        password,
        role: 'GUEST',
        status: 'ACTIVE',
      })
      .expect(400);
  });

  it('recusa callback Google para usuário inativo sem emitir sessão', async () => {
    const session = await account();
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { status: 'INACTIVE' },
    });
    const googleAuth = app.get(GoogleAuthService);
    const callback = jest
      .spyOn(googleAuth, 'authenticateCallback')
      .mockResolvedValueOnce(user);

    try {
      const response = await request(app.getHttpServer())
        .get('/auth/google/callback?code=code&state=expected')
        .set('Cookie', 'oauth_google_state=expected; oauth_google_nonce=nonce')
        .expect(302);

      expect(response.headers.location).toBe(
        `${process.env.FRONTEND_URL}/login?error=google-auth`,
      );
      expect(response.headers['set-cookie']).toHaveLength(2);
      expect(response.headers['set-cookie']).not.toEqual(
        expect.arrayContaining([expect.stringContaining('access_token=')]),
      );
      expect(
        await prisma.authSession.count({ where: { userId: user.id } }),
      ).toBe(1);
    } finally {
      callback.mockRestore();
    }
  });

  it('mantém contador temporário e bloqueia requisições concorrentes no Redis', async () => {
    const redis = app.get<Redis>(REDIS_CLIENT);
    const storage = new RedisThrottlerStorage(redis);
    const key = randomUUID();
    const baseKey = `throttle:review:${key}`;
    try {
      await redis.set(baseKey, '1');
      const result = await storage.increment(key, 60000, 3, 60000, 'review');
      expect(result.timeToExpire).toBeGreaterThan(0);
      expect(result.timeToExpire).toBeLessThanOrEqual(60);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          storage.increment(key, 60000, 3, 60000, 'review'),
        ),
      );
      expect(results.filter((record) => !record.isBlocked)).toHaveLength(1);
      expect(
        results.find((record) => record.isBlocked)?.timeToBlockExpire,
      ).toBeLessThanOrEqual(60);
      expect(await redis.pttl(baseKey)).toBeGreaterThan(0);
    } finally {
      await redis.del(baseKey, `${baseKey}:block`);
    }
  });

  it('normaliza DTOs e impede alterar outro usuário ou os próprios papéis', async () => {
    const session = await account();
    const cookie = `access_token=${session.accessToken}`;
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', cookie)
      .send({ name: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', cookie)
      .send({ roles: ['ADMIN'], id: randomUUID() })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', cookie)
      .send({
        name: '  Nome atualizado  ',
        email: `  ${session.user.email.toUpperCase()}  `,
      })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          name: 'Nome atualizado',
          email: session.user.email,
          roles: [],
        });
        expect(body).not.toHaveProperty('passwordHash');
      });
  });

  it('cria um único perfil sob concorrência', async () => {
    const session = await account();
    await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .post('/users/me/profiles/owner')
          .set('Cookie', `access_token=${session.accessToken}`)
          .expect(201),
      ),
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
    });
    expect(user.roles).toEqual(['OWNER']);
    expect(
      await prisma.ownerProfile.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  it('rotaciona uma única vez sob concorrência e autoriza ambas as requisições', async () => {
    const session = await account();
    const results = await Promise.all([
      tokens.rotateSession(session.refreshToken),
      tokens.rotateSession(session.refreshToken),
    ]);
    expect(results.filter((result) => 'refreshToken' in result)).toHaveLength(
      1,
    );
    for (const result of results) {
      await expect(
        tokens.authenticate(result.accessToken),
      ).resolves.toMatchObject({ id: session.user.id });
    }
    await expect(tokens.authenticate(session.accessToken)).rejects.toThrow();
    expect(
      await prisma.authSession.count({
        where: { userId: session.user.id, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('revoga toda a cadeia de sessões ao detectar reuso do refresh token', async () => {
    const session = await account();
    const rotated = await tokens.rotateSession(session.refreshToken);
    await prisma.authSession.updateMany({
      where: { userId: session.user.id, replacedBySessionId: { not: null } },
      data: { revokedAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    await expect(tokens.rotateSession(session.refreshToken)).rejects.toThrow();
    await expect(tokens.authenticate(rotated.accessToken)).rejects.toThrow();
    expect(
      await prisma.authSession.count({
        where: { userId: session.user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('mantém 30 dias de inatividade sem ultrapassar o limite absoluto do login', async () => {
    const session = await account();
    const [initial] = await prisma.authSession.findMany({
      where: { userId: session.user.id },
    });
    const day = 24 * 60 * 60 * 1000;
    expect(initial.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * day);
    expect(initial.absoluteExpiresAt.getTime() - Date.now()).toBeGreaterThan(
      89 * day,
    );

    const absoluteExpiresAt = new Date(Date.now() + 5 * day);
    await prisma.authSession.update({
      where: { id: initial.id },
      data: { absoluteExpiresAt },
    });
    const rotated = await tokens.rotateSession(session.refreshToken);
    const successor = await prisma.authSession.findFirstOrThrow({
      where: { userId: session.user.id, revokedAt: null },
    });

    expect(successor.familyId).toBe(initial.familyId);
    expect(successor.expiresAt).toEqual(absoluteExpiresAt);
    expect(
      'refreshTokenExpiresAt' in rotated && rotated.refreshTokenExpiresAt,
    ).toEqual(absoluteExpiresAt);
  });

  it('preserva a sessão anterior se a criação da substituta falhar', async () => {
    const session = await account();
    const failure = jest
      .spyOn(tokens, 'createSession')
      .mockRejectedValueOnce(new Error('Falha de persistência simulada'));
    try {
      await expect(tokens.rotateSession(session.refreshToken)).rejects.toThrow(
        'Falha de persistência simulada',
      );
      await expect(
        tokens.authenticate(session.accessToken),
      ).resolves.toMatchObject({ id: session.user.id });
    } finally {
      failure.mockRestore();
    }
  });

  it('logout revoga o access token mesmo sem recebê-lo no pedido', async () => {
    const session = await account();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `refresh_token=${session.refreshToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', `access_token=${session.accessToken}`)
      .expect(401);
  });

  it('logout com refresh token recém-rotacionado encerra a sessão sucessora', async () => {
    const session = await account();
    const rotated = await tokens.rotateSession(session.refreshToken);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `refresh_token=${session.refreshToken}`)
      .expect(204);
    await expect(tokens.authenticate(rotated.accessToken)).rejects.toThrow();
  });

  it('nega login, acesso e renovação para usuário inativo', async () => {
    const session = await account();
    await prisma.user.update({
      where: { id: session.user.id },
      data: { status: 'INACTIVE' },
    });
    await expect(
      auth.login({ email: session.user.email, password }),
    ).rejects.toThrow();
    await expect(tokens.authenticate(session.accessToken)).rejects.toThrow();
    await expect(tokens.rotateSession(session.refreshToken)).rejects.toThrow();
  });

  it('recupera a senha, impede reutilização do token e revoga sessões', async () => {
    const session = await account();
    await auth.requestPasswordReset({ email: session.user.email });
    const firstToken = sendPasswordReset.mock.calls.find(
      ([email]) => email === session.user.email,
    )?.[1];
    expect(firstToken).toBeDefined();
    await auth.requestPasswordReset({ email: session.user.email });
    const token = sendPasswordReset.mock.calls.at(-1)?.[1];
    if (!firstToken || !token) {
      throw new Error('O envio dos tokens de recuperação não foi registrado.');
    }
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: session.user.id },
    });
    expect(stored.tokenHash).not.toBe(token);
    const newPassword = 'outra-senha-segura';
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: firstToken, password })
      .expect(401);
    await expect(tokens.authenticate(session.accessToken)).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password }),
    ).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password: newPassword }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (app) await app.close();
  });
});
