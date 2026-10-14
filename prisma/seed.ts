import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  type BathroomType,
  type GenderIdentity,
  type MediaType,
  type PropertyStatus,
  type RoomStatus,
} from '../src/generated/prisma/client';
import { evaluateCompleteness } from '../src/ranking/room-completeness';
import { rankingScoreFor, RANKING_VERSION } from '../src/ranking/room-ranking';
import { ROOM_AMENITIES } from '../src/rooms/room-catalog';
import { PROPERTY_FEATURES } from '../src/properties/property-catalog';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  }),
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});
const R2_BUCKET = process.env.R2_BUCKET as string;

const SEED_EMAIL_DOMAIN = '@seed.local';
const TOTAL_ROOMS_TARGET = 1500;
const FEATURED_RATIO = 0.2;
const ROOM_IMAGE_QUERIES = [
  'bedroom interior furniture',
  'modern bedroom',
  'guest room interior',
];
const PROPERTY_IMAGE_QUERIES = [
  'house exterior facade',
  'residential house front',
  'home exterior architecture',
];
const ROOM_IMAGE_POOL_SIZE = 40;
const PROPERTY_IMAGE_POOL_SIZE = 20;
const IMAGE_UPLOAD_CONCURRENCY = 20;

const STATE_CAPITALS: Record<string, string> = {
  AC: 'Rio Branco',
  AL: 'Maceió',
  AM: 'Manaus',
  AP: 'Macapá',
  BA: 'Salvador',
  CE: 'Fortaleza',
  DF: 'Brasília',
  ES: 'Vitória',
  GO: 'Goiânia',
  MA: 'São Luís',
  MT: 'Cuiabá',
  MS: 'Campo Grande',
  MG: 'Belo Horizonte',
  PA: 'Belém',
  PB: 'João Pessoa',
  PR: 'Curitiba',
  PE: 'Recife',
  PI: 'Teresina',
  RJ: 'Rio de Janeiro',
  RN: 'Natal',
  RS: 'Porto Alegre',
  RO: 'Porto Velho',
  RR: 'Boa Vista',
  SC: 'Florianópolis',
  SP: 'São Paulo',
  SE: 'Aracaju',
  TO: 'Palmas',
};

const STATE_WEIGHTS: Record<string, number> = {
  SP: 6,
  RJ: 4,
  MG: 4,
  ES: 2,
  PR: 3,
  RS: 3,
  SC: 3,
  AC: 1,
  AL: 1,
  AM: 1,
  AP: 1,
  BA: 1,
  CE: 1,
  DF: 1,
  GO: 1,
  MA: 1,
  MT: 1,
  MS: 1,
  PA: 1,
  PB: 1,
  PE: 1,
  PI: 1,
  RN: 1,
  RO: 1,
  RR: 1,
  SE: 1,
  TO: 1,
};

const NEIGHBORHOODS = [
  'Centro',
  'Jardim das Flores',
  'Vila Nova',
  'Bela Vista',
  'Boa Vista',
  'Jardim América',
  'São José',
  'Santa Cruz',
];

const REFERENCE_POINTS_POOL = [
  'Estação de metrô',
  'Shopping Center',
  'Praça Central',
  'Universidade',
  'Hospital',
  'Supermercado',
  'Parque Municipal',
  'Terminal de ônibus',
];

const PROPERTY_TYPE_LABELS = [
  'Casa',
  'Sobrado',
  'República',
  'Casa de Vila',
  'Chácara',
  'Edícula',
];

const PROPERTY_DESCRIPTIONS = [
  'Imóvel bem localizado, próximo a comércio e transporte público.',
  'Casa ampla com áreas comuns confortáveis para convivência.',
  'Residência tranquila, ideal para quem busca praticidade no dia a dia.',
  'Espaço reformado recentemente, com boa iluminação natural.',
];

const HOUSE_RULES_POOL = [
  'Silêncio após 22h.',
  'Proibido fumar nas áreas internas.',
  'Visitas somente com aviso prévio.',
  'Animais de pequeno porte mediante combinação.',
];

const GENERAL_INFO_POOL = [
  'Wi-fi incluso em todos os quartos.',
  'Limpeza semanal das áreas comuns.',
  'Estacionamento disponível mediante consulta.',
  'Prédio com portaria 24h.',
];

const ROOM_TITLE_LABELS = [
  'Suíte',
  'Quarto Individual',
  'Quarto Compartilhado',
  'Quarto com Varanda',
  'Studio',
];

const ROOM_DESCRIPTIONS_POOL = [
  'Quarto amplo com boa ventilação.',
  'Ambiente aconchegante e bem iluminado.',
  'Espaço reformado recentemente.',
  'Quarto silencioso, ideal para trabalho remoto.',
];

