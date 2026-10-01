import { check, fail, sleep } from 'k6';
import http, { type RefinedResponse } from 'k6/http';
import type { Options } from 'k6/options';

interface RoomCard {
  id: string;
  featured: boolean;
}

interface RoomPage {
  items: RoomCard[];
  nextCursor: string | null;
  total?: number;
}

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3030').replace(/\/$/, '');
const pageSize = positiveNumber('PAGE_SIZE', 12);
const pagesPerSession = positiveNumber('PAGES_PER_SESSION', 3);
const sessionsPerSecond = positiveNumber('SESSIONS_PER_SECOND', 10);
const thinkTimeSeconds = positiveNumber('THINK_TIME_SECONDS', 1);
const holdDuration = __ENV.HOLD_DURATION || '2m';

const firstPage = { page: 'first', name: 'GET /rooms' };
const nextPage: typeof firstPage = {
  page: 'next',
  name: 'GET /rooms?cursor',
};

export const options: Options = {
  scenarios: {
    browse_home: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.ceil(sessionsPerSecond * pagesPerSession * 2),
      maxVUs: Math.ceil(sessionsPerSecond * pagesPerSession * 10),
      stages: [
        { duration: '30s', target: sessionsPerSecond },
        { duration: holdDuration, target: sessionsPerSecond },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{page:first}': ['p(95)<100'],
    'http_req_duration{page:next}': ['p(95)<50'],
    dropped_iterations: ['count<1'],
  },
};

export function setup(): { total: number } {
  const response = http.get(`${baseUrl}/rooms?limit=1`);
  if (response.status === 0) {
    fail(
      `Não foi possível conectar em ${baseUrl} (${response.error}). Confirme que a API está no ar e já registrou "Nest application successfully started"; depois de gerar a massa, ela recalcula o ranking antes de aceitar conexões.`,
    );
  }
  if (response.status === 429) {
    fail(
      'A API limitou as requisições (HTTP 429). Inicie a API alvo com THROTTLE_LIMIT alto e THROTTLE_KEY_PREFIX exclusivo para o teste de carga.',
    );
  }
  if (response.status !== 200) {
    fail(`API indisponível em ${baseUrl}: HTTP ${response.status}.`);
  }
  const rateLimit = Number(response.headers['X-Ratelimit-Limit']);
  const requestsPerMinute = Math.ceil(sessionsPerSecond * pagesPerSession * 60);
  if (rateLimit > 0 && rateLimit < requestsPerMinute) {
    fail(
      `O rate limiting da API (${rateLimit} requisições por janela) não comporta o cenário (~${requestsPerMinute} por minuto de um único IP). Inicie a API alvo com THROTTLE_LIMIT alto e THROTTLE_KEY_PREFIX exclusivo para o teste de carga.`,
    );
  }
  const total = (response.json() as unknown as RoomPage).total ?? 0;
  console.log(`Quartos elegíveis na listagem: ${total}`);
  return { total };
}

export default function browseHome(): void {
  const seen = new Set<string>();
  let organicStarted = false;
  let cursor: string | null = null;

  for (let page = 0; page < pagesPerSession; page++) {
    const result = fetchPage(cursor);

    check(
      result.response,
      {
        'status 200': (response) => response.status === 200,
        'sem quarto repetido na sessão': () =>
          result.items.every((item) => !seen.has(item.id)),
        'destaques antes dos orgânicos': () =>
          result.items.every((item) => {
            if (!item.featured) {
              organicStarted = true;
              return true;
            }
            return !organicStarted;
          }),
      },
      result.tags,
    );

    result.items.forEach((item) => seen.add(item.id));
    cursor = result.nextCursor;
    if (cursor === null) {
      return;
    }
    sleep(thinkTimeSeconds);
  }
}

function fetchPage(cursor: string | null): {
  response: RefinedResponse<'text'>;
  tags: typeof firstPage;
  items: RoomCard[];
  nextCursor: string | null;
} {
  const tags = cursor === null ? firstPage : nextPage;
  const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
  const response = http.get(`${baseUrl}/rooms?limit=${pageSize}${query}`, {
    tags,
  });
  const body =
    response.status === 200
      ? (response.json() as unknown as RoomPage)
      : undefined;
  return {
    response,
    tags,
    items: body?.items ?? [],
    nextCursor: body?.nextCursor ?? null,
  };
}

function positiveNumber(name: string, fallback: number): number {
  const raw = __ENV[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${name} deve ser um número positivo; recebido "${raw}".`);
  }
  return value;
}
