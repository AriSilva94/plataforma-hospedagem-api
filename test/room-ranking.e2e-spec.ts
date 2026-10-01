import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RoomRankingService } from '../src/ranking/room-ranking.service';
import { RANKING_VERSION } from '../src/ranking/room-ranking';
import {
  TestAccounts,
  createE2eApp,
  png,
  publishProperty,
  publishableAddress,
} from './support/e2e';

type Body = Record<string, unknown>;
type ListedRoom = { id: string; featured: boolean };
type RoomPage = { items: ListedRoom[]; nextCursor: string | null };

const day = 24 * 60 * 60 * 1000;
const propertyTitle = 'Casa Ranking';

describe('Ranking, completude e destaque de quartos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accounts: TestAccounts;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    accounts = new TestAccounts(app, 'ranking');
  });

  const http = () => request(app.getHttpServer());
  const account = () => accounts.create();
  const admin = () => accounts.createAdmin();
  const publishedRoom = (cookie: string, room: Body = {}) =>
    publishProperty(app, cookie, { property: { title: propertyTitle }, room });

  function storedRanking(roomId: string) {
    return prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: {
        completenessScore: true,
        rankingScore: true,
        rankingVersion: true,
        rankingUpdatedAt: true,
      },
    });
  }

  async function listAll(limit: number): Promise<ListedRoom[]> {
    const items: ListedRoom[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const query: string = cursor
        ? `/rooms?limit=${limit}&cursor=${cursor}`
        : `/rooms?limit=${limit}`;
      const response = await http().get(query).expect(200);
      const body = response.body as RoomPage;
      items.push(...body.items);
      cursor = body.nextCursor;
      if (!cursor) {
        return items;
      }
    }
    throw new Error('Paginação não terminou.');
  }

  function positionsOf(items: ListedRoom[], ids: string[]) {
    return ids.map((id) => items.findIndex((item) => item.id === id));
  }

  function feature(
    cookie: string,
    roomId: string,
    from: number,
    until: number,
  ) {
    const now = Date.now();
    return http()
      .put(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', cookie)
      .send({
        featuredFrom: new Date(now + from).toISOString(),
        featuredUntil: new Date(now + until).toISOString(),
      });
  }

  it('calcula e persiste completude e ranking ao criar e recalcula após alterações relevantes', async () => {
    const owner = await account();
    const { propertyId, roomId } = await publishedRoom(owner.cookie);

    const initial = await storedRanking(roomId);
    expect(initial.rankingVersion).toBe(RANKING_VERSION);
    expect(initial.rankingUpdatedAt).not.toBeNull();
    expect(initial.completenessScore).toBeGreaterThan(0);
    expect(initial.completenessScore).toBeLessThan(100);
    expect(initial.rankingScore).toBe(initial.completenessScore);

    const roomDetail = await http()
      .get(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(roomDetail.body).toMatchObject({
      completenessScore: initial.completenessScore,
    });
    expect((roomDetail.body as Body).completenessMissing).toEqual(
      expect.arrayContaining(['HOUSE_RULES', 'ROOM_PHOTOS']),
    );
    for (const key of [
      'rankingScore',
      'rankingVersion',
      'featuredFrom',
      'featuredUntil',
    ]) {
      expect(roomDetail.body).not.toHaveProperty(key);
    }

    await http()
      .patch(`/owner/properties/${propertyId}`)
      .set('Cookie', owner.cookie)
      .send({ houseRules: 'Silêncio após 22h.' })
      .expect(200);
    const afterProperty = await storedRanking(roomId);
    expect(afterProperty.completenessScore).toBeGreaterThan(
      initial.completenessScore,
    );

    await http()
      .post(`/owner/rooms/${roomId}/media`)
      .set('Cookie', owner.cookie)
      .attach('file', png, 'quarto.png')
      .expect(201);
    const afterMedia = await storedRanking(roomId);
    expect(afterMedia.completenessScore).toBeGreaterThan(
      afterProperty.completenessScore,
    );
    expect(afterMedia.rankingScore).toBe(afterMedia.completenessScore);

    const hub = await http()
      .get(`/owner/properties/${propertyId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const hubRoom = (hub.body as { rooms: Body[] }).rooms[0];
    expect(hubRoom).toMatchObject({
      id: roomId,
      completenessScore: afterMedia.completenessScore,
    });
    expect(hubRoom).not.toHaveProperty('rankingScore');

    await http()
      .patch(`/owner/properties/${propertyId}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Casa Renomeada' })
      .expect(200);
    expect((await storedRanking(roomId)).rankingUpdatedAt).toEqual(
      afterMedia.rankingUpdatedAt,
    );
  });

  it('recalcula registros antigos sem versão de ranking (backfill)', async () => {
    const owner = await account();
    const { roomId } = await publishedRoom(owner.cookie, {
      description: 'Quarto silencioso.',
    });
    const expected = await storedRanking(roomId);
    await prisma.$executeRaw`
      UPDATE rooms
      SET completeness_score = 0, ranking_score = 0, ranking_version = 0, ranking_updated_at = NULL
      WHERE id = ${roomId}::uuid`;

    const updated = await app.get(RoomRankingService).recalculateStale();

    expect(updated).toBeGreaterThanOrEqual(1);
    expect(await storedRanking(roomId)).toMatchObject({
      completenessScore: expected.completenessScore,
      rankingScore: expected.rankingScore,
      rankingVersion: RANKING_VERSION,
    });
  });

  it('ordena por destaque ativo, depois rankingScore, sem incluir quartos inelegíveis', async () => {
    const owner = await account();
    const adminCookie = await admin();
    const low = await publishedRoom(owner.cookie);
    const high = await publishedRoom(owner.cookie);
    const featured = await publishedRoom(owner.cookie);
    const expired = await publishedRoom(owner.cookie);
    const pausedFeatured = await publishedRoom(owner.cookie);
    const unavailablePropertyFeatured = await publishedRoom(owner.cookie);

    await prisma.room.update({
      where: { id: low.roomId },
      data: { rankingScore: 10 },
    });
    await prisma.room.update({
      where: { id: high.roomId },
      data: { rankingScore: 95 },
    });
    await prisma.room.update({
      where: { id: featured.roomId },
      data: { rankingScore: 1 },
    });
    await prisma.room.update({
      where: { id: expired.roomId },
      data: { rankingScore: 5 },
    });

    for (const room of [
      featured,
      pausedFeatured,
      unavailablePropertyFeatured,
    ]) {
      await feature(adminCookie, room.roomId, -day, day).expect(200);
    }
    await prisma.room.update({
      where: { id: expired.roomId },
      data: {
        featuredFrom: new Date(Date.now() - 2 * day),
        featuredUntil: new Date(Date.now() - day),
      },
    });
    await http()
      .patch(`/owner/rooms/${pausedFeatured.roomId}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);
    await http()
      .patch(
        `/owner/properties/${unavailablePropertyFeatured.propertyId}/status`,
      )
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);

    const items = await listAll(48);
    const [featuredAt, highAt, lowAt, expiredAt] = positionsOf(items, [
      featured.roomId,
      high.roomId,
      low.roomId,
      expired.roomId,
    ]);

    expect(featuredAt).toBeGreaterThanOrEqual(0);
    expect(featuredAt).toBeLessThan(highAt);
    expect(highAt).toBeLessThan(lowAt);
    expect(lowAt).toBeLessThan(expiredAt);
    expect(items[featuredAt].featured).toBe(true);
    expect(items[expiredAt].featured).toBe(false);
    expect(items[highAt].featured).toBe(false);
    expect(items.findIndex((item) => !item.featured)).toBeGreaterThan(
      items.map((item) => item.featured).lastIndexOf(true),
    );
    expect(
      positionsOf(items, [
        pausedFeatured.roomId,
        unavailablePropertyFeatured.roomId,
      ]),
    ).toEqual([-1, -1]);
  });

  it('não lista quartos de proprietário inativo, mesmo destacados', async () => {
    const owner = await account();
    const adminCookie = await admin();
    const room = await publishedRoom(owner.cookie);
    await feature(adminCookie, room.roomId, -day, day).expect(200);
    expect(
      positionsOf(await listAll(48), [room.roomId])[0],
    ).toBeGreaterThanOrEqual(0);

    await prisma.user.update({
      where: { id: owner.id },
      data: { status: 'INACTIVE' },
    });

    expect(positionsOf(await listAll(48), [room.roomId])).toEqual([-1]);
    await http().get(`/properties/${room.propertyId}`).expect(404);
  });

  it('mantém o destaque avaliado na primeira página quando ele expira durante a paginação', async () => {
    const owner = await account();
    const adminCookie = await admin();
    const expiring = await publishedRoom(owner.cookie);
    await feature(adminCookie, expiring.roomId, -day, day).expect(200);

    const seen: ListedRoom[] = [];
    let cursor: string | null = null;
    let expired = false;
    for (let page = 0; page < 1000; page++) {
      const query: string = cursor
        ? `/rooms?limit=1&cursor=${cursor}`
        : '/rooms?limit=1';
      const body = (await http().get(query).expect(200)).body as RoomPage;
      seen.push(...body.items);
      if (!expired && body.items.some((item) => item.id === expiring.roomId)) {
        await prisma.room.update({
          where: { id: expiring.roomId },
          data: {
            featuredUntil: new Date(),
          },
        });
        expired = true;
      }
      cursor = body.nextCursor;
      if (!cursor) {
        break;
      }
    }

    const occurrences = seen.filter((item) => item.id === expiring.roomId);
    expect(expired).toBe(true);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].featured).toBe(true);
    expect(new Set(seen.map((item) => item.id)).size).toBe(seen.length);

    const fresh = await listAll(48);
    expect(fresh.find((item) => item.id === expiring.roomId)).toMatchObject({
      featured: false,
    });
  });

  it('pagina por cursor sem duplicar nem pular quartos com o mesmo rankingScore', async () => {
    const owner = await account();
    const rooms = [];
    for (let index = 0; index < 5; index++) {
      rooms.push(await publishedRoom(owner.cookie));
    }
    const ids = rooms.map((room) => room.roomId);
    await prisma.room.updateMany({
      where: { id: { in: ids } },
      data: { rankingScore: 37 },
    });

    const items = await listAll(2);
    const allIds = items.map((item) => item.id);

    expect(new Set(allIds).size).toBe(allIds.length);
    const positions = positionsOf(items, ids);
    expect(positions.every((position) => position >= 0)).toBe(true);
    const ordered = [...ids].sort();
    expect(
      [...ids].sort((a, b) => allIds.indexOf(a) - allIds.indexOf(b)),
    ).toEqual(ordered);

    const first = await http().get('/rooms?limit=2').expect(200);
    expect(first.body).toHaveProperty('total');
    const second = await http()
      .get(`/rooms?limit=2&cursor=${(first.body as RoomPage).nextCursor}`)
      .expect(200);
    expect(second.body).not.toHaveProperty('total');
    await http().get('/rooms?cursor=invalido').expect(400);
    await http().get('/rooms?limit=100').expect(400);
  });

  it('expõe na listagem só os dados usados pelo card', async () => {
    const owner = await account();
    const { roomId, propertyId } = await publishedRoom(owner.cookie);

    const item = (await listAll(48)).find(
      (candidate) => candidate.id === roomId,
    ) as unknown as Body;

    expect(Object.keys(item).sort()).toEqual(
      ['coverUrl', 'featured', 'id', 'priceCents', 'property', 'title'].sort(),
    );
    expect(item.property).toEqual({
      id: propertyId,
      title: propertyTitle,
      type: 'HOUSE',
      neighborhood: publishableAddress.neighborhood,
      city: publishableAddress.city,
      state: publishableAddress.state,
    });
    expect(item.coverUrl).toMatch(
      /^https:\/\/media\.test\/assets\/images\/properties\//,
    );
  });

  it('impede que usuários sem perfil administrativo alterem destaque ou ranking', async () => {
    const owner = await account();
    const adminCookie = await admin();
    const { propertyId, roomId } = await publishedRoom(owner.cookie);
    const before = await storedRanking(roomId);

    await http()
      .put(`/admin/rooms/${roomId}/featured`)
      .send({
        featuredFrom: new Date().toISOString(),
        featuredUntil: new Date(Date.now() + day).toISOString(),
      })
      .expect(401);
    await feature(owner.cookie, roomId, 0, day).expect(403);
    await http()
      .delete(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', owner.cookie)
      .expect(403);
    await http()
      .patch(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .send({ rankingScore: 1000 })
      .expect(400);
    await http()
      .patch(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .send({ completenessScore: 100, featuredUntil: '2099-01-01' })
      .expect(400);
    await http()
      .patch(`/owner/properties/${propertyId}`)
      .set('Cookie', owner.cookie)
      .send({ featured: true })
      .expect(400);

    const after = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
    });
    expect(after).toMatchObject({
      rankingScore: before.rankingScore,
      completenessScore: before.completenessScore,
      featuredFrom: null,
      featuredUntil: null,
    });

    await feature(adminCookie, roomId, day, 0).expect(422);
    await feature(adminCookie, randomUUID(), 0, day).expect(404);
    const featured = await feature(adminCookie, roomId, -day, day).expect(200);
    expect(featured.body).toMatchObject({
      id: roomId,
      featuringStatus: 'ACTIVE',
    });
    const removed = await http()
      .delete(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', adminCookie)
      .expect(200);
    const ended = removed.body as Body & { featuredUntil: string };
    expect(ended).toMatchObject({ featuringStatus: 'ENDED' });
    expect(ended.featuredFrom).not.toBeNull();
    expect(new Date(ended.featuredUntil).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    await feature(adminCookie, roomId, day, 2 * day).expect(200);
    const cancelled = await http()
      .delete(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(cancelled.body).toMatchObject({
      featuredFrom: null,
      featuredUntil: null,
      featuringStatus: 'NONE',
    });
    await http()
      .delete(`/admin/rooms/${randomUUID()}/featured`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('lista quartos para a administração com busca, situação do destaque e visibilidade', async () => {
    const owner = await account();
    const adminCookie = await admin();
    const token = randomUUID().slice(0, 8);
    const active = await publishedRoom(owner.cookie, {
      title: `Suíte ${token} A`,
    });
    const scheduled = await publishedRoom(owner.cookie, {
      title: `Suíte ${token} B`,
    });
    const paused = await publishedRoom(owner.cookie, {
      title: `Suíte ${token} C`,
    });
    await publishedRoom(owner.cookie, { title: `Suíte ${token} D` });
    await feature(adminCookie, active.roomId, -day, day).expect(200);
    await feature(adminCookie, scheduled.roomId, day, 2 * day).expect(200);
    await feature(adminCookie, paused.roomId, -day, day).expect(200);
    await http()
      .patch(`/owner/rooms/${paused.roomId}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);

    await http().get('/admin/rooms').expect(401);
    await http().get('/admin/rooms').set('Cookie', owner.cookie).expect(403);
    await http()
      .get('/admin/rooms?featuring=INVALID')
      .set('Cookie', adminCookie)
      .expect(400);

    type AdminRoom = {
      id: string;
      title: string;
      listed: boolean;
      featuringStatus: string;
    };
    const search = async (query: string) => {
      const response = await http()
        .get(`/admin/rooms?q=${token}${query}`)
        .set('Cookie', adminCookie)
        .expect(200);
      return response.body as { items: AdminRoom[]; total: number };
    };

    const all = await search('');
    expect(all.total).toBe(4);
    expect(all.items.map((room) => room.title)).toEqual([
      `Suíte ${token} A`,
      `Suíte ${token} B`,
      `Suíte ${token} C`,
      `Suíte ${token} D`,
    ]);
    expect(
      all.items.map((room) => [room.featuringStatus, room.listed]),
    ).toEqual([
      ['ACTIVE', true],
      ['SCHEDULED', true],
      ['ACTIVE', false],
      ['NONE', true],
    ]);

    const activeOnly = await search('&featuring=ACTIVE');
    expect(activeOnly.items.map((room) => room.id)).toEqual([
      active.roomId,
      paused.roomId,
    ]);
    const scheduledOnly = await search('&featuring=SCHEDULED');
    expect(scheduledOnly.items.map((room) => room.id)).toEqual([
      scheduled.roomId,
    ]);
    const paged = await search('&limit=2&page=2');
    expect(paged.items.map((room) => room.title)).toEqual([
      `Suíte ${token} C`,
      `Suíte ${token} D`,
    ]);
  });

  afterAll(async () => {
    await accounts?.removeAll();
    await app?.close();
  });
});
