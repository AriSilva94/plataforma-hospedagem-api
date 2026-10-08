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
import { createVerifiedAccount, waitFor } from './support/e2e';
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
  const sendPasswordChanged = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  const sendEmailConfirmation = jest
    .fn<Promise<void>, [string, string]>()
    .mockResolvedValue(undefined);
  const sendAccountExists = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  const password = 'senha-segura-de-teste';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendPasswordReset,
        sendPasswordChanged,
        sendEmailConfirmation,
        sendAccountExists,
        sendWelcome: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    tokens = app.get(TokenService);
  });

  async function account() {
    const result = await createVerifiedAccount(app, {
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
      .send({ email: `outro-${randomUUID()}@example.com` })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', cookie)
      .send({ name: '  Nome atualizado  ' })
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
    const sentTokens = () =>
      sendPasswordReset.mock.calls
        .filter(([email]) => email === session.user.email)
        .map(([, sentToken]) => sentToken);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: session.user.email })
        .expect(202);
    }
    await waitFor(() => sentTokens().length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sentTokens()).toHaveLength(1);

    await auth.issuePasswordReset(session.user.email);
    const [firstToken, token] = sentTokens();
    if (!firstToken || !token) {
      throw new Error('O envio dos tokens de recuperação não foi registrado.');
    }
    const storedTokens = await prisma.passwordResetToken.findMany({
      where: { userId: session.user.id },
    });
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0].tokenHash).not.toBe(token);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: firstToken, password })
      .expect(401);
    const newPassword = 'outra-senha-segura';
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password })
      .expect(401);
    await waitFor(() =>
      sendPasswordChanged.mock.calls.some(
        ([email]) => email === session.user.email,
      ),
    );
    await expect(tokens.authenticate(session.accessToken)).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password }),
    ).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password: newPassword }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });
  });

  it('recusa token de recuperação expirado sem alterar a senha', async () => {
    const session = await account();
    await auth.issuePasswordReset(session.user.email);
    const token = sendPasswordReset.mock.calls.at(-1)?.[1];
    await prisma.passwordResetToken.updateMany({
      where: { userId: session.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'outra-senha-segura' })
      .expect(401);
    await expect(
      auth.login({ email: session.user.email, password }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });
  });

  it('não emite recuperação para conta inativa nem para e-mail sem conta', async () => {
    const session = await account();
    await prisma.user.update({
      where: { id: session.user.id },
      data: { status: 'INACTIVE' },
    });
    const sentBefore = sendPasswordReset.mock.calls.length;

    await auth.issuePasswordReset(session.user.email);
    await auth.issuePasswordReset('ninguem@example.com');

    expect(sendPasswordReset.mock.calls).toHaveLength(sentBefore);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'ninguem@example.com' })
      .expect(202);
  });

  it('recusa token de recuperação fora do formato emitido', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'z'.repeat(64), password: 'outra-senha-segura' })
      .expect(400);
  });

  it('responde igual ao cadastro de e-mail já usado e avisa o titular sem criar conta', async () => {
    const session = await account();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Outra pessoa', email: session.user.email, password })
      .expect(202)
      .expect({
        message: 'Enviamos um link de confirmação para o e-mail informado.',
      });

    await waitFor(() =>
      sendAccountExists.mock.calls.some(([to]) => to === session.user.email),
    );
    expect(
      sendEmailConfirmation.mock.calls.some(
        ([to]) => to === session.user.email,
      ),
    ).toBe(false);
    await expect(
      prisma.pendingRegistration.count({
        where: { email: session.user.email },
      }),
    ).resolves.toBe(0);
    await expect(
      auth.login({ email: session.user.email, password }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });
  });

  it('recusa link de cadastro expirado sem criar conta', async () => {
    const email = `expired-${randomUUID()}@example.com`;
    await auth.register({ name: 'Cadastro expirado', email, password });
    await waitFor(() =>
      sendEmailConfirmation.mock.calls.some(([to]) => to === email),
    );
    const token = sendEmailConfirmation.mock.calls.find(
      ([to]) => to === email,
    )?.[1];
    await prisma.pendingRegistration.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(401);
    await expect(
      prisma.user.findUnique({ where: { email } }),
    ).resolves.toBeNull();
    await prisma.pendingRegistration.deleteMany({ where: { email } });
  });

  it('confirma o e-mail de uma conta existente pelo link pedido no perfil', async () => {
    const session = await account();
    const cookie = `access_token=${session.accessToken}`;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { emailVerifiedAt: null },
    });

    await request(app.getHttpServer())
      .post('/auth/email-verification')
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/email-verification')
      .set('Cookie', cookie)
      .expect(202);
    const sent = () =>
      sendEmailConfirmation.mock.calls.find(
        ([to]) => to === session.user.email,
      );
    await waitFor(() => sent() !== undefined);

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: sent()?.[1] })
      .expect(200)
      .expect(({ headers }: { headers: Record<string, unknown> }) => {
        expect(headers['set-cookie']).toBeUndefined();
      });
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }: { body: { emailVerifiedAt: unknown } }) => {
        expect(body.emailVerifiedAt).toEqual(expect.any(String));
      });
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (app) await app.close();
  });
});
