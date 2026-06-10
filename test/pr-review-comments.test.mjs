import assert from 'node:assert/strict';
import test from 'node:test';
import { findExistingReviewTarget, parseGhPaginatedArray, postReview, renderReview } from '../lib/review-comments.ts';

test('renderReview includes a stable hidden marker', () => {
  const body = renderReview({ verdict: 'comment', summary: 'Summary', findings: [] });

  assert.match(body, /<!-- flipt-pr-review-agent -->/);
});

test('findExistingReviewTarget selects the newest bot-authored review or PR comment', () => {
  const target = findExistingReviewTarget({
    issueComments: [
      { id: 11, body: 'old human comment', created_at: '2026-01-01T00:00:00Z' },
      {
        id: 12,
        body: 'older bot comment\n<!-- flipt-pr-review-agent -->',
        created_at: '2026-01-02T00:00:00Z',
      },
    ],
    reviews: [
      {
        id: 21,
        body: 'newer legacy bot review\n_🤖 Automated review by the Flipt [PR review agent](https://github.com/flipt-io/agents)._',
        submitted_at: '2026-01-03T00:00:00Z',
      },
    ],
  });

  assert.deepEqual(target, { kind: 'review', id: 21 });
});

test('findExistingReviewTarget returns undefined when there is no bot-authored body', () => {
  const target = findExistingReviewTarget({
    issueComments: [{ id: 11, body: 'human comment', created_at: '2026-01-01T00:00:00Z' }],
    reviews: [{ id: 21, body: 'human review', submitted_at: '2026-01-02T00:00:00Z' }],
  });

  assert.equal(target, undefined);
});

test('parseGhPaginatedArray flattens gh api --paginate --slurp output', () => {
  const parsed = parseGhPaginatedArray('[[{"id":1}],[{"id":2}]]');

  assert.deepEqual(parsed, [{ id: 1 }, { id: 2 }]);
});

test('postReview updates an existing bot-authored PR comment instead of creating another one', async () => {
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
      if (command.includes('/issues/123/comments')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([[{ id: 44, body: '<!-- flipt-pr-review-agent -->', created_at: '2026-01-01T00:00:00Z' }]]),
          stderr: '',
        };
      }
      if (command.includes('/pulls/123/reviews')) {
        return { exitCode: 0, stdout: JSON.stringify([[]]), stderr: '' };
      }
      if (command.includes('/issues/comments/44')) {
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
    },
  };

  const posted = await postReview(session, 123, 'owner/repo', 'new body');

  assert.equal(posted, true);
  assert.ok(commands.some((command) => command.includes('gh api --method PATCH')));
  assert.ok(commands.every((command) => !command.startsWith('gh pr review') && !command.startsWith('gh pr comment')));
  assert.deepEqual(JSON.parse(writes[0].content), { body: 'new body' });
});
