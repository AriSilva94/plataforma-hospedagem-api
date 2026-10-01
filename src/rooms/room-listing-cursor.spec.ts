import { BadRequestException } from '@nestjs/common';
import {
  decodeRoomListingCursor,
  encodeRoomListingCursor,
} from './room-listing-cursor';

const now = new Date('2026-09-30T12:00:00.000Z');
const id = '0b9f4a3e-6a43-4d2c-9a55-3f1d1c2b7e10';
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor da listagem de quartos', () => {
  it('codifica e decodifica a posição e o instante de referência', () => {
    const cursor = {
      asOf: new Date('2026-09-30T11:59:00.000Z'),
      featured: true,
      rankingScore: 82,
      id,
    };

    expect(
      decodeRoomListingCursor(encodeRoomListingCursor(cursor), now),
    ).toEqual(cursor);
  });

  it.each([
    'não-é-base64',
    encode({ a: 1 }),
    encode([true, 82, id]),
    encode([now.getTime(), true, 1.5, id]),
    encode([now.getTime(), false, 10, '1; DROP TABLE rooms']),
    encode(['2026-09-30', false, 10, id]),
    encode([now.getTime() + 24 * 60 * 60 * 1000, false, 10, id]),
  ])('recusa cursor inválido %s', (encoded) => {
    expect(() => decodeRoomListingCursor(encoded, now)).toThrow(
      BadRequestException,
    );
  });
});
