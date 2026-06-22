import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const action = await readFile(new URL('../actions/issue-health/action.yml', import.meta.url), 'utf8');
const readme = await readFile(new URL('../actions/issue-health/README.md', import.meta.url), 'utf8');
const example = await readFile(new URL('../examples/issue-health-workflow.yml', import.meta.url), 'utf8');

test('issue-health action declares the expected inputs and config env vars', () => {
  for (const input of [
    'issue-number',
    'repo',
    'model',
    'override-mode',
    'github-token',
    'comment-mode',
    'label-mode',
  ]) {
    assert.match(action, new RegExp(`^  ${input}:`, 'm'));
  }

  for (const envName of [
    'ISSUE_HEALTH_AGENT_DIR',
    'ISSUE_HEALTH_TARGET_DIR',
    'ISSUE_HEALTH_OVERRIDE_MODE',
    'ISSUE_HEALTH_MODEL',
    'ISSUE_HEALTH_COMMENT_MODE',
    'ISSUE_HEALTH_LABEL_MODE',
  ]) {
    assert.match(action, new RegExp(`^        ${envName}:`, 'm'));
  }
});

test('issue-health action validates documented enum inputs', () => {
  assert.match(action, /override-mode must be merge or replace/);
  assert.match(action, /comment-mode must be always, needs-improvement, or off/);
  assert.match(action, /label-mode must be existing-only or off/);
});

test('issue-health docs and example use issues.opened with minimal required permissions', () => {
  for (const body of [readme, example]) {
    assert.match(body, /issues:\n\s+types: \[opened\]/);
    assert.match(body, /permissions:\n\s+contents: read\n\s+issues: write\n\s+models: read/);
    assert.match(body, /issue-number: \$\{\{ github\.event\.issue\.number \}\}/);
  }

  assert.doesNotMatch(example, /pull-requests: write/);
});

test('issue-health docs state labels are existing-only and never created', () => {
  assert.match(action, /existing-only/);
  assert.match(readme, /never creates labels/i);
  assert.match(example, /never creates labels/i);
});
