import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ISSUE_HEALTH_MARKER,
  ISSUE_HEALTH_SUPPORT_FOOTER,
  applyIssueHealthLabels,
  filterIssueHealthLabels,
  postIssueHealthComment,
  renderIssueHealthComment,
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

test('filterIssueHealthLabels only returns labels that exist in the target repo', () => {
  const labels = filterIssueHealthLabels(needsInfoResult, ['bug', 'enhancement', 'needs-info', 'needs-triage']);

  assert.deepEqual(labels, ['enhancement', 'needs-info', 'needs-triage']);
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
    'enhancement',
    'needs-info',
  ]);

  assert.deepEqual(result, { labels: ['enhancement', 'needs-info'], applied: true });
  assert.equal(commands.length, 1);
  assert.match(commands[0], /^gh issue edit 123 --repo 'owner\/repo' --add-label 'enhancement' --add-label 'needs-info'$/);
  assert.doesNotMatch(commands[0], /label create|gh label/);
  assert.doesNotMatch(commands[0], /nonexistent-label/);
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
