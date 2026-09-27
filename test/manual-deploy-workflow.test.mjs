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