const ROOM_ADDITIONAL_INFO_POOL = [
  'Entrada independente.',
  'Inclui roupa de cama e toalhas.',
  'Permite receber visitas em horário combinado.',
  'Próximo a ponto de ônibus.',
];

const GENDER_IDENTITIES: GenderIdentity[] = [
  'MAN',
  'WOMAN',
  'TRANS_WOMAN',
  'TRANS_MAN',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function pickSome<T>(items: readonly T[], min: number, max: number): T[] {
  const count = randomInt(min, Math.min(max, items.length));
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = randomInt(0, pool.length - 1);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function maybe<T>(value: T, probability: number): T | null {
  return Math.random() < probability ? value : null;
}

function weightedPick(weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    if (roll < weight) {
      return key;
    }
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw lastError;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

const WIKIMEDIA_USER_AGENT =
  'plataforma-hospedagem-seed/1.0 (dev local; contato: ariovaldo.bsjunior@gmail.com)';

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1000) {
    throw new Error(`Imagem suspeita (${buffer.length} bytes): ${url}`);
  }
  return buffer;
}

interface WikimediaImageInfo {
  thumburl?: string;
  mime?: string;
}

async function searchWikimediaImageUrls(
  query: string,
  limit: number,
): Promise<string[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${limit}` +
    '&prop=imageinfo&iiprop=url|mime&iiurlwidth=800&format=json';
  const response = await withRetry(
    () =>
      fetch(url, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } }).then(
        (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
          return res.json() as Promise<{
            query?: {
              pages?: Record<string, { imageinfo?: WikimediaImageInfo[] }>;
            };
          }>;
        },
      ),
    4,
  );
  const pages = Object.values(response.query?.pages ?? {});
  return pages
    .map((page) => page.imageinfo?.[0])
    .filter(
      (info): info is WikimediaImageInfo =>
        Boolean(info?.thumburl) &&
        Boolean(info?.mime?.startsWith('image/')) &&
        info?.mime !== 'image/svg+xml',
    )
    .map((info) => info.thumburl as string);
}

async function buildImagePool(
  queries: readonly string[],
  size: number,
): Promise<Buffer[]> {
  const candidateUrls = new Set<string>();
  for (const query of queries) {
    try {
      const urls = await searchWikimediaImageUrls(
        query,
        Math.ceil(size / queries.length) + 10,
      );
      urls.forEach((url) => candidateUrls.add(url));
    } catch {
      continue;
    }
  }
  if (candidateUrls.size === 0) {
    throw new Error(
      `Nenhuma imagem encontrada no Wikimedia Commons para: ${queries.join(', ')}`,
    );
  }

  const pool: Buffer[] = [];
  for (const url of shuffle([...candidateUrls])) {
    if (pool.length >= size) break;
    try {
      pool.push(await withRetry(() => fetchImageBuffer(url), 3));
    } catch {
      continue;
    }
  }
  if (pool.length === 0) {
    throw new Error(
      `Falha ao baixar imagens do Wikimedia Commons para: ${queries.join(', ')}`,
    );
  }
  return pool;
}

async function uploadFromPool(key: string, pool: Buffer[]): Promise<number> {
  const buffer = pick(pool);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
      ContentLength: buffer.length,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return buffer.length;
}

interface RoomPlan {
  id: string;
  propertyId: string;
  title: string;
  description: string | null;
  priceCents: number;
  capacity: number;
  bathroomType: BathroomType;
  acceptedAudiences: GenderIdentity[];
  amenities: string[];
  additionalInfo: string | null;
  status: RoomStatus;
  imageCount: number;
  featured: boolean;
}

interface PropertyPlan {
  id: string;
  ownerProfileId: string;
  state: string;
  city: string;
  neighborhood: string;
  title: string;
  description: string | null;
  houseRules: string | null;
  generalInfo: string | null;
  features: string[];
  referencePoints: string[];
  sharedAreaCount: number;
  status: PropertyStatus;
  rooms: RoomPlan[];
}

function buildRoomPlan(propertyId: string, index: number): RoomPlan {
  const isPremium = Math.random() < 0.15;
  const priceCents = isPremium
    ? randomInt(90_000, 300_000)
    : randomInt(15_000, 90_000);
  const status = weightedPick({
    AVAILABLE: 85,
    UNAVAILABLE: 10,
    INACTIVE: 5,
  }) as RoomStatus;

  return {
    id: crypto.randomUUID(),
    propertyId,
    title: `${pick(ROOM_TITLE_LABELS)} ${index + 1}`,
    description: maybe(pick(ROOM_DESCRIPTIONS_POOL), 0.7),
    priceCents,
    capacity: isPremium ? randomInt(2, 6) : randomInt(1, 4),
    bathroomType: weightedPick({
      PRIVATE: 40,
      SHARED: 60,
    }) as BathroomType,
    acceptedAudiences: pickSome(GENDER_IDENTITIES, 1, 4),
    amenities: pickSome(ROOM_AMENITIES, 0, 6),
    additionalInfo: maybe(pick(ROOM_ADDITIONAL_INFO_POOL), 0.4),
    status,
    imageCount: randomInt(2, 3),
    featured: false,
  };
}

function buildPropertyPlan(ownerProfileId: string): PropertyPlan {
  const state = weightedPick(STATE_WEIGHTS);
  const city = STATE_CAPITALS[state];
  const neighborhood = pick(NEIGHBORHOODS);
  const propertyId = crypto.randomUUID();
  const roomCount = randomInt(1, 5);

  return {
    id: propertyId,
    ownerProfileId,
    state,
    city,
    neighborhood,
    title: `${pick(PROPERTY_TYPE_LABELS)} ${neighborhood} - ${city}`,
    description: maybe(pick(PROPERTY_DESCRIPTIONS), 0.75),
    houseRules: maybe(pick(HOUSE_RULES_POOL), 0.4),
    generalInfo: maybe(pick(GENERAL_INFO_POOL), 0.4),
    features: pickSome(PROPERTY_FEATURES, 0, 5),
    referencePoints: pickSome(REFERENCE_POINTS_POOL, 0, 3),
    sharedAreaCount: randomInt(0, 4),
    status: weightedPick({
      ACTIVE: 80,
      DRAFT: 10,
      UNAVAILABLE: 10,
    }) as PropertyStatus,
    rooms: Array.from({ length: roomCount }, (_, k) =>
      buildRoomPlan(propertyId, k),
    ),
  };
}

async function main(): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { email: { endsWith: SEED_EMAIL_DOMAIN } },
  });
  if (existing) {
    throw new Error(
      'Massa de seed já existe. Rode "npm run seed:cleanup" antes de gerar outra.',
    );
  }

  const ownerIds = Array.from({ length: 200 }, () => crypto.randomUUID());
  const properties: PropertyPlan[] = [];
  let totalRooms = 0;
  while (totalRooms < TOTAL_ROOMS_TARGET) {
    const ownerProfileId = pick(ownerIds);
    const plan = buildPropertyPlan(ownerProfileId);
    const remaining = TOTAL_ROOMS_TARGET - totalRooms;
    if (plan.rooms.length > remaining) {
      plan.rooms = plan.rooms.slice(0, remaining);
    }
    if (plan.rooms.length === 0) {
      continue;
    }
    properties.push(plan);
    totalRooms += plan.rooms.length;
  }

  const availableRooms = properties
    .flatMap((property) => property.rooms)
    .filter((room) => room.status === 'AVAILABLE');
  const featuredCount = Math.round(totalRooms * FEATURED_RATIO);
  for (const room of shuffle(availableRooms).slice(0, featuredCount)) {
    room.featured = true;
  }

  interface MediaTask {
    key: string;
    kind: 'property' | 'room';
  }
  const propertyMediaTasks = new Map<string, MediaTask[]>();
  const roomMediaTasks = new Map<string, MediaTask[]>();
  for (const property of properties) {
    propertyMediaTasks.set(
      property.id,
      Array.from({ length: 2 }, (_, k) => ({
        key: `seed/properties/${property.id}/${k + 1}.jpg`,
        kind: 'property' as const,
      })),
    );
    for (const room of property.rooms) {
      roomMediaTasks.set(
        room.id,
        Array.from({ length: room.imageCount }, (_, k) => ({
          key: `seed/rooms/${room.id}/${k + 1}.jpg`,
          kind: 'room' as const,
        })),
      );
    }
  }
  const allTasks = [
    ...[...propertyMediaTasks.values()].flat(),
    ...[...roomMediaTasks.values()].flat(),
  ];

  console.log(
    `Baixando pools de imagens temáticas (${PROPERTY_IMAGE_POOL_SIZE} de casa, ${ROOM_IMAGE_POOL_SIZE} de quarto)...`,
  );
  const [propertyPool, roomPool] = await Promise.all([
    buildImagePool(PROPERTY_IMAGE_QUERIES, PROPERTY_IMAGE_POOL_SIZE),
    buildImagePool(ROOM_IMAGE_QUERIES, ROOM_IMAGE_POOL_SIZE),
  ]);
  const poolByKind = { property: propertyPool, room: roomPool };

  console.log(`Enviando ${allTasks.length} imagens para o R2...`);
  const sizes = await mapWithConcurrency(
    allTasks,
    IMAGE_UPLOAD_CONCURRENCY,
    (task) => uploadFromPool(task.key, poolByKind[task.kind]),
  );
  const sizeByKey = new Map(allTasks.map((task, i) => [task.key, sizes[i]]));

  const passwordHash = await argon2.hash('Senha123!');
  await prisma.user.createMany({
    data: ownerIds.map((id, i) => ({
      id,
      name: `Proprietário Seed ${i + 1}`,
      email: `proprietario-${i + 1}${SEED_EMAIL_DOMAIN}`,
      passwordHash,
      roles: ['OWNER'],
      phone: '+5511999990000',
      birthDate: new Date('1990-01-01'),
      emailVerifiedAt: new Date(),
    })),
  });
  await prisma.ownerProfile.createMany({
    data: ownerIds.map((userId) => ({ id: userId, userId })),
  });

  await prisma.property.createMany({
    data: properties.map((property) => ({
      id: property.id,
      ownerProfileId: property.ownerProfileId,
      status: property.status,
      type: 'HOUSE',
      title: property.title,
      description: property.description,
      houseRules: property.houseRules,
      generalInfo: property.generalInfo,
      features: property.features,
      postalCode: `${randomInt(10000, 99999)}${randomInt(100, 999)}`,
      street: `Rua ${randomInt(1, 999)}`,
      number: String(randomInt(1, 500)),
      neighborhood: property.neighborhood,
      city: property.city,
      state: property.state,
      referencePoints: property.referencePoints,
    })),
  });

  const propertyMediaRows: Prisma.PropertyMediaCreateManyInput[] = [];
  const sharedAreaRows: Prisma.PropertySharedAreaCreateManyInput[] = [];
  const roomRows: Prisma.RoomCreateManyInput[] = [];
  const roomMediaRows: Prisma.RoomMediaCreateManyInput[] = [];

  for (const property of properties) {
    const mediaType: MediaType = 'IMAGE';
    (propertyMediaTasks.get(property.id) ?? []).forEach((task, k) => {
      propertyMediaRows.push({
        id: crypto.randomUUID(),
        propertyId: property.id,
        type: mediaType,
        storageKey: task.key,
        mimeType: 'image/jpeg',
        sizeBytes: sizeByKey.get(task.key) ?? 0,
        position: k,
      });
    });
    for (let k = 0; k < property.sharedAreaCount; k += 1) {
      sharedAreaRows.push({
        id: crypto.randomUUID(),
        propertyId: property.id,
        type: 'LIVING_ROOM',
        label: `Área comum ${k + 1}`,
        position: k,
      });
    }

    for (const room of property.rooms) {
      const { score } = evaluateCompleteness({
        room: {
          description: room.description,
          amenities: room.amenities,
          additionalInfo: room.additionalInfo,
          imageCount: room.imageCount,
        },
        property: {
          description: property.description,
          houseRules: property.houseRules,
          generalInfo: property.generalInfo,
          features: property.features,
          referencePoints: property.referencePoints,
          sharedAreaCount: property.sharedAreaCount,
          imageCount: 2,
        },
      });
      const rankingScore = rankingScoreFor({ completenessScore: score });

      roomRows.push({
        id: room.id,
        propertyId: property.id,
        status: room.status,
        title: room.title,
        description: room.description,
        priceCents: room.priceCents,
        capacity: room.capacity,
        bathroomType: room.bathroomType,
        acceptedAudiences: room.acceptedAudiences,
        amenities: room.amenities,
        additionalInfo: room.additionalInfo,
        completenessScore: score,
        rankingScore,
        rankingVersion: RANKING_VERSION,
        rankingUpdatedAt: new Date(),
        featuredFrom: room.featured
          ? new Date(Date.now() - randomInt(0, 2) * 24 * 60 * 60 * 1000)
          : null,
        featuredUntil: room.featured
          ? new Date(Date.now() + randomInt(3, 14) * 24 * 60 * 60 * 1000)
          : null,
      });

      (roomMediaTasks.get(room.id) ?? []).forEach((task, k) => {
        roomMediaRows.push({
          id: crypto.randomUUID(),
          roomId: room.id,
          type: mediaType,
          storageKey: task.key,
          mimeType: 'image/jpeg',
          sizeBytes: sizeByKey.get(task.key) ?? 0,
          position: k,
        });
      });
    }
  }

  await prisma.propertyMedia.createMany({ data: propertyMediaRows });
  await prisma.propertySharedArea.createMany({ data: sharedAreaRows });
  await prisma.room.createMany({ data: roomRows });
  await prisma.roomMedia.createMany({ data: roomMediaRows });

  const guestPasswordHash = await argon2.hash('Senha123!');
  await prisma.user.create({
    data: {
      name: 'Hóspede Seed',
      email: `hospede-1${SEED_EMAIL_DOMAIN}`,
      passwordHash: guestPasswordHash,
      roles: ['GUEST'],
      emailVerifiedAt: new Date(),
      guestProfile: { create: { genderIdentity: 'WOMAN' } },
    },
  });

  console.log(
    `Seed concluído: ${properties.length} imóveis, ${totalRooms} quartos (${featuredCount} em destaque).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    s3.destroy();
  });
