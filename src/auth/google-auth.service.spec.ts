import { UnauthorizedException } from '@nestjs/common';
import { AuthProvider } from '../generated/prisma/client';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRemoteJWKSet } from 'jose';
import { GoogleAuthService } from './google-auth.service';

jest.mock('jose', () => {
  const actual = jest.requireActual<typeof import('jose')>('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn(() =>
      actual.createLocalJWKSet({ keys: [jwk] }),
    ),
  };
});

const clientId = 'google-client-id';
const callbackUrl = 'http://localhost:3030/auth/google/callback';
const nonce = 'expected-nonce';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kty: 'RSA',
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};

type Claims = Record<string, unknown>;

function makeIdToken(overrides: Claims = {}, signingKey = privateKey): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce,
      sub: 'google-subject',
      email: 'Ana@Example.com',
      email_verified: true,
      name: 'Ana Silva',
      ...overrides,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url')}`;
}

const user = {
  id: 'user-id',
  name: 'Ana Silva',
  email: 'ana@example.com',
  passwordHash: null,
  status: 'ACTIVE',
  roles: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createService() {
  const transaction = {
    externalAuthIdentity: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ userId: user.id }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(user),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const environment = {
    getOrThrow: jest.fn(
      (name: string) =>
        ({
          GOOGLE_CLIENT_ID: clientId,
          GOOGLE_CLIENT_SECRET: 'server-secret',
          GOOGLE_CALLBACK_URL: callbackUrl,
        })[
          name as
            'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_CALLBACK_URL'
        ],
    ),
  };
  const service = new GoogleAuthService(prisma as never, environment as never);
  return { service, prisma };
}

function mockGoogle(idToken: string | undefined, tokenStatus = 200): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(idToken ? { id_token: idToken } : {}), {
      status: tokenStatus,
    }),
  );
  global.fetch = fetchMock;
  return fetchMock;
}

describe('GoogleAuthService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('monta a autorização com escopos mínimos, state e nonce', () => {
    const { service } = createService();
    const url = new URL(service.authorizationUrl('expected-state', nonce));

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'expected-state',
      nonce,
    });
  });

  it('troca o código no endpoint Google com credenciais somente no corpo', async () => {
    const { service } = createService();
    const fetchMock = mockGoogle(makeIdToken());

    await service.authenticateCallback('authorization-code', nonce);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      code: 'authorization-code',
      client_id: clientId,
      client_secret: 'server-secret',
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    });
  });

  it.each([
    ['resposta HTTP inválida', () => new Response('{}', { status: 401 })],
    ['JSON malformado', () => new Response('invalid-json', { status: 200 })],
    ['id_token ausente', () => new Response('{}', { status: 200 })],
  ])('rejeita %s na troca de código', async (_label, tokenResponse) => {
    const { service, prisma } = createService();
    global.fetch = jest.fn().mockResolvedValue(tokenResponse());

    await expect(
      service.authenticateCallback('code', nonce),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['assinatura', () => makeIdToken({}, otherPrivateKey)],
    ['issuer', () => makeIdToken({ iss: 'https://attacker.example' })],
    ['audience', () => makeIdToken({ aud: 'another-client' })],
    [
      'expiração',
      () => makeIdToken({ exp: Math.floor(Date.now() / 1000) - 1 }),
    ],
    ['exp ausente', () => makeIdToken({ exp: undefined })],
    ['nonce', () => makeIdToken({ nonce: 'other-nonce' })],
    ['sub', () => makeIdToken({ sub: '' })],
    ['email', () => makeIdToken({ email: 123 })],
    ['formato do e-mail', () => makeIdToken({ email: 'not-an-email' })],
    ['email_verified', () => makeIdToken({ email_verified: 'true' })],
    ['name', () => makeIdToken({ name: '' })],
  ])('rejeita ID token com %s inválido', async (_label, token) => {
    const { service, prisma } = createService();
    mockGoogle(token());

    await expect(
      service.authenticateCallback('code', nonce),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aceita ambos os issuers oficiais e procura a identidade pelo subject', async () => {
    const { service, prisma } = createService();
    const inactiveUser = { ...user, status: 'INACTIVE' };
    prisma.externalAuthIdentity.findUnique.mockResolvedValue({
      user: inactiveUser,
    });
    mockGoogle(makeIdToken({ iss: 'accounts.google.com' }));

    await expect(service.authenticateCallback('code', nonce)).resolves.toEqual(
      inactiveUser,
    );
    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://www.googleapis.com/oauth2/v3/certs'),
    );
    expect(prisma.externalAuthIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerSubject: {
          provider: AuthProvider.GOOGLE,
          providerSubject: 'google-subject',
        },
      },
      include: { user: true },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('vincula e-mail verificado à conta existente sem criar usuário', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(user);
    mockGoogle(makeIdToken());

    await expect(service.authenticateCallback('code', nonce)).resolves.toEqual(
      user,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'ana@example.com' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.externalAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        provider: AuthProvider.GOOGLE,
        providerSubject: 'google-subject',
        userId: user.id,
      },
    });
  });

  it('cria usuário sem senha ou perfis e a identidade quando não há conta', async () => {
    const { service, prisma } = createService();
    mockGoogle(makeIdToken());

    await expect(service.authenticateCallback('code', nonce)).resolves.toEqual(
      user,
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Ana Silva',
        email: 'ana@example.com',
        passwordHash: null,
        roles: [],
      },
    });
    expect(prisma.externalAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        provider: AuthProvider.GOOGLE,
        providerSubject: 'google-subject',
        userId: user.id,
      },
    });
  });

  it('relê a identidade persistida após conflito único concorrente', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.externalAuthIdentity.create.mockRejectedValue({ code: 'P2002' });
    prisma.externalAuthIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user });
    mockGoogle(makeIdToken());

    await expect(service.authenticateCallback('code', nonce)).resolves.toEqual(
      user,
    );
    expect(prisma.externalAuthIdentity.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('não silencia erro único sem identidade persistida', async () => {
    const { service, prisma } = createService();
    const error = { code: 'P2002' };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.externalAuthIdentity.create.mockRejectedValue(error);
    mockGoogle(makeIdToken());

    await expect(service.authenticateCallback('code', nonce)).rejects.toBe(
      error,
    );
  });
});
