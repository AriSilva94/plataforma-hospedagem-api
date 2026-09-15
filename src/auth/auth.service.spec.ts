import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

describe('AuthService', () => {
  const user = {
    id: 'user-id',
    name: 'Ana Silva',
    email: 'ana@example.com',
    passwordHash: 'hash',
    status: 'ACTIVE',
    roles: ['GUEST'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const passwordService = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      verify: jest.fn(),
    } as unknown as PasswordService;
    const tokens = {
      createSession: jest.fn(),
      rotateSession: jest.fn(),
      revokeSession: jest.fn(),
    };
    const email = {
      sendPasswordReset: jest.fn(),
    };

    return {
      service: new AuthService(
        prisma as never,
        passwordService,
        tokens as never,
        email as never,
      ),
      prisma,
      passwordService,
      tokens,
      email,
    };
  }

  it('cria um usuário com o perfil inicial e uma sessão', async () => {
    const { service, prisma, tokens } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) =>
        callback({ user: { create: jest.fn().mockResolvedValue(user) } }),
    );
    tokens.createSession.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });

    await expect(
      service.register({
        name: user.name,
        email: user.email,
        password: 'a-safe-password',
        role: 'GUEST',
      }),
    ).resolves.toMatchObject({
      user: { email: user.email },
      accessToken: 'access',
    });
  });

  it('não cria duas contas para o mesmo e-mail', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(
      service.register({
        name: user.name,
        email: user.email,
        password: 'a-safe-password',
        role: 'GUEST',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita login com senha inválida sem expor a existência da conta', async () => {
    const { service, prisma, passwordService } = createService();
    prisma.user.findUnique.mockResolvedValue(user);
    passwordService.verify = jest.fn().mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
