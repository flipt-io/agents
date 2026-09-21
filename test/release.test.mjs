import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const pkg = JSON.parse(await read('package.json'));
const release = await read('.github/workflows/release.yml');
const changelog = await read('CHANGELOG.md');
const docs = await Promise.all([
  read('examples/consumer-workflow.yml'),
  read('examples/issue-health-workflow.yml'),
  read('actions/pr-review/README.md'),
  read('actions/issue-health/README.md'),
]);

test('the declared version is semver and has a changelog entry', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')}\\b`, 'm'));
});

test('release runs on semver tags and gates on the full validation suite', () => {
  assert.match(release, /tags:\n\s+- 'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/);

  // A tag is the only gate consumers get; none of these may be dropped.
  for (const step of ['tsc --noEmit', 'node --test test/', 'pnpm build']) {
    assert.ok(release.includes(step), `release workflow must run \`${step}\``);
  }

  // The alias consumers pin has to follow the newest release.
  assert.match(release, /git push --force origin "refs\/tags\/\$major"/);
});

test('consumer-facing docs pin a released major, never @main', () => {
  for (const body of docs) {
    assert.doesNotMatch(body, /uses: \S*agents\/actions\/\S+@main/);
    assert.match(body, /uses: \S*agents\/actions\/\S+@v\d/);
  }
});
