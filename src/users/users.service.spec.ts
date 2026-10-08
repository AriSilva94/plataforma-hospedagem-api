import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('atualiza apenas os dados do usuário autenticado', async () => {
    const prisma = {
      user: {
        update: jest.fn().mockResolvedValue({
          id: 'user-a',
          name: 'Novo nome',
          email: 'ana@example.com',
        }),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.updateMe('user-a', { name: 'Novo nome' }),
    ).resolves.toMatchObject({ name: 'Novo nome' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { name: 'Novo nome' },
    });
  });

  it('não cria o perfil duas vezes quando outra solicitação já incluiu o papel', async () => {
    const transaction = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ownerProfile: { create: jest.fn() },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'user-a', roles: ['GUEST'] })
          .mockResolvedValueOnce({ id: 'user-a', roles: ['GUEST', 'OWNER'] }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    const service = new UsersService(prisma as never);

    await expect(service.addProfile('user-a', 'OWNER')).resolves.toMatchObject({
      roles: ['GUEST', 'OWNER'],
    });
    expect(transaction.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a', NOT: { roles: { has: 'OWNER' } } },
      }),
    );
    expect(transaction.ownerProfile.create).not.toHaveBeenCalled();
  });

  it('retorna erro quando o usuário autenticado não existe', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new UsersService(prisma as never);

    await expect(service.getMe('missing-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
