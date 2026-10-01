import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { TestAccounts, createE2eApp, publishProperty } from './support/e2e';

type Body = Record<string, unknown>;
type Overview = {
  users: Record<string, number>;
  properties: Record<string, number>;
  rooms: Record<string, number | null>;
  featuring: Record<string, number>;
};
type Page<T> = { items: T[]; total: number };

describe('Administração (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accounts: TestAccounts;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    accounts = new TestAccounts(app, 'admin-e2e');
  });

  const http = () => request(app.getHttpServer());
  const account = (roles: ('GUEST' | 'OWNER')[], name?: string) =>
    accounts.create(roles, name);
  const admin = () => accounts.createAdmin();
  const publishedProperty = (cookie: string, title: string) =>
    publishProperty(app, cookie, {
      property: { title },
      room: { title: `${title} quarto` },
    });

  const overview = async (cookie: string) =>
    (await http().get('/admin/overview').set('Cookie', cookie).expect(200))
      .body as Overview;

  it('exige papel ADMIN em todas as rotas administrativas', async () => {
    const owner = await account(['OWNER', 'GUEST']);
    for (const path of [
      '/admin/overview',
      '/admin/users',
      '/admin/properties',
      '/admin/rooms',
    ]) {
      await http().get(path).expect(401);
      await http().get(path).set('Cookie', owner.cookie).expect(403);
    }
  });

  it('resume usuários, imóveis, quartos e destaques a partir do banco', async () => {
    const adminCookie = await admin();
    const before = await overview(adminCookie);

    const owner = await account(['OWNER']);
    await account(['GUEST']);
    const listed = await publishedProperty(owner.cookie, 'Resumo publicado');
    await http()
      .post('/owner/properties')
      .set('Cookie', owner.cookie)
      .send({ title: 'Resumo rascunho', type: 'HOUSE' })
      .expect(201);
    await http()
      .put(`/admin/rooms/${listed.roomId}/featured`)
      .set('Cookie', adminCookie)
      .send({
        featuredFrom: new Date(Date.now() - 60_000).toISOString(),
        featuredUntil: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(200);

    const after = await overview(adminCookie);
    const grew = (current: number | null, previous: number | null) =>
      (current ?? 0) - (previous ?? 0);

    expect(grew(after.users.total, before.users.total)).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      grew(after.users.owners, before.users.owners),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.users.guests, before.users.guests),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.users.newLast7Days, before.users.newLast7Days),
    ).toBeGreaterThanOrEqual(2);
    expect(
      grew(after.properties.active, before.properties.active),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.properties.draft, before.properties.draft),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.properties.listed, before.properties.listed),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.rooms.listed, before.rooms.listed),
    ).toBeGreaterThanOrEqual(1);
    expect(
      grew(after.featuring.active, before.featuring.active),
    ).toBeGreaterThanOrEqual(1);
    expect(after.properties.total).toBe(
      after.properties.active +
        after.properties.unavailable +
        after.properties.draft,
    );
    expect(after.rooms.averageListedCompleteness).toEqual(expect.any(Number));
    expect(after.rooms.lowCompletenessThreshold).toBe(50);
  });

  it('lista usuários com busca e filtros, sem dados sensíveis', async () => {
    const adminCookie = await admin();
    const token = randomUUID().slice(0, 8);
    const owner = await account(['OWNER'], `Dona ${token}`);
    const guest = await account(['GUEST'], `Hóspede ${token}`);
    await http()
      .patch('/users/me/profiles/guest')
      .set('Cookie', guest.cookie)
      .send({ genderIdentity: 'WOMAN' })
      .expect(200);
    await publishedProperty(owner.cookie, `Imóvel ${token}`);

    const search = async (query: string) =>
      (
        await http()
          .get(`/admin/users?q=${token}${query}`)
          .set('Cookie', adminCookie)
          .expect(200)
      ).body as Page<Body>;

    const all = await search('');
    expect(all.total).toBe(2);
    const ownerItem = all.items.find((item) => item.id === owner.id);
    expect(ownerItem).toMatchObject({
      email: owner.email,
      status: 'ACTIVE',
      roles: ['OWNER'],
      propertyCount: 1,
    });
    for (const item of all.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'createdAt',
          'email',
          'id',
          'name',
          'propertyCount',
          'roles',
          'status',
        ].sort(),
      );
    }

    const guests = await search('&role=GUEST');
    expect(guests.items.map((item) => item.id)).toEqual([guest.id]);

    await prisma.user.update({
      where: { id: guest.id },
      data: { status: 'INACTIVE' },
    });
    const inactive = await search('&status=INACTIVE');
    expect(inactive.items.map((item) => item.id)).toEqual([guest.id]);

    await http()
      .get('/admin/users?role=SUPER')
      .set('Cookie', adminCookie)
      .expect(400);
  });

  it('lista imóveis com proprietário, quartos e visibilidade na home', async () => {
    const adminCookie = await admin();
    const token = randomUUID().slice(0, 8);
    const owner = await account(['OWNER'], `Dono ${token}`);
    const listed = await publishedProperty(owner.cookie, `Casa ${token} A`);
    const paused = await publishedProperty(owner.cookie, `Casa ${token} B`);
    await http()
      .patch(`/owner/properties/${paused.propertyId}/status`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);

    const response = await http()
      .get(`/admin/properties?q=${token}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const body = response.body as Page<Body>;

    expect(body.total).toBe(2);
    expect(
      body.items.find((item) => item.id === listed.propertyId),
    ).toMatchObject({
      status: 'ACTIVE',
      listed: true,
      roomCount: 1,
      availableRoomCount: 1,
      owner: { name: `Dono ${token}`, email: owner.email },
    });
    expect(
      body.items.find((item) => item.id === paused.propertyId),
    ).toMatchObject({
      status: 'UNAVAILABLE',
      listed: false,
    });
    for (const item of body.items) {
      for (const key of ['street', 'number', 'postalCode', 'complement']) {
        expect(item).not.toHaveProperty(key);
      }
    }

    const byOwnerEmail = await http()
      .get(
        `/admin/properties?q=${encodeURIComponent(owner.email)}&status=UNAVAILABLE`,
      )
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (byOwnerEmail.body as Page<Body>).items.map((item) => item.id),
    ).toEqual([paused.propertyId]);
  });

  it('ordena quartos por completude e filtra pela visibilidade na home', async () => {
    const adminCookie = await admin();
    const token = randomUUID().slice(0, 8);
    const owner = await account(['OWNER']);
    const complete = await publishedProperty(owner.cookie, `Completo ${token}`);
    const sparse = await publishedProperty(owner.cookie, `Simples ${token}`);
    await http()
      .patch(`/owner/rooms/${complete.roomId}`)
      .set('Cookie', owner.cookie)
      .send({ description: 'Quarto amplo.', amenities: ['DESK'] })
      .expect(200);
    await http()
      .patch(`/owner/rooms/${sparse.roomId}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);

    type Room = { id: string; completenessScore: number; listed: boolean };
    const list = async (query: string) =>
      (
        await http()
          .get(`/admin/rooms?q=${token}${query}`)
          .set('Cookie', adminCookie)
          .expect(200)
      ).body as Page<Room>;

    const byCompleteness = await list('&sort=completeness');
    expect(byCompleteness.items.map((room) => room.id)).toEqual([
      sparse.roomId,
      complete.roomId,
    ]);
    expect(byCompleteness.items[0].completenessScore).toBeLessThan(
      byCompleteness.items[1].completenessScore,
    );

    expect((await list('&listed=true')).items.map((room) => room.id)).toEqual([
      complete.roomId,
    ]);
    expect((await list('&listed=false')).items.map((room) => room.id)).toEqual([
      sparse.roomId,
    ]);
    await http()
      .get('/admin/rooms?sort=price')
      .set('Cookie', adminCookie)
      .expect(400);
  });

  afterAll(async () => {
    await accounts?.removeAll();
    await app?.close();
  });
});
