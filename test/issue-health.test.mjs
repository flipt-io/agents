import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ISSUE_HEALTH_COMMENT_MODES,
  ISSUE_HEALTH_ISSUE_TYPES,
  ISSUE_HEALTH_LABEL_MODES,
  ISSUE_HEALTH_MARKER,
  ISSUE_HEALTH_RESULT_FIELDS,
  ISSUE_HEALTH_SUPPORT_FOOTER,
  ISSUE_HEALTH_VERDICTS,
  applyIssueHealthLabels,
  filterIssueHealthLabels,
  postIssueHealthComment,
  renderIssueHealthComment,
  resolveIssueHealthConfig,
  shouldPostIssueHealthComment,
} from '../lib/issue-health.ts';

const healthyResult = {
  issueType: 'bug',
  verdict: 'well_scoped',
  score: 94,
  summary: 'Clear reproduction with expected and actual behavior.',
  missingInfo: [],
  suggestedLabels: ['bug'],
  redactionWarning: null,
};

const needsInfoResult = {
  issueType: 'feature',
  verdict: 'needs_info',
  score: 42,
  summary: 'The goal is understandable, but the use case is not specific enough yet.',
  missingInfo: ['Describe the workflow this should support', 'Explain the expected behavior'],
  suggestedLabels: ['feature request', 'missing info', 'nonexistent-label'],
  redactionWarning: null,
};

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

test('renderIssueHealthComment includes marker, hides score by default, and renders the support footer once', () => {
  const body = renderIssueHealthComment(healthyResult);

  assert.match(body, new RegExp(ISSUE_HEALTH_MARKER));
  assert.doesNotMatch(body, /94\/100/);
  assert.equal(occurrences(body, 'https://github.com/sponsors/flipt-io'), 1);
  assert.equal(occurrences(body, 'https://docs.flipt.io/v2/pro'), 1);
  assert.equal(occurrences(body, ISSUE_HEALTH_SUPPORT_FOOTER), 1);
  assert.match(body, /ready for the maintainers to evaluate/);
});

test('renderIssueHealthComment can show the internal score explicitly', () => {
  const body = renderIssueHealthComment(healthyResult, { showScore: true });

  assert.match(body, /Internal score: 94\/100/);
});

test('renderIssueHealthComment renders a checklist for issues that need more information', () => {
  const body = renderIssueHealthComment(needsInfoResult);

  assert.match(body, /To help the maintainers act on this, please add:/);
  assert.match(body, /- \[ \] Describe the workflow this should support/);
  assert.match(body, /- \[ \] Explain the expected behavior/);
});

test('renderIssueHealthComment renders fallback checklist copy for not actionable issues without specific missing info', () => {
  const body = renderIssueHealthComment({
    issueType: 'other',
    verdict: 'not_actionable',
    score: 10,
    summary: 'The issue does not include a clear ask.',
    missingInfo: [],
    suggestedLabels: ['not actionable'],
    redactionWarning: null,
  });

  assert.match(body, /Issue Health Check: Not actionable yet/);
  assert.match(body, /Enough detail for a maintainer to reproduce, evaluate, or answer the issue/);
});

test('issue-health schema and mode constants match the canonical contract', () => {
  assert.deepEqual(ISSUE_HEALTH_RESULT_FIELDS, [
    'issueType',
    'verdict',
    'score',
    'summary',
    'missingInfo',
    'suggestedLabels',
    'redactionWarning',
  ]);
  assert.deepEqual(ISSUE_HEALTH_ISSUE_TYPES, ['bug', 'feature', 'docs', 'question', 'other']);
  assert.deepEqual(ISSUE_HEALTH_VERDICTS, ['well_scoped', 'mostly_actionable', 'needs_info', 'not_actionable']);
  assert.deepEqual(ISSUE_HEALTH_COMMENT_MODES, ['always', 'needs-improvement', 'off']);
  assert.deepEqual(ISSUE_HEALTH_LABEL_MODES, ['existing-only', 'off']);
});

test('resolveIssueHealthConfig defaults to always commenting and existing-label-only labeling', () => {
  const cfg = resolveIssueHealthConfig({});

  assert.deepEqual(cfg, { commentMode: 'always', labelMode: 'existing-only' });
  assert.equal(shouldPostIssueHealthComment(cfg.commentMode, healthyResult), true);
  assert.deepEqual(filterIssueHealthLabels(needsInfoResult, ['feature request', 'missing-info']), [
    'feature request',
    'missing-info',
  ]);
});

