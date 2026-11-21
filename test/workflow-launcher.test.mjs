import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const name of ['pr-review', 'issue-health']) {
  test(`${name} launcher transforms skill imports and validates payload before IO`, () => {
    const result = spawnSync(process.execPath, ['scripts/run.mjs', name, '--', '--payload', '{}'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        REVIEW_MODEL: 'test/model', ISSUE_HEALTH_MODEL: 'test/model',
        REVIEW_DOCS_MCP_URL: '',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ValiError/);
    assert.doesNotMatch(result.stderr, /Unknown file extension|Failed to resolve|does not provide an export/);
  });
}

test('launcher rejects unknown jobs before loading Vite modules', () => {
  const result = spawnSync(process.execPath, ['scripts/run.mjs', 'unknown', '--payload', '{}'], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
