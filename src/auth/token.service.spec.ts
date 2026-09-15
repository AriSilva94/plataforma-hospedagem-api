import { UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { TokenService } from './token.service';

describe('TokenService', () => {
  it('rejeita refresh token quando outra solicitação já revogou a sessão', async () => {
    const prisma = {
      authSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-id',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          refreshTokenHash: 'refresh-token-hash',
          user: { id: 'user-id', roles: ['GUEST'] },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const passwordService = { verify: jest.fn().mockResolvedValue(true) };
    const environmentService = {
      getOrThrow: jest.fn((name: string) => {
        if (name === 'REFRESH_TOKEN_SECRET') {
          return 'refresh-secret';
        }
        return '30d';
      }),
    };
    const service = new TokenService(
      prisma as never,
      passwordService as never,
      environmentService as never,
    );
    const refreshToken = sign(
      { sub: 'user-id', sessionId: 'session-id' },
      'refresh-secret',
    );

    await expect(service.rotateSession(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-id', revokedAt: null },
      }),
    );
  });
});
