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

type StoryItem = { roomId: string; media: { type: string; url: string }[] };

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

  const stories = async () =>
    (await http().get('/rooms/stories').expect(200)).body as {
      items: StoryItem[];
    };

  const feature = (admin: string, roomId: string) =>
    http()
      .put(`/admin/rooms/${roomId}/featured`)
      .set('Cookie', admin)
      .send({
        featuredFrom: new Date(Date.now() - day).toISOString(),
        featuredUntil: new Date(Date.now() + day).toISOString(),
      })
      .expect(200);

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
