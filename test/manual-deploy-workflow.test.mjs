import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/docker-build.yml', import.meta.url),
  'utf8',
);

test('allows manual deployment with the selected workflow branch', () => {
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
});

test('runs staging migrations before the Dokploy deploy', () => {
  assert.match(workflow, /migrate-staging:/);
  assert.match(workflow, /if: github\.event_name != 'pull_request' && github\.ref_name == 'release\/separate-steps'/);
  assert.match(workflow, /docker run --rm --network \"\$network\" --env-file \"\$env_file\" \"\$image_ref\" \.\/node_modules\/\.bin\/prisma migrate deploy/);
  assert.match(workflow, /needs: \[build-and-push, scan-image, migrate-staging\]/);
  assert.match(workflow, /always\(\).*needs\.migrate-staging\.result == 'success'/s);
});
