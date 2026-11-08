import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  availabilityWindowEnd,
  todayInSaoPaulo,
  weekdayOf,
} from '../src/availability/availability-rules';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { TestAccounts, createE2eApp, publishProperty } from './support/e2e';

const addDays = (date: string, days: number): string => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};

describe('Disponibilidade do quarto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accounts: TestAccounts;
  const today = todayInSaoPaulo();
  const windowEnd = availabilityWindowEnd(today);

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    accounts = new TestAccounts(app, 'availability');
  });

  const http = () => request(app.getHttpServer());

  async function owner() {
    return (await accounts.create(['OWNER'], 'Dona de teste')).cookie;
  }

  const url = (roomId: string) => `/owner/rooms/${roomId}/availability`;

  it('dono salva e lê dias bloqueados', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);
    let sunday = addDays(today, 1);
    while (weekdayOf(sunday) !== 0) {
      sunday = addDays(sunday, 1);
    }
    const monday = addDays(sunday, 1);

    const saved = await http()
      .put(url(roomId))
      .set('Cookie', cookie)
      .send({ blockedWeekdays: [0], blockedDates: [monday, sunday] })
      .expect(200);

    const expected = {
      today,
      windowEnd,
      blockedWeekdays: [0],
      blockedDates: [monday],
    };
    expect(saved.body).toEqual(expected);
    const read = await http()
      .get(url(roomId))
      .set('Cookie', cookie)
      .expect(200);
    expect(read.body).toEqual(expected);
  });

  it('recusa datas inválidas', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);
    const put = (body: object) =>
      http().put(url(roomId)).set('Cookie', cookie).send(body).expect(400);

    await put({ blockedWeekdays: [], blockedDates: [addDays(today, -1)] });
    await put({ blockedWeekdays: [], blockedDates: [addDays(windowEnd, 1)] });
    await put({ blockedWeekdays: [], blockedDates: ['2026-02-30'] });
    await put({ blockedWeekdays: [7], blockedDates: [] });
    await put({
      blockedWeekdays: [],
      blockedDates: Array.from({ length: 367 }, (_, index) =>
        addDays('2020-01-01', index),
      ),
    });
  });

  it('PUT preserva datas passadas já gravadas', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);
    const yesterday = new Date(`${addDays(today, -1)}T00:00:00Z`);
    await prisma.roomBlockedDate.create({
      data: { roomId, date: yesterday },
    });

    await http()
      .put(url(roomId))
      .set('Cookie', cookie)
      .send({ blockedWeekdays: [], blockedDates: [] })
      .expect(200);

    const remaining = await prisma.roomBlockedDate.findMany({
      where: { roomId },
    });
    expect(remaining.map((row) => row.date)).toEqual([yesterday]);
  });

  it('outro dono não acessa', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);
    const other = await owner();

    await http().get(url(roomId)).set('Cookie', other).expect(404);
    await http()
      .put(url(roomId))
      .set('Cookie', other)
      .send({ blockedWeekdays: [], blockedDates: [] })
      .expect(404);
  });

  it('exige sessão', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);

    await http().get(url(roomId)).expect(401);
    await http()
      .put(url(roomId))
      .send({ blockedWeekdays: [], blockedDates: [] })
      .expect(401);
  });

  it('público respeita elegibilidade', async () => {
    const cookie = await owner();
    const { roomId } = await publishProperty(app, cookie);
    const blockedDate = addDays(today, 3);
    await http()
      .put(url(roomId))
      .set('Cookie', cookie)
      .send({ blockedWeekdays: [], blockedDates: [blockedDate] })
      .expect(200);

    const response = await http()
      .get(`/rooms/${roomId}/availability`)
      .expect(200);
    expect(response.body).toEqual({
      today,
      windowEnd,
      blockedWeekdays: [],
      blockedDates: [blockedDate],
    });
    await http().get('/rooms/featured').expect(200);

    await http()
      .patch(`/owner/rooms/${roomId}`)
      .set('Cookie', cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);
    await http().get(`/rooms/${roomId}/availability`).expect(404);
  });

  afterAll(async () => {
    await accounts?.removeAll();
    await app?.close();
  });
});
