import {
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
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

  const registration = {
    name: user.name,
    email: user.email,
    password: 'a-safe-password',
  };

  function createService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      passwordResetToken: {
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
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    };
    const queue = {
      enqueueWelcome: jest.fn().mockResolvedValue(undefined),
      enqueuePasswordReset: jest.fn().mockResolvedValue(undefined),
      enqueuePasswordChanged: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new AuthService(
        prisma as never,
        passwordService,
        tokens as never,
        email as never,
        queue as never,
      ),
      prisma,
      passwordService,
      tokens,
      email,
      queue,
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

    await expect(service.register(registration)).resolves.toMatchObject({
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

  function mockSuccessfulRegistration({
    prisma,
    tokens,
  }: ReturnType<typeof createService>) {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) =>
        callback({
          user: { create: jest.fn().mockResolvedValue({ ...user, roles: [] }) },
        }),
    );
    tokens.createSession.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  }

  it('enfileira o e-mail de boas-vindas após o cadastro', async () => {
    const context = createService();
    mockSuccessfulRegistration(context);

    await context.service.register(registration);

    expect(context.queue.enqueueWelcome).toHaveBeenCalledWith(user.id);
    expect(context.email.sendWelcome).not.toHaveBeenCalled();
  });

  it('conclui o cadastro mesmo quando a fila de e-mails está indisponível', async () => {
    const context = createService();
    mockSuccessfulRegistration(context);
    context.queue.enqueueWelcome.mockRejectedValue(
      new Error('Redis indisponível'),
    );
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(context.service.register(registration)).resolves.toMatchObject(
      { accessToken: 'access' },
    );
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });

  it('não cria duas contas para o mesmo e-mail', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(service.register(registration)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    ['e-mail sem conta', null],
    ['conta inativa', { ...user, status: 'INACTIVE' }],
  ])('não emite redefinição de senha para %s', async (_case, found) => {
    const { service, prisma, email } = createService();
    prisma.user.findUnique.mockResolvedValue(found);

    await service.issuePasswordReset(user.email);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('propaga a falha de envio da redefinição para a fila tentar de novo', async () => {
    const { service, prisma, email } = createService();
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.$transaction.mockResolvedValue(undefined);
    email.sendPasswordReset.mockRejectedValue(new Error('SMTP indisponível'));

    await expect(service.issuePasswordReset(user.email)).rejects.toThrow(
      'SMTP indisponível',
    );
  });

  it('enfileira o pedido de redefinição sem consultar a conta', async () => {
    const { service, prisma, queue, email } = createService();

    await service.requestPasswordReset({ email: user.email });

    expect(queue.enqueuePasswordReset).toHaveBeenCalledWith(user.email);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it.each([
    ['expirado', { expiresAt: new Date(Date.now() - 1000) }],
    ['já usado', { usedAt: new Date() }],
    ['de conta inativa', { user: { email: user.email, status: 'INACTIVE' } }],
  ])('rejeita token de redefinição %s', async (_case, overrides) => {
    const { service, prisma, passwordService } = createService();
    const hash = jest.fn();
    passwordService.hash = hash;
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { email: user.email, status: 'ACTIVE' },
      ...overrides,
    });

    await expect(
      service.resetPassword({
        token: 'a'.repeat(64),
        password: 'a-safe-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(hash).not.toHaveBeenCalled();
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
