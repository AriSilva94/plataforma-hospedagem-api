import { BadRequestException } from '@nestjs/common';

export interface RoomListingCursor {
  asOf: Date;
  featured: boolean;
  rankingScore: number;
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CLOCK_SKEW_MS = 60_000;

export function encodeRoomListingCursor(cursor: RoomListingCursor): string {
  return Buffer.from(
    JSON.stringify([
      cursor.asOf.getTime(),
      cursor.featured,
      cursor.rankingScore,
      cursor.id,
    ]),
  ).toString('base64url');
}

export function decodeRoomListingCursor(
  encoded: string,
  now: Date,
): RoomListingCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  if (
    !Array.isArray(decoded) ||
    decoded.length !== 4 ||
    !Number.isSafeInteger(decoded[0]) ||
    (decoded[0] as number) <= 0 ||
    (decoded[0] as number) > now.getTime() + MAX_CLOCK_SKEW_MS ||
    typeof decoded[1] !== 'boolean' ||
    !Number.isInteger(decoded[2]) ||
    typeof decoded[3] !== 'string' ||
    !UUID_PATTERN.test(decoded[3])
  ) {
    throw invalidCursor();
  }

  return {
    asOf: new Date(decoded[0] as number),
    featured: decoded[1],
    rankingScore: decoded[2] as number,
    id: decoded[3],
  };
}

function invalidCursor() {
  return new BadRequestException('Cursor de paginação inválido.');
}
