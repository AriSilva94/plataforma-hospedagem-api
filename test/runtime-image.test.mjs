import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const entrypoint = readFileSync(
  new URL('../docker-entrypoint.sh', import.meta.url),
  'utf8',
);

test('runs Prisma migrations before starting the backend', () => {
  assert.match(dockerfile, /COPY --chown=node:node docker-entrypoint\.sh/);
  assert.match(dockerfile, /CMD \["\.\/docker-entrypoint\.sh"\]/);
  assert.match(entrypoint, /prisma migrate deploy/);
  assert.match(entrypoint, /exec node dist\/main\.js/);
});
