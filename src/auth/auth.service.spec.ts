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

  it('cria um usuário sem perfil inicial e uma sessão', async () => {
    const { service, prisma, tokens } = createService();
    const registeredUser = { ...user, roles: [] };
    const createUser = jest.fn().mockResolvedValue(registeredUser);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) =>
        callback({ user: { create: createUser } }),
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
      }),
    ).resolves.toMatchObject({
      user: { email: user.email, roles: [] },
      accessToken: 'access',
    });
    expect(createUser).toHaveBeenCalledWith({
      data: {
        name: user.name,
        email: user.email,
        passwordHash: 'hashed-password',
        roles: [],
      },
    });
    expect(tokens.createSession).toHaveBeenCalledWith(registeredUser);
  });

  it('não cria duas contas para o mesmo e-mail', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(
      service.register({
        name: user.name,
        email: user.email,
        password: 'a-safe-password',
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

  it('rejeita login de conta sem senha sem verificar a senha', async () => {
    const { service, prisma, passwordService } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...user, passwordHash: null });
    const verifyPassword = jest.fn();
    passwordService.verify = verifyPassword;

    await expect(
      service.login({ email: user.email, password: 'a-safe-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
