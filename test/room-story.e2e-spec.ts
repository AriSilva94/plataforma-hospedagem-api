import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  TestAccounts,
  createE2eApp,
  png,
  publishProperty,
} from './support/e2e';

type StoryItem = {
  roomId: string;
  viewed: boolean;
  media: { type: string; url: string }[];
};

const day = 24 * 60 * 60 * 1000;
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(8),
]);

describe('Story de destaque do quarto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accounts: TestAccounts;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    accounts = new TestAccounts(app, 'story');
  });

  afterAll(async () => {
    await accounts.removeAll();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const upload = (cookie: string, roomId: string, file: Buffer, name: string) =>
    http()
      .post(`/owner/rooms/${roomId}/story/media`)
      .set('Cookie', cookie)
      .attach('file', file, name);

  const stories = async (cookie?: string) =>
    (
      await http()
        .get('/rooms/stories')
        .set('Cookie', cookie ?? '')
        .expect(200)
    ).body as { items: StoryItem[] };

  const feature = (admin: string, roomId: string) =>
    http()
      .put(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', admin)
      .send({
        featuredFrom: new Date(Date.now() - day).toISOString(),
        featuredUntil: new Date(Date.now() + day).toISOString(),
      })
      .expect(200);

  async function publicStory() {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);
    await upload(owner.cookie, roomId, png, 'a.png').expect(201);
    await feature(admin, roomId);
    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);
    const { storyApprovedAt } = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { storyApprovedAt: true },
    });
    return {
      owner,
      admin,
      roomId,
      storyApprovedAt: storyApprovedAt as Date,
    };
  }

  it('marca como visto só para o usuário que abriu o story', async () => {
    const { roomId, storyApprovedAt } = await publicStory();
    const guestA = await accounts.create(['GUEST']);
    const guestB = await accounts.create(['GUEST']);
    await prisma.roomStoryView.create({
      data: { roomId, userId: guestA.id, storyApprovedAt },
    });
    const viewedBy = async (cookie?: string) =>
      (await stories(cookie)).items.find((item) => item.roomId === roomId)
        ?.viewed;

    expect(await viewedBy(guestA.cookie)).toBe(true);
    expect(await viewedBy(guestB.cookie)).toBe(false);
    expect(await viewedBy()).toBe(false);
    expect(await viewedBy('access_token=token-invalido')).toBe(false);
  });

  describe('registro de visualização', () => {
    const view = (roomId: string, cookie?: string) =>
      http()
        .post(`/rooms/${roomId}/story/views`)
        .set('Cookie', cookie ?? '');
    const rows = (roomId: string) =>
      prisma.roomStoryView.findMany({ where: { roomId } });

    it('cria a linha na primeira abertura e incrementa nas seguintes', async () => {
      const { roomId } = await publicStory();
      const guest = await accounts.create(['GUEST']);

      await view(roomId, guest.cookie).expect(204);
      expect((await rows(roomId)).map((row) => row.viewCount)).toEqual([1]);

      await view(roomId, guest.cookie).expect(204);
      expect((await rows(roomId)).map((row) => row.viewCount)).toEqual([2]);

      const listed = (await stories(guest.cookie)).items.find(
        (item) => item.roomId === roomId,
      );
      expect(listed?.viewed).toBe(true);
    });

    it('mantém uma única linha em aberturas simultâneas do mesmo usuário', async () => {
      const { roomId } = await publicStory();
      const guest = await accounts.create(['GUEST']);

      await Promise.all([
        view(roomId, guest.cookie).expect(204),
        view(roomId, guest.cookie).expect(204),
      ]);

      expect((await rows(roomId)).map((row) => row.viewCount)).toEqual([2]);
    });

    it('exige login', async () => {
      const { roomId } = await publicStory();

      await view(roomId).expect(401);
    });

    it('responde 404 quando o story não está público', async () => {
      const guest = await accounts.create(['GUEST']);
      const pending = await publicStory();
      await prisma.room.update({
        where: { id: pending.roomId },
        data: { storyStatus: 'PENDING', storyApprovedAt: null },
      });
      const expired = await publicStory();
      await prisma.room.update({
        where: { id: expired.roomId },
        data: { storyApprovedAt: new Date(Date.now() - day - 1000) },
      });
      const unfeatured = await publicStory();
      await prisma.room.update({
        where: { id: unfeatured.roomId },
        data: { featuredFrom: null, featuredUntil: null },
      });

      await view(pending.roomId, guest.cookie).expect(404);
      await view(expired.roomId, guest.cookie).expect(404);
      await view(unfeatured.roomId, guest.cookie).expect(404);
      await view('not-a-uuid', guest.cookie).expect(400);
    });

    it('abre novo ciclo quando o story é reaprovado', async () => {
      const { roomId, admin } = await publicStory();
      const guest = await accounts.create(['GUEST']);
      await view(roomId, guest.cookie).expect(204);

      await prisma.room.update({
        where: { id: roomId },
        data: { storyApprovedAt: new Date(Date.now() - 60_000) },
      });
      await http()
        .put(`/admin/rooms/${roomId}/story/approved`)
        .set('Cookie', admin)
        .expect(200);

      const listed = (await stories(guest.cookie)).items.find(
        (item) => item.roomId === roomId,
      );
      expect(listed?.viewed).toBe(false);

      await view(roomId, guest.cookie).expect(204);
      expect(await rows(roomId)).toHaveLength(2);
    });
  });

  it('limita a 3 mídias e aceita imagem e vídeo', async () => {
    const owner = await accounts.create();
    const { roomId } = await publishProperty(app, owner.cookie);

    await upload(owner.cookie, roomId, Buffer.from('texto'), 'e.png').expect(
      400,
    );
    await upload(owner.cookie, roomId, png, 'a.png').expect(201);
    await upload(owner.cookie, roomId, mp4, 'b.mp4').expect(201);
    await upload(owner.cookie, roomId, png, 'c.png').expect(201);
    await upload(owner.cookie, roomId, png, 'd.png').expect(422);

    const detail = await http()
      .get(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(
      (detail.body as { storyMedia: { type: string }[] }).storyMedia.map(
        (media) => media.type,
      ),
    ).toEqual(['IMAGE', 'VIDEO', 'IMAGE']);
  });

  it('só o dono envia mídia ao story do próprio quarto', async () => {
    const owner = await accounts.create();
    const stranger = await accounts.create();
    const { roomId } = await publishProperty(app, owner.cookie);

    await upload(stranger.cookie, roomId, png, 'a.png').expect(404);
    await http().post(`/owner/rooms/${roomId}/story/media`).expect(401);
  });

  it('exibe na home somente story aprovado de quarto com destaque ativo', async () => {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);
    const media = await upload(owner.cookie, roomId, png, 'a.png').expect(201);

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', owner.cookie)
      .expect(403);

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);
    expect((await stories()).items.map((item) => item.roomId)).not.toContain(
      roomId,
    );

    await feature(admin, roomId);
    const listed = (await stories()).items.find(
      (item) => item.roomId === roomId,
    );
    expect(listed?.media).toHaveLength(1);

    await http()
      .put(`/admin/rooms/${roomId}/story/rejected`)
      .set('Cookie', admin)
      .send({ reason: 'Imagem fora do padrão.' })
      .expect(200);
    expect((await stories()).items.map((item) => item.roomId)).not.toContain(
      roomId,
    );

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);
    await http()
      .delete(
        `/owner/rooms/${roomId}/story/media/${(media.body as { id: string }).id}`,
      )
      .set('Cookie', owner.cookie)
      .expect(204);
    expect((await stories()).items.map((item) => item.roomId)).not.toContain(
      roomId,
    );
  });

  it('volta para análise quando o dono altera o story', async () => {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);
    await upload(owner.cookie, roomId, png, 'a.png').expect(201);
    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);

    await upload(owner.cookie, roomId, png, 'b.png').expect(201);

    const room = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { storyStatus: true },
    });
    expect(room.storyStatus).toBe('PENDING');
  });

  it('remove da home o story aprovado há 24 horas e volta ao reaprovar', async () => {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);
    await upload(owner.cookie, roomId, png, 'a.png').expect(201);
    await feature(admin, roomId);
    const approve = () =>
      http()
        .put(`/admin/rooms/${roomId}/story/approved`)
        .set('Cookie', admin)
        .expect(200);
    const listedIds = async () =>
      (await stories()).items.map((item) => item.roomId);

    await approve();
    expect(await listedIds()).toContain(roomId);

    const approvedAt = (
      await prisma.room.findUniqueOrThrow({
        where: { id: roomId },
        select: { storyApprovedAt: true },
      })
    ).storyApprovedAt as Date;
    expect(approvedAt).toBeInstanceOf(Date);

    await prisma.room.update({
      where: { id: roomId },
      data: { storyApprovedAt: new Date(Date.now() - day + 60_000) },
    });
    expect(await listedIds()).toContain(roomId);

    await prisma.room.update({
      where: { id: roomId },
      data: { storyApprovedAt: new Date(Date.now() - day - 1000) },
    });
    expect(await listedIds()).not.toContain(roomId);

    const detail = await http()
      .get(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const body = detail.body as {
      storyStatus: string;
      storyExpiresAt: string;
    };
    expect(body.storyStatus).toBe('APPROVED');
    expect(new Date(body.storyExpiresAt).getTime()).toBeLessThan(Date.now());

    await approve();
    expect(await listedIds()).toContain(roomId);
  });

  it('limpa a aprovação ao voltar para análise ou recusar', async () => {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);
    await upload(owner.cookie, roomId, png, 'a.png').expect(201);
    const approvedAt = () =>
      prisma.room
        .findUniqueOrThrow({
          where: { id: roomId },
          select: { storyApprovedAt: true },
        })
        .then((room) => room.storyApprovedAt);

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);
    expect(await approvedAt()).not.toBeNull();

    await upload(owner.cookie, roomId, png, 'b.png').expect(201);
    expect(await approvedAt()).toBeNull();

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(200);
    await http()
      .put(`/admin/rooms/${roomId}/story/rejected`)
      .set('Cookie', admin)
      .send({ reason: 'Imagem fora do padrão.' })
      .expect(200);
    expect(await approvedAt()).toBeNull();
  });

  it('não analisa quarto sem story', async () => {
    const owner = await accounts.create();
    const admin = await accounts.createAdmin();
    const { roomId } = await publishProperty(app, owner.cookie);

    await http()
      .put(`/admin/rooms/${roomId}/story/approved`)
      .set('Cookie', admin)
      .expect(404);
  });
});
