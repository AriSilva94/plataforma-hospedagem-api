import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { finished } from 'stream/promises';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApplication } from '../../src/app.config';
import { AppModule } from '../../src/app.module';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { MediaObject, MediaStorage } from '../../src/media/media-storage';
import { UsersService } from '../../src/users/users.service';

type Body = Record<string, unknown>;
type ProfileRole = 'GUEST' | 'OWNER';

export class InMemoryMediaStorage extends MediaStorage {
  readonly objects = new Map<string, string>();

  async put({ key, body, contentType }: MediaObject) {
    body.resume();
    await finished(body);
    this.objects.set(key, contentType);
  }

  delete(keys: string[]) {
    keys.forEach((key) => this.objects.delete(key));
    return Promise.resolve();
  }

  publicUrl(key: string) {
    return `https://media.test/${key}`;
  }
}

export const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);

export const publishableAddress = {
  description: 'Casa ampla perto do centro.',
  postalCode: '01310-100',
  street: 'Avenida Paulista',
  number: '1000',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};

export const roomInput = {
  title: 'Suíte',
  priceCents: 15000,
  capacity: 2,
  bathroomType: 'PRIVATE',
  acceptedAudiences: ['WOMAN'],
};

export async function createE2eApp(
  storage: InMemoryMediaStorage = new InMemoryMediaStorage(),
) {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MediaStorage)
    .useValue(storage)
    .compile();
  const app = module.createNestApplication<INestApplication<App>>();
  configureApplication(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), storage };
}

export async function createVerifiedAccount(
  app: INestApplication<App>,
  account: { name: string; email: string; password: string },
) {
  const user = await app.get(PrismaService).user.create({
    data: {
      name: account.name,
      email: account.email,
      passwordHash: await app.get(PasswordService).hash(account.password),
      emailVerifiedAt: new Date(),
      roles: [],
    },
  });
  const tokens = await app.get(TokenService).createSession(user);
  return { ...tokens, user };
}

export async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('A condição esperada não ocorreu a tempo.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export class TestAccounts {
  private readonly userIds: string[] = [];

  constructor(
    private readonly app: INestApplication<App>,
    private readonly emailPrefix: string,
  ) {}

  async create(
    roles: ProfileRole[] = ['OWNER'],
    name = 'Usuário de teste',
  ): Promise<{ id: string; email: string; cookie: string }> {
    const email = `${this.emailPrefix}-${randomUUID()}@example.com`;
    const result = await createVerifiedAccount(this.app, {
      name,
      email,
      password: 'senha-segura-de-teste',
    });
    this.userIds.push(result.user.id);
    for (const role of roles) {
      await this.app.get(UsersService).addProfile(result.user.id, role);
    }
    return {
      id: result.user.id,
      email,
      cookie: `access_token=${result.accessToken}`,
    };
  }

  async createAdmin(): Promise<string> {
    const user = await this.create([]);
    await this.app.get(PrismaService).user.update({
      where: { id: user.id },
      data: { roles: { push: 'ADMIN' } },
    });
    return user.cookie;
  }

  async removeAll(): Promise<void> {
    const prisma = this.app.get(PrismaService);
    await prisma.property.deleteMany({
      where: { ownerProfile: { userId: { in: this.userIds } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
  }
}

export async function publishProperty(
  app: INestApplication<App>,
  cookie: string,
  { property = {}, room = {} }: { property?: Body; room?: Body } = {},
): Promise<{ propertyId: string; roomId: string }> {
  const http = () => request(app.getHttpServer());
  const created = await http()
    .post('/owner/properties')
    .set('Cookie', cookie)
    .send({
      title: 'Casa Teste',
      type: 'HOUSE',
      ...publishableAddress,
      ...property,
    })
    .expect(201);
  const propertyId = (created.body as { id: string }).id;
  await http()
    .post(`/owner/properties/${propertyId}/media`)
    .set('Cookie', cookie)
    .attach('file', png, 'capa.png')
    .expect(201);
  const createdRoom = await http()
    .post(`/owner/properties/${propertyId}/rooms`)
    .set('Cookie', cookie)
    .send({ ...roomInput, ...room })
    .expect(201);
  await http()
    .patch(`/owner/properties/${propertyId}/status`)
    .set('Cookie', cookie)
    .send({ status: 'ACTIVE' })
    .expect(200);
  return { propertyId, roomId: (createdRoom.body as { id: string }).id };
}
