import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prAction = await readFile(new URL('../actions/pr-review/action.yml', import.meta.url), 'utf8');
const issueAction = await readFile(new URL('../actions/issue-health/action.yml', import.meta.url), 'utf8');
const prWorkflow = await readFile(new URL('../workflows/pr-review.ts', import.meta.url), 'utf8');
const issueWorkflow = await readFile(new URL('../workflows/issue-health.ts', import.meta.url), 'utf8');

test('PR review action supports a workflow-specific local config directory', () => {
  assert.match(prAction, /^  local-config-dir:/m);
  assert.match(prAction, /Defaults to \.agents/);
  assert.match(prAction, /^        REVIEW_LOCAL_CONFIG_DIR: \$\{\{ inputs\.local-config-dir \}\}/m);
  assert.match(prWorkflow, /REVIEW_LOCAL_CONFIG_DIR/);
  assert.match(prWorkflow, /resolveLocalConfigDir\(env\.REVIEW_TARGET_DIR, env\.REVIEW_LOCAL_CONFIG_DIR\)/);
});

test('issue-health action supports a workflow-specific local config directory', () => {
  assert.match(issueAction, /^  local-config-dir:/m);
  assert.match(issueAction, /Defaults to \.agents/);
  assert.match(issueAction, /^        ISSUE_HEALTH_LOCAL_CONFIG_DIR: \$\{\{ inputs\.local-config-dir \}\}/m);
  assert.match(issueWorkflow, /ISSUE_HEALTH_LOCAL_CONFIG_DIR/);
  assert.match(issueWorkflow, /resolveLocalConfigDir\(env\.ISSUE_HEALTH_TARGET_DIR, env\.ISSUE_HEALTH_LOCAL_CONFIG_DIR\)/);
});
