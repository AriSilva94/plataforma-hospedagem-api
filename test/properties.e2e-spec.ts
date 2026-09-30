import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { finished } from 'stream/promises';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { UsersService } from '../src/users/users.service';
import { MediaObject, MediaStorage } from '../src/media/media-storage';

class InMemoryMediaStorage extends MediaStorage {
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

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(8),
]);

const completeAddress = {
  description: 'Casa ampla perto do centro.',
  postalCode: '01310-100',
  street: 'Avenida Paulista',
  number: '1000',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'sp',
};

const roomInput = {
  title: 'Suíte 1',
  priceCents: 15000,
  capacity: 2,
  bathroomType: 'PRIVATE',
  acceptedAudiences: ['WOMAN', 'TRANS_WOMAN'],
  amenities: ['AIR_CONDITIONING', 'DESK'],
};

type Body = Record<string, unknown>;

describe('Imóveis e quartos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const storage = new InMemoryMediaStorage();
  const userIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MediaStorage)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  async function account(roles: ('GUEST' | 'OWNER')[] = ['OWNER']) {
    const result = await app.get(AuthService).register({
      name: 'Proprietário de teste',
      email: `owner-${randomUUID()}@example.com`,
      password: 'senha-segura-de-teste',
    });
    userIds.push(result.user.id);
    for (const role of roles) {
      await app.get(UsersService).addProfile(result.user.id, role);
    }
    return `access_token=${result.accessToken}`;
  }

  const http = () => request(app.getHttpServer());

  async function createProperty(cookie: string, input: Body = {}) {
    const response = await http()
      .post('/owner/properties')
      .set('Cookie', cookie)
      .send({ title: 'Casa Central', type: 'HOUSE', ...input })
      .expect(201);
    return response.body as Body & { id: string };
  }

  async function createRoom(cookie: string, propertyId: string) {
    const response = await http()
      .post(`/owner/properties/${propertyId}/rooms`)
      .set('Cookie', cookie)
      .send(roomInput)
      .expect(201);
    return response.body as Body & { id: string };
  }

  function upload(cookie: string, path: string, content: Buffer, name: string) {
    return http()
      .post(path)
      .set('Cookie', cookie)
      .attach('file', content, name);
  }

  it('exige autenticação e perfil de proprietário', async () => {
    await http().get('/owner/properties').expect(401);
    const guest = await account(['GUEST']);

    await http()
      .post('/owner/properties')
      .set('Cookie', guest)
      .send({ title: 'Casa', type: 'HOUSE' })
      .expect(403);
    await http()
      .get('/owner/properties')
      .set('Cookie', guest)
      .expect(200)
      .expect([]);
  });

  it('cria rascunho sem expor o vínculo interno do proprietário', async () => {
    const owner = await account();
    const property = await createProperty(owner, {
      postalCode: '01310-100',
      state: 'rj',
      referencePoints: ['  Próximo ao metrô  '],
    });

    expect(property).toMatchObject({
      status: 'DRAFT',
      postalCode: '01310100',
      state: 'RJ',
      referencePoints: ['Próximo ao metrô'],
      rooms: [],
      media: [],
    });
    expect(property).not.toHaveProperty('ownerProfileId');
  });

  it('impede que um proprietário acesse ou altere recursos de outro', async () => {
    const ownerA = await account();
    const ownerB = await account();
    const property = await createProperty(ownerA);
    const room = await createRoom(ownerA, property.id);
    const image = await upload(
      ownerA,
      `/owner/properties/${property.id}/media`,
      png,
      'foto.png',
    ).expect(201);
    const mediaId = (image.body as { id: string }).id;
    const objectsBefore = storage.objects.size;

    const propertyPath = `/owner/properties/${property.id}`;
    await http().get(propertyPath).set('Cookie', ownerB).expect(404);
    await http()
      .patch(propertyPath)
      .set('Cookie', ownerB)
      .send({ title: 'Invadido' })
      .expect(404);
    await http()
      .patch(`${propertyPath}/status`)
      .set('Cookie', ownerB)
      .send({ status: 'ACTIVE' })
      .expect(404);
    await http().delete(propertyPath).set('Cookie', ownerB).expect(404);
    await http()
      .put(`${propertyPath}/shared-areas`)
      .set('Cookie', ownerB)
      .send({ areas: [] })
      .expect(404);
    await http()
      .post(`${propertyPath}/rooms`)
      .set('Cookie', ownerB)
      .send(roomInput)
      .expect(404);
    await upload(ownerB, `${propertyPath}/media`, png, 'x.png').expect(404);
    await http()
      .delete(`${propertyPath}/media/${mediaId}`)
      .set('Cookie', ownerB)
      .expect(404);
    await http()
      .put(`${propertyPath}/media/order`)
      .set('Cookie', ownerB)
      .send({ mediaIds: [mediaId] })
      .expect(404);

    const roomPath = `/owner/rooms/${room.id}`;
    await http().get(roomPath).set('Cookie', ownerB).expect(404);
    await http()
      .patch(roomPath)
      .set('Cookie', ownerB)
      .send({ priceCents: 1 })
      .expect(404);
    await http().delete(roomPath).set('Cookie', ownerB).expect(404);
    await upload(ownerB, `${roomPath}/media`, png, 'x.png').expect(404);

    await http()
      .get('/owner/properties')
      .set('Cookie', ownerB)
      .expect(200)
      .expect([]);
    expect(storage.objects.size).toBe(objectsBefore);
    const unchanged = await prisma.room.findUniqueOrThrow({
      where: { id: room.id },
    });
    expect(unchanged.priceCents).toBe(roomInput.priceCents);
  });

  it('só ativa o imóvel completo e mantém os requisitos depois de publicado', async () => {
    const owner = await account();
    const property = await createProperty(owner);
    const path = `/owner/properties/${property.id}`;

    const incomplete = await http()
      .patch(`${path}/status`)
      .set('Cookie', owner)
      .send({ status: 'ACTIVE' })
      .expect(422);
    expect((incomplete.body as { message: string }).message).toContain(
      'ao menos uma foto',
    );

    await http()
      .patch(path)
      .set('Cookie', owner)
      .send(completeAddress)
      .expect(200);
    const image = await upload(owner, `${path}/media`, png, 'capa.png').expect(
      201,
    );
    const room = await createRoom(owner, property.id);

    await http()
      .patch(`${path}/status`)
      .set('Cookie', owner)
      .send({ status: 'ACTIVE' })
      .expect(200)
      .expect(({ body }: { body: Body }) => expect(body.status).toBe('ACTIVE'));

    await http()
      .delete(`${path}/media/${(image.body as { id: string }).id}`)
      .set('Cookie', owner)
      .expect(422);
    await http()
      .patch(`/owner/rooms/${room.id}`)
      .set('Cookie', owner)
      .send({ status: 'INACTIVE' })
      .expect(422);
    await http()
      .patch(path)
      .set('Cookie', owner)
      .send({ street: '' })
      .expect(422);
    await http().delete(path).set('Cookie', owner).expect(422);

    await http()
      .patch(`${path}/status`)
      .set('Cookie', owner)
      .send({ status: 'DRAFT' })
      .expect(422);
    await http()
      .patch(`${path}/status`)
      .set('Cookie', owner)
      .send({ status: 'UNAVAILABLE' })
      .expect(200)
      .expect(({ body }: { body: Body }) =>
        expect(body.status).toBe('UNAVAILABLE'),
      );
  });

  it('valida arquivos pelo conteúdo, tipo permitido e ordem da galeria', async () => {
    const owner = await account();
    const property = await createProperty(owner);
    const room = await createRoom(owner, property.id);
    const path = `/owner/properties/${property.id}/media`;

    await upload(owner, path, Buffer.from('não é imagem'), 'foto.png').expect(
      400,
    );
    await http().post(path).set('Cookie', owner).expect(400);
    await upload(owner, `/owner/rooms/${room.id}/media`, mp4, 'v.mp4').expect(
      400,
    );

    const video = await upload(owner, path, mp4, 'tour.mp4').expect(201);
    const image = await upload(owner, path, png, 'foto.png').expect(201);
    expect(video.body).toMatchObject({ type: 'VIDEO', mimeType: 'video/mp4' });
    const videoId = (video.body as { id: string }).id;
    const imageId = (image.body as { id: string }).id;

    await http()
      .put(`${path}/order`)
      .set('Cookie', owner)
      .send({ mediaIds: [imageId] })
      .expect(400);
    const reordered = await http()
      .put(`${path}/order`)
      .set('Cookie', owner)
      .send({ mediaIds: [imageId, videoId] })
      .expect(200);
    const media = (reordered.body as { media: { id: string }[] }).media;
    expect(media.map((item) => item.id)).toEqual([imageId, videoId]);

    const list = await http()
      .get('/owner/properties')
      .set('Cookie', owner)
      .expect(200);
    expect((list.body as Body[])[0]).toMatchObject({
      id: property.id,
      roomCount: 1,
      coverUrl: expect.stringContaining(
        `assets/images/properties/${property.id}/`,
      ) as string,
    });
  });

  it('valida áreas compartilhadas e dados do quarto no backend', async () => {
    const owner = await account();
    const property = await createProperty(owner);
    const path = `/owner/properties/${property.id}`;

    await http()
      .put(`${path}/shared-areas`)
      .set('Cookie', owner)
      .send({ areas: [{ type: 'OTHER' }] })
      .expect(400);
    const areas = await http()
      .put(`${path}/shared-areas`)
      .set('Cookie', owner)
      .send({
        areas: [
          { type: 'KITCHEN', description: 'Equipada' },
          { type: 'OTHER', label: 'Terraço' },
        ],
      })
      .expect(200);
    expect((areas.body as { sharedAreas: Body[] }).sharedAreas).toMatchObject([
      { type: 'KITCHEN', position: 0 },
      { type: 'OTHER', label: 'Terraço', position: 1 },
    ]);

    const rooms = `${path}/rooms`;
    for (const invalid of [
      { priceCents: 150.5 },
      { priceCents: 0 },
      { acceptedAudiences: [] },
      { acceptedAudiences: ['ALIEN'] },
      { amenities: ['JACUZZI'] },
      { capacity: 99 },
    ]) {
      await http()
        .post(rooms)
        .set('Cookie', owner)
        .send({ ...roomInput, ...invalid })
        .expect(400);
    }

    const room = await createRoom(owner, property.id);
    await http()
      .patch(`/owner/rooms/${room.id}`)
      .set('Cookie', owner)
      .send({ title: null })
      .expect(400);
    await http()
      .patch(`/owner/rooms/${room.id}`)
      .set('Cookie', owner)
      .send({ priceCents: 18990, status: 'UNAVAILABLE' })
      .expect(200)
      .expect(({ body }: { body: Body }) =>
        expect(body).toMatchObject({
          priceCents: 18990,
          status: 'UNAVAILABLE',
          property: { id: property.id },
        }),
      );
  });

  it('exclui rascunho com quartos e remove as mídias do storage', async () => {
    const owner = await account();
    const property = await createProperty(owner);
    const room = await createRoom(owner, property.id);
    const propertyImage = await upload(
      owner,
      `/owner/properties/${property.id}/media`,
      png,
      'a.png',
    ).expect(201);
    const roomImage = await upload(
      owner,
      `/owner/rooms/${room.id}/media`,
      png,
      'b.png',
    ).expect(201);
    const keys = [propertyImage, roomImage].map((response) =>
      (response.body as { url: string }).url.replace('https://media.test/', ''),
    );
    expect(keys.every((key) => storage.objects.has(key))).toBe(true);

    await http()
      .delete(`/owner/properties/${property.id}`)
      .set('Cookie', owner)
      .expect(204);

    expect(keys.some((key) => storage.objects.has(key))).toBe(false);
    await expect(
      prisma.room.findUnique({ where: { id: room.id } }),
    ).resolves.toBeNull();
  });

  it('lista publicamente só imóveis ativos com quarto disponível, sem dados privados', async () => {
    const owner = await account();

    async function publish(featured: boolean) {
      const property = await createProperty(owner, {
        ...completeAddress,
        complement: 'Apto 12',
        featured,
      });
      await upload(
        owner,
        `/owner/properties/${property.id}/media`,
        png,
        'capa.png',
      ).expect(201);
      const room = await createRoom(owner, property.id);
      await http()
        .patch(`/owner/properties/${property.id}/status`)
        .set('Cookie', owner)
        .send({ status: 'ACTIVE' })
        .expect(200);
      return { property, room };
    }

    const featured = await publish(true);
    const regular = await publish(false);
    const withoutAvailableRoom = await publish(false);
    await http()
      .patch(`/owner/rooms/${withoutAvailableRoom.room.id}`)
      .set('Cookie', owner)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);
    const draft = await createProperty(owner, { featured: true });

    const listIds = async (query: string) => {
      const response = await http()
        .get(`/properties?limit=48${query}`)
        .expect(200);
      return (response.body as { items: { id: string }[] }).items.map(
        (item) => item.id,
      );
    };

    const all = await listIds('');
    expect(all).toEqual(
      expect.arrayContaining([featured.property.id, regular.property.id]),
    );
    expect(all).not.toContain(withoutAvailableRoom.property.id);
    expect(all).not.toContain(draft.id);

    const featuredIds = await listIds('&featured=true');
    expect(featuredIds).toContain(featured.property.id);
    expect(featuredIds).not.toContain(regular.property.id);
    expect(featuredIds).not.toContain(draft.id);

    const list = await http().get('/properties?limit=48').expect(200);
    const item = (list.body as { items: Body[] }).items.find(
      (candidate) => candidate.id === featured.property.id,
    );
    expect(item).toMatchObject({
      startingPriceCents: roomInput.priceCents,
      neighborhood: 'Bela Vista',
      featured: true,
    });

    const detail = await http()
      .get(`/properties/${featured.property.id}`)
      .expect(200);
    const body = detail.body as Body & { rooms: Body[] };
    for (const key of [
      'postalCode',
      'street',
      'number',
      'complement',
      'ownerProfileId',
      'ownerProfile',
      'status',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toMatchObject({ city: 'São Paulo', state: 'SP' });
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]).toMatchObject({
      acceptedAudiences: roomInput.acceptedAudiences,
    });

    await http().get(`/properties/${draft.id}`).expect(404);
    await http()
      .get(`/properties/${withoutAvailableRoom.property.id}`)
      .expect(404);
    await http().get('/properties?limit=100').expect(400);
  });

  it('permite ao hóspede informar o público no próprio perfil', async () => {
    const owner = await account(['OWNER']);
    await http()
      .patch('/users/me/profiles/guest')
      .set('Cookie', owner)
      .send({ genderIdentity: 'WOMAN' })
      .expect(404);

    const guest = await account(['GUEST']);
    await http()
      .patch('/users/me/profiles/guest')
      .set('Cookie', guest)
      .send({ genderIdentity: 'OTHER' })
      .expect(400);
    await http()
      .patch('/users/me/profiles/guest')
      .set('Cookie', guest)
      .send({ genderIdentity: 'TRANS_MAN' })
      .expect(200)
      .expect(({ body }: { body: Body }) =>
        expect(body.guestProfile).toMatchObject({
          genderIdentity: 'TRANS_MAN',
        }),
      );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.property.deleteMany({
        where: { ownerProfile: { userId: { in: userIds } } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });
});
