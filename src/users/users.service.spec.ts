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
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a' },
        data: { name: 'Novo nome' },
      }),
    );
  });

  it('retorna erro quando o usuário autenticado não existe', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new UsersService(prisma as never);

    await expect(service.getMe('missing-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
