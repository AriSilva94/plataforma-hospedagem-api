import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UsersService } from './users.service';

const mediaServiceStub = { publicUrl: jest.fn().mockReturnValue(null) };

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
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );

    await expect(
      service.updateMe('user-a', { name: 'Novo nome' }),
    ).resolves.toMatchObject({ name: 'Novo nome' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { name: 'Novo nome' },
      include: { guestProfile: true, ownerProfile: true },
    });
  });

  it('grava e limpa os dados pessoais opcionais', async () => {
    const prisma = {
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          city: 'Recife',
          ownerProfile: { _count: { properties: 0 } },
        }),
      },
    };
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );

    await service.updateMe('user-a', {
      phone: '+5511912345678',
      birthDate: '1990-05-10',
      city: null,
      state: 'SP',
    });
    await expect(
      service.updateMe('user-a', { state: 'SP' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          phone: '+5511912345678',
          birthDate: new Date('1990-05-10'),
          city: null,
          state: 'SP',
        },
      }),
    );
  });

  it('impede quem tem imóveis de apagar dados exigidos para anunciar', async () => {
    const prisma = {
      user: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          phone: '+5511912345678',
          birthDate: new Date('1990-05-10'),
          city: 'Recife',
          state: 'PE',
          ownerProfile: { _count: { properties: 1 } },
        }),
      },
    };
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );

    await expect(
      service.updateMe('user-a', { city: null }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('aceita quem completa 18 anos hoje e recusa quem ainda não completou', async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );
    const eighteenthBirthday = (daysFromToday: number) => {
      const now = new Date();
      return new Date(
        Date.UTC(
          now.getUTCFullYear() - 18,
          now.getUTCMonth(),
          now.getUTCDate() + daysFromToday,
        ),
      )
        .toISOString()
        .slice(0, 10);
    };

    await expect(
      service.updateMe('user-a', { birthDate: eighteenthBirthday(0) }),
    ).resolves.toBeDefined();
    await expect(
      service.updateMe('user-a', { birthDate: eighteenthBirthday(1) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['1899-12-31', '2999-01-01'])(
    'recusa a data de nascimento %s',
    async (birthDate) => {
      const prisma = { user: { update: jest.fn() } };
      const service = new UsersService(
        prisma as never,
        mediaServiceStub as never,
      );

      await expect(
        service.updateMe('user-a', { birthDate }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

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
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );

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
    const service = new UsersService(
      prisma as never,
      mediaServiceStub as never,
    );

    await expect(service.getMe('missing-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
