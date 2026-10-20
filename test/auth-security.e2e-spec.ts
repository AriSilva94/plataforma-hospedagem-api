import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/auth/email.service';
import { MAX_LOGIN_FAILURES } from '../src/auth/login-attempts';
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
  const sendRegistrationConfirmation = jest
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
        sendRegistrationConfirmation,
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
        role: 'ADMIN',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Admin',
        email: 'invalid@example.com',
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

  it('grava, normaliza e limpa os dados pessoais do próprio usuário', async () => {
    const session = await account();
    const cookie = `access_token=${session.accessToken}`;
    const patchMe = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', cookie)
        .send(body);

    for (const invalid of [
      { phone: '12345' },
      { phone: '(01) 91234-5678' },
      { phone: '(11) 81234-5678' },
      { birthDate: '10/05/1990' },
      { birthDate: '1990-02-30' },
      { birthDate: '1899-12-31' },
      { birthDate: '2999-01-01' },
      { birthDate: `${new Date().getUTCFullYear() - 17}-01-01` },
      { city: 'A' },
      { state: 'XX' },
      { city: 'Recife', state: 'SP' },
      { city: 'Recife' },
    ]) {
      await patchMe(invalid).expect(400);
    }

    await patchMe({
      phone: '(11) 91234-5678',
      birthDate: '1990-05-10',
      city: '  São Paulo  ',
      state: 'sp',
    })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          name: session.user.name,
          phone: '+5511912345678',
          birthDate: '1990-05-10',
          city: 'São Paulo',
          state: 'SP',
        });
      });

    await patchMe({ phone: '+55 11 3123-4567' })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          phone: '+551131234567',
          birthDate: '1990-05-10',
          city: 'São Paulo',
          state: 'SP',
        });
      });

    await patchMe({ state: 'RJ' }).expect(400);
    await patchMe({ state: null }).expect(400);
    await patchMe({ state: 'RJ', city: 'Niterói' }).expect(200);

    await patchMe({ phone: '', birthDate: null, city: ' ', state: '' })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          name: session.user.name,
          phone: null,
          birthDate: null,
          city: null,
          state: null,
        });
      });

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({ phone: null, birthDate: null });
      });
  });

  it('lista as cidades de uma UF para usuários autenticados', async () => {
    const session = await account();
    const cities = (state: string) =>
      request(app.getHttpServer())
        .get(`/locations/states/${state}/cities`)
        .set('Cookie', `access_token=${session.accessToken}`);

    await request(app.getHttpServer())
      .get('/locations/states/SP/cities')
      .expect(401);
    await cities('XX').expect(404);
    await cities('sp')
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toHaveLength(645);
        expect(body).toContain('São Paulo');
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

  it('altera a senha com a senha atual, troca a sessão e avisa o titular', async () => {
    const session = await account();
    const other = await tokens.createSession(session.user);
    const cookie = `access_token=${session.accessToken}`;
    const newPassword = 'nova-senha-segura';
    await auth.issuePasswordReset(session.user.email);

    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: password, newPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: 'curta' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'senha-errada', newPassword })
      .expect(400);
    await expect(
      auth.login({ email: session.user.email, password }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });

    const response = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword })
      .expect(204);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const newAccessToken = cookies
      .find((value) => value.startsWith('access_token='))
      ?.split(';')[0]
      .slice('access_token='.length);
    expect(cookies).toEqual(
      expect.arrayContaining([expect.stringContaining('refresh_token=')]),
    );
    await expect(tokens.authenticate(newAccessToken ?? '')).resolves.toEqual(
      expect.objectContaining({ id: session.user.id }),
    );
    await expect(tokens.authenticate(session.accessToken)).rejects.toThrow();
    await expect(tokens.authenticate(other.accessToken)).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password }),
    ).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password: newPassword }),
    ).resolves.toMatchObject({ user: { id: session.user.id } });
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: session.user.id },
      }),
    ).toBe(0);
    await waitFor(() =>
      sendPasswordChanged.mock.calls.some(
        ([email]) => email === session.user.email,
      ),
    );
  });

  it('informa se a conta tem senha e recusa a troca em conta sem senha', async () => {
    const session = await account();
    const cookie = `access_token=${session.accessToken}`;
    const hasPassword = async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', cookie)
        .expect(200);
      return (response.body as { hasPassword: unknown }).hasPassword;
    };

    await expect(hasPassword()).resolves.toBe(true);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordHash: null },
    });
    await expect(hasPassword()).resolves.toBe(false);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: password, newPassword: 'nova-senha-segura' })
      .expect(400);
  });

  it('desativa a própria conta com a senha atual e encerra todo o acesso', async () => {
    const session = await account();
    const other = await tokens.createSession(session.user);
    const cookie = `access_token=${session.accessToken}`;
    await auth.issuePasswordReset(session.user.email);

    await request(app.getHttpServer())
      .post('/auth/deactivate-account')
      .send({ currentPassword: password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/deactivate-account')
      .set('Cookie', cookie)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/deactivate-account')
      .set('Cookie', cookie)
      .send({ currentPassword: 'senha-errada' })
      .expect(400);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: session.user.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    const response = await request(app.getHttpServer())
      .post('/auth/deactivate-account')
      .set('Cookie', cookie)
      .send({ currentPassword: password })
      .expect(204);

    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('access_token=;'),
        expect.stringContaining('refresh_token=;'),
      ]),
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: session.user.id } }),
    ).resolves.toMatchObject({ status: 'INACTIVE' });
    expect(
      await prisma.authSession.count({
        where: { userId: session.user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: session.user.id },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(401);
    await expect(tokens.authenticate(other.accessToken)).rejects.toThrow();
    await expect(tokens.rotateSession(session.refreshToken)).rejects.toThrow();
    await expect(
      auth.login({ email: session.user.email, password }),
    ).rejects.toThrow();
  });

  it('desativa conta sem senha apenas com a sessão', async () => {
    const session = await account();
    await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordHash: null },
    });

    await request(app.getHttpServer())
      .post('/auth/deactivate-account')
      .set('Cookie', `access_token=${session.accessToken}`)
      .send({})
      .expect(204);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: session.user.id } }),
    ).resolves.toMatchObject({ status: 'INACTIVE' });
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
      .send({ name: 'Outra pessoa', email: session.user.email })
      .expect(202)
      .expect({
        message: 'Enviamos um link de confirmação para o e-mail informado.',
      });

    await waitFor(() =>
      sendAccountExists.mock.calls.some(([to]) => to === session.user.email),
    );
    expect(
      sendRegistrationConfirmation.mock.calls.some(
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
    await auth.register({ name: 'Cadastro expirado', email });
    await waitFor(() =>
      sendRegistrationConfirmation.mock.calls.some(([to]) => to === email),
    );
    const token = sendRegistrationConfirmation.mock.calls.find(
      ([to]) => to === email,
    )?.[1];
    await prisma.pendingRegistration.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({ token, password })
      .expect(401);
    await expect(
      prisma.user.findUnique({ where: { email } }),
    ).resolves.toBeNull();
    await prisma.pendingRegistration.deleteMany({ where: { email } });
  });

  it('cria a conta com a senha de quem abriu o link, mesmo vindo do cadastro de outra pessoa', async () => {
    const email = `victim-${randomUUID()}@example.com`;
    const attackerPassword = 'senha-do-atacante';
    const victimPassword = 'senha-da-vitima-1';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Atacante', email, password: attackerPassword })
      .expect(400);
    await auth.register({ name: 'Atacante', email });
    await waitFor(() =>
      sendRegistrationConfirmation.mock.calls.some(([to]) => to === email),
    );
    await auth.register({ name: 'Vítima', email });
    const links = sendRegistrationConfirmation.mock.calls.filter(
      ([to]) => to === email,
    );
    expect(links).toHaveLength(1);

    const completion = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({ token: links[0][1], password: victimPassword })
      .expect(200);
    userIds.push((completion.body as { user: { id: string } }).user.id);

    await expect(
      auth.login({ email, password: attackerPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      auth.login({ email, password: victimPassword }),
    ).resolves.toMatchObject({ user: { email } });
    await expect(
      prisma.pendingRegistration.count({ where: { email } }),
    ).resolves.toBe(0);
  });

  it('bloqueia o login por e-mail após falhas vindas de IPs diferentes', async () => {
    const session = await account();
    const other = await account();
    const previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = 'e2e-internal-secret';
    const loginFrom = (index: number, body: object) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Internal-Secret', 'e2e-internal-secret')
        .set('X-Client-IP', `10.0.${Math.floor(index / 250)}.${index % 250}`)
        .send(body);

    try {
      for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt += 1) {
        await loginFrom(attempt, {
          email: session.user.email,
          password: 'senha-errada-123',
        }).expect(401);
      }
      await loginFrom(MAX_LOGIN_FAILURES, {
        email: session.user.email,
        password,
      }).expect(429);
      await loginFrom(MAX_LOGIN_FAILURES + 1, {
        email: other.user.email,
        password,
      }).expect(200);
    } finally {
      process.env.INTERNAL_API_SECRET = previousSecret;
    }
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
