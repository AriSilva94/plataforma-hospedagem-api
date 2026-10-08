import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { EmailVerificationService } from './email-verification.service';
import { GoogleAuthService } from './google-auth.service';
import { TokenService } from './token.service';

describe('AuthController session cookies', () => {
  let app: INestApplication<App>;
  let domain: string | undefined;
  const tokens = {
    accessToken: 'access',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    refreshToken: 'refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
  const refresh = jest.fn();
  const authorizationUrl = jest.fn(
    (state: string, nonce: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
  );
  const authenticateCallback = jest.fn();
  const createSession = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({ ...tokens, user: {} }),
            register: jest.fn().mockResolvedValue(undefined),
            refresh,
            logout: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EnvironmentService,
          useValue: {
            get: (name: string) =>
              name === 'COOKIE_DOMAIN' ? domain : 'production',
            getOrThrow: (name: string) =>
              name === 'FRONTEND_URL' ? 'https://app.example.com' : '30',
          },
        },
        {
          provide: GoogleAuthService,
          useValue: { authorizationUrl, authenticateCallback },
        },
        { provide: TokenService, useValue: { createSession } },
        {
          provide: EmailVerificationService,
          useValue: {
            confirm: jest
              .fn()
              .mockResolvedValue({ kind: 'registered', tokens, user: {} }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    refresh.mockResolvedValue(tokens);
    domain = undefined;
  });

  it('não emite sessão no cadastro, que depende da confirmação do e-mail', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({});

    expect(response.status).toBe(202);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['login', 'verify-email', 'refresh', 'logout'])(
    'uses the shared domain for %s cookies',
    async (endpoint) => {
      domain = 'hml.example.com';
      const response = await request(app.getHttpServer())
        .post(`/auth/${endpoint}`)
        .set('Cookie', 'refresh_token=refresh')
        .send({});
      expect(response.status).toBeLessThan(300);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).toContain('Domain=hml.example.com');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
        if (endpoint === 'logout') {
          expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
        }
      }
    },
  );

  it.each([undefined, ''])(
    'keeps host-only cookies when domain is %s',
    async (value) => {
      domain = value;
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({});
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).not.toContain('Domain=');
      }
    },
  );

  it('expira os cookies junto com os tokens emitidos', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({});
    const [accessCookie, refreshCookie] = response.headers[
      'set-cookie'
    ] as unknown as string[];

    expect(maxAge(accessCookie)).toBeGreaterThan(15 * 60 - 5);
    expect(maxAge(accessCookie)).toBeLessThanOrEqual(15 * 60);
    expect(maxAge(refreshCookie)).toBeGreaterThan(30 * 24 * 60 * 60 - 5);
    expect(maxAge(refreshCookie)).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });

  it('renova somente o access token quando a rotação já ocorreu em paralelo', async () => {
    refresh.mockResolvedValue({
      accessToken: 'access',
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    });
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', 'refresh_token=refresh')
      .expect(200, { authenticated: true });
    const cookies = response.headers['set-cookie'] as unknown as string[];

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^access_token=access;/);
  });

  it('inicia Google Auth com state e nonce em cookies seguros de dez minutos', async () => {
    domain = 'example.com';
    const response = await request(app.getHttpServer()).get('/auth/google');

    expect(response.status).toBe(302);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    const state = cookies[0].match(/^oauth_google_state=([^;]+)/)?.[1];
    const nonce = cookies[1].match(/^oauth_google_nonce=([^;]+)/)?.[1];
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(nonce).toMatch(/^[\w-]{43}$/);
    expect(state).not.toBe(nonce);
    expect(authorizationUrl).toHaveBeenCalledWith(state, nonce);
    expect(response.headers.location).toBe(
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
    );
    for (const cookie of cookies) {
      expect(cookie).toContain('Max-Age=600');
      expect(cookie).toContain('Domain=example.com');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it.each([
    [
      'state divergente',
      'code=code&state=wrong',
      'oauth_google_state=expected; oauth_google_nonce=nonce',
    ],
    [
      'state multibyte',
      'code=code&state=%C3%A9xpected',
      'oauth_google_state=expected; oauth_google_nonce=nonce',
    ],
    [
      'state ausente',
      'code=code',
      'oauth_google_state=expected; oauth_google_nonce=nonce',
    ],
    [
      'nonce ausente',
      'code=code&state=expected',
      'oauth_google_state=expected',
    ],
    [
      'código ausente',
      'state=expected',
      'oauth_google_state=expected; oauth_google_nonce=nonce',
    ],
    [
      'cancelamento',
      'error=access_denied&state=expected',
      'oauth_google_state=expected; oauth_google_nonce=nonce',
    ],
  ])(
    'recusa callback com %s e remove cookies transitórios',
    async (_case, query, cookie) => {
      const response = await request(app.getHttpServer())
        .get(`/auth/google/callback?${query}`)
        .set('Cookie', cookie);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/login?error=google-auth',
      );
      expect(response.headers['set-cookie']).toEqual([
        expect.stringContaining('oauth_google_state=;'),
        expect.stringContaining('oauth_google_nonce=;'),
      ]);
      expect(authenticateCallback).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    [[], 'https://app.example.com/perfil'],
    [['OWNER'], 'https://app.example.com/'],
  ])(
    'cria sessão para usuário ativo com papéis %j',
    async (roles, redirectUrl) => {
      const user = { id: 'user-id', status: 'ACTIVE', roles };
      authenticateCallback.mockResolvedValue(user);
      createSession.mockResolvedValue(tokens);

      const response = await request(app.getHttpServer())
        .get('/auth/google/callback?code=authorization-code&state=expected')
        .set('Cookie', 'oauth_google_state=expected; oauth_google_nonce=nonce');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(redirectUrl);
      expect(authenticateCallback).toHaveBeenCalledWith(
        'authorization-code',
        'nonce',
      );
      expect(createSession).toHaveBeenCalledWith(user);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(4);
      expect(cookies[0]).toContain('oauth_google_state=;');
      expect(cookies[1]).toContain('oauth_google_nonce=;');
      expect(cookies[2]).toContain('access_token=access;');
      expect(cookies[3]).toContain('refresh_token=refresh;');
    },
  );

  it('não cria sessão para usuário inativo', async () => {
    authenticateCallback.mockResolvedValue({
      id: 'user-id',
      status: 'INACTIVE',
      roles: [],
    });

    const response = await request(app.getHttpServer())
      .get('/auth/google/callback?code=code&state=expected')
      .set('Cookie', 'oauth_google_state=expected; oauth_google_nonce=nonce');

    expect(response.headers.location).toBe(
      'https://app.example.com/login?error=google-auth',
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it('não expõe falha da autenticação Google no redirecionamento', async () => {
    authenticateCallback.mockRejectedValue(new Error('segredo de integração'));

    const response = await request(app.getHttpServer())
      .get('/auth/google/callback?code=code&state=expected')
      .set('Cookie', 'oauth_google_state=expected; oauth_google_nonce=nonce');

    expect(response.headers.location).toBe(
      'https://app.example.com/login?error=google-auth',
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it('não emite cookies de sessão quando a persistência falha', async () => {
    authenticateCallback.mockResolvedValue({
      id: 'user-id',
      status: 'ACTIVE',
      roles: [],
    });
    createSession.mockRejectedValue(new Error('falha ao criar sessão'));

    const response = await request(app.getHttpServer())
      .get('/auth/google/callback?code=code&state=expected')
      .set('Cookie', 'oauth_google_state=expected; oauth_google_nonce=nonce');

    expect(response.headers.location).toBe(
      'https://app.example.com/login?error=google-auth',
    );
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  function maxAge(cookie: string): number {
    return Number(cookie.match(/Max-Age=(\d+)/)?.[1]);
  }
});
