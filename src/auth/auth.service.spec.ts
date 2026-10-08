import { UnauthorizedException } from '@nestjs/common';
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
      pendingRegistration: {
        create: jest.fn(),
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
      enqueueRegistration: jest.fn().mockResolvedValue(undefined),
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

  it('guarda o cadastro como pendente e enfileira a confirmação sem criar conta', async () => {
    const { service, prisma, queue, tokens } = createService();
    prisma.pendingRegistration.create.mockResolvedValue({
      id: 'pending-id',
      email: user.email,
    });

    await expect(service.register(registration)).resolves.toBeUndefined();

    expect(prisma.pendingRegistration.create).toHaveBeenCalledWith({
      data: {
        name: user.name,
        email: user.email,
        passwordHash: 'hashed-password',
        expiresAt: expect.any(Date) as Date,
      },
    });
    expect(queue.enqueueRegistration).toHaveBeenCalledWith(
      'pending-id',
      user.email,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(tokens.createSession).not.toHaveBeenCalled();
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
    [
      'de conta inativa',
      { user: { status: 'INACTIVE', emailVerifiedAt: null } },
    ],
  ])('rejeita token de redefinição %s', async (_case, overrides) => {
    const { service, prisma, passwordService } = createService();
    const hash = jest.fn();
    passwordService.hash = hash;
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: 'ACTIVE', emailVerifiedAt: null },
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