test('shouldPostIssueHealthComment honors non-default comment modes', () => {
  assert.equal(shouldPostIssueHealthComment('needs-improvement', healthyResult), false);
  assert.equal(shouldPostIssueHealthComment('needs-improvement', needsInfoResult), true);
  assert.equal(shouldPostIssueHealthComment('off', needsInfoResult), false);
});

test('resolveIssueHealthConfig rejects unknown modes', () => {
  assert.throws(() => resolveIssueHealthConfig({ ISSUE_HEALTH_COMMENT_MODE: 'sometimes' }), /Invalid issue-health mode/);
  assert.throws(() => resolveIssueHealthConfig({ ISSUE_HEALTH_LABEL_MODE: 'create-missing' }), /Invalid issue-health mode/);
});

test('filterIssueHealthLabels only applies suggested labels that exist in the target repo', () => {
  const labels = filterIssueHealthLabels(needsInfoResult, [
    'bug',
    'enhancement',
    'feature request',
    'missing-info',
    'needs-triage',
  ]);

  assert.deepEqual(labels, ['feature request', 'missing-info']);
});

test('filterIssueHealthLabels does not map semantic suggestions to unrelated existing labels', () => {
  const labels = filterIssueHealthLabels(
    {
      issueType: 'feature',
      verdict: 'needs_info',
      score: 30,
      summary: 'The issue needs a clearer ask.',
      missingInfo: ['clear ask'],
      suggestedLabels: ['feature request', 'missing info', 'security'],
      redactionWarning: null,
    },
    ['enhancement', 'needs-info', 'needs-triage'],
  );

  assert.deepEqual(labels, []);
});

test('filterIssueHealthLabels can be disabled', () => {
  const labels = filterIssueHealthLabels(needsInfoResult, ['enhancement', 'needs-info'], 'off');

  assert.deepEqual(labels, []);
});

test('postIssueHealthComment writes the body to a file and passes it to gh issue comment', async () => {
  const commands = [];
  const writes = [];
  const session = {
    fs: {
      async writeFile(path, content) {
        writes.push({ path, content });
      },
    },
    async shell(command) {
      commands.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const posted = await postIssueHealthComment(session, 123, 'owner/repo', 'comment body');

  assert.equal(posted, true);
  assert.deepEqual(writes, [{ path: '/tmp/flue-issue-health-comment.md', content: 'comment body' }]);
  assert.equal(commands.length, 1);
  assert.match(commands[0], /^gh issue comment 123 --repo 'owner\/repo' --body-file '\/tmp\/flue-issue-health-comment\.md'$/);
});

test('applyIssueHealthLabels filters before invoking gh issue edit and never creates labels', async () => {
  const commands = [];
  const session = {
    async shell(command) {
      commands.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const result = await applyIssueHealthLabels(session, 123, 'owner/repo', needsInfoResult, [
    'feature request',
    'missing-info',
  ]);

  assert.deepEqual(result, { labels: ['feature request', 'missing-info'], applied: true });
  assert.equal(commands.length, 1);
  assert.match(commands[0], /^gh issue edit 123 --repo 'owner\/repo' --add-label 'feature request' --add-label 'missing-info'$/);
  assert.doesNotMatch(commands[0], /label create|gh label/);
  assert.doesNotMatch(commands[0], /nonexistent-label/);
});

test('applyIssueHealthLabels skips gh when no target repo labels match', async () => {
  const commands = [];
  const session = {
    async shell(command) {
      commands.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const result = await applyIssueHealthLabels(session, 123, 'owner/repo', needsInfoResult, []);

  assert.deepEqual(result, { labels: [], applied: true });
  assert.deepEqual(commands, []);
});

test('applyIssueHealthLabels skips gh when label mode is off', async () => {
  const commands = [];
  const session = {
    async shell(command) {
      commands.push(command);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };

  const result = await applyIssueHealthLabels(session, 123, 'owner/repo', needsInfoResult, ['enhancement'], {
    labelMode: 'off',
  });

  assert.deepEqual(result, { labels: [], applied: true });
  assert.deepEqual(commands, []);
});
