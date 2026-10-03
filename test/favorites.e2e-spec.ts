import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  TestAccounts,
  createE2eApp,
  publishProperty,
  roomInput,
} from './support/e2e';

type FavoriteItem = {
  roomId: string;
  available: boolean;
  property: Record<string, unknown>;
};

describe('Favoritos (e2e)', () => {
  let app: INestApplication<App>;
  let accounts: TestAccounts;

  beforeAll(async () => {
    ({ app } = await createE2eApp());
    accounts = new TestAccounts(app, 'favorites');
  });

  const http = () => request(app.getHttpServer());

  async function list(cookie: string): Promise<FavoriteItem[]> {
    const response = await http()
      .get('/favorites')
      .set('Cookie', cookie)
      .expect(200);
    return (response.body as { items: FavoriteItem[] }).items;
  }

  it('exige autenticação', async () => {
    await http().get('/favorites').expect(401);
    await http().put(`/favorites/${randomUUID()}`).expect(401);
  });

  it('favorita um quarto publicado, mantém indisponível quando sai da busca e remove', async () => {
    const owner = await accounts.create();
    const guest = await accounts.create(['GUEST']);
    const { roomId } = await publishProperty(app, owner.cookie);

    await http()
      .put(`/favorites/${roomId}`)
      .set('Cookie', guest.cookie)
      .expect(204);
    await http()
      .put(`/favorites/${roomId}`)
      .set('Cookie', guest.cookie)
      .expect(204);

    const ids = await http()
      .get('/favorites/room-ids')
      .set('Cookie', guest.cookie)
      .expect(200);
    expect((ids.body as { roomIds: string[] }).roomIds).toEqual([roomId]);

    const [favorite] = await list(guest.cookie);
    expect(favorite).toMatchObject({
      roomId,
      available: true,
      priceCents: roomInput.priceCents,
    });
    for (const key of [
      'street',
      'number',
      'complement',
      'postalCode',
      'status',
    ]) {
      expect(favorite.property).not.toHaveProperty(key);
    }

    await http()
      .patch(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);
    expect(await list(guest.cookie)).toEqual([
      expect.objectContaining({ roomId, available: false }),
    ]);

    await http()
      .delete(`/favorites/${roomId}`)
      .set('Cookie', guest.cookie)
      .expect(204);
    await http()
      .delete(`/favorites/${roomId}`)
      .set('Cookie', guest.cookie)
      .expect(204);
    expect(await list(guest.cookie)).toEqual([]);
  });

  it('não favorita quarto fora da busca nem id inválido', async () => {
    const owner = await accounts.create();
    const guest = await accounts.create(['GUEST']);
    const { roomId } = await publishProperty(app, owner.cookie);
    await http()
      .patch(`/owner/rooms/${roomId}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'UNAVAILABLE' })
      .expect(200);

    await http()
      .put(`/favorites/${roomId}`)
      .set('Cookie', guest.cookie)
      .expect(404);
    await http()
      .put(`/favorites/${randomUUID()}`)
      .set('Cookie', guest.cookie)
      .expect(404);
    await http()
      .put('/favorites/nao-e-uuid')
      .set('Cookie', guest.cookie)
      .expect(400);
  });

  it('remove o favorito quando o quarto é excluído', async () => {
    const owner = await accounts.create();
    const guest = await accounts.create(['GUEST']);
    const { propertyId } = await publishProperty(app, owner.cookie);
    const extra = await http()
      .post(`/owner/properties/${propertyId}/rooms`)
      .set('Cookie', owner.cookie)
      .send({ ...roomInput, title: 'Quarto extra' })
      .expect(201);
    const extraRoomId = (extra.body as { id: string }).id;

    await http()
      .put(`/favorites/${extraRoomId}`)
      .set('Cookie', guest.cookie)
      .expect(204);
    await http()
      .delete(`/owner/rooms/${extraRoomId}`)
      .set('Cookie', owner.cookie)
      .expect(204);
    expect(await list(guest.cookie)).toEqual([]);
  });

  afterAll(async () => {
    await accounts?.removeAll();
    await app?.close();
  });
});
