import { UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { TokenService } from './token.service';

describe('TokenService', () => {
  function activeSession(overrides: Record<string, unknown> = {}) {
    return {
      id: 'session-id',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'refresh-token-hash',
      user: { id: 'user-id', roles: ['GUEST'], status: 'ACTIVE' },
      ...overrides,
    };
  }

  function createService(session: unknown, updatedCount = 0) {
    const authSession = {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(session),
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: { authSession: typeof authSession }) => unknown) =>
          callback({ authSession }),
      ),
      authSession,
    };
    const passwordService = { verify: jest.fn().mockResolvedValue(true) };
    const environmentService = {
      getOrThrow: jest.fn((name: string) => {
        if (name === 'REFRESH_TOKEN_SECRET') {
          return 'refresh-secret';
        }
        if (name === 'ACCESS_TOKEN_SECRET') {
          return 'access-secret';
        }
        return '30d';
      }),
    };

    return {
      service: new TokenService(
        prisma as never,
        passwordService as never,
        environmentService as never,
      ),
      prisma,
    };
  }

  const refreshToken = sign(
    { sub: 'user-id', sessionId: 'session-id' },
    'refresh-secret',
  );

  it('rejeita refresh token quando outra solicitação já revogou a sessão', async () => {
    const { service, prisma } = createService(activeSession());

    await expect(service.rotateSession(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-id', revokedAt: null },
      }),
    );
  });

  it('não renova a sessão de um usuário inativo', async () => {
    const { service, prisma } = createService(
      activeSession({
        user: { id: 'user-id', roles: ['GUEST'], status: 'INACTIVE' },
      }),
    );

    await expect(service.rotateSession(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('converte refresh token inválido em 401', async () => {
    const { service } = createService(activeSession());

    await expect(service.rotateSession('not-a-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('propaga falhas de persistência ao revogar a sessão', async () => {
    const { service, prisma } = createService(activeSession());
    prisma.authSession.updateMany.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(service.revokeSession(refreshToken)).rejects.toThrow(
      'database unavailable',
    );
  });

  it('recusa access token de uma sessão revogada', async () => {
    const { service } = createService(activeSession({ revokedAt: new Date() }));
    const accessToken = sign(
      { sub: 'user-id', roles: ['GUEST'], sessionId: 'session-id' },
      'access-secret',
    );

    await expect(service.authenticate(accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('autoriza access token de uma sessão ativa', async () => {
    const { service } = createService(activeSession());
    const accessToken = sign(
      { sub: 'user-id', roles: ['GUEST'], sessionId: 'session-id' },
      'access-secret',
    );

    await expect(service.authenticate(accessToken)).resolves.toEqual({
      id: 'user-id',
      roles: ['GUEST'],
    });
  });

  it('recusa access token cujo titular difere do dono da sessão', async () => {
    const { service } = createService(activeSession());
    const token = sign(
      { sub: 'another-user', roles: ['GUEST'], sessionId: 'session-id' },
      'access-secret',
    );
    await expect(service.authenticate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
