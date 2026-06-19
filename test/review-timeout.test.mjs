import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseReviewStats,
  resolveReviewBudget,
  reviewStatsCommand,
  resolveReviewTimeoutMs,
  timeoutReviewResult,
} from '../lib/review-timeout.ts';

test('resolveReviewTimeoutMs defaults to eight minutes', () => {
  assert.equal(resolveReviewTimeoutMs({}), 8 * 60_000);
});

test('resolveReviewTimeoutMs accepts REVIEW_TIMEOUT_MS', () => {
  assert.equal(resolveReviewTimeoutMs({ REVIEW_TIMEOUT_MS: '1000' }), 1000);
});

test('resolveReviewTimeoutMs ignores invalid values', () => {
  assert.equal(resolveReviewTimeoutMs({ REVIEW_TIMEOUT_MS: 'nope' }), 8 * 60_000);
  assert.equal(resolveReviewTimeoutMs({ REVIEW_TIMEOUT_MS: '0' }), 8 * 60_000);
});

test('reviewStatsCommand quotes repo names', () => {
  assert.equal(
    reviewStatsCommand(12, "owner/re'po"),
    "gh pr view 12 --repo 'owner/re'\\''po' --json additions,deletions,changedFiles",
  );
});

test('parseReviewStats reads gh pr view output', () => {
  assert.deepEqual(parseReviewStats('{"changedFiles":2,"additions":10,"deletions":5}'), {
    changedFiles: 2,
    additions: 10,
    deletions: 5,
  });
});

test('resolveReviewBudget chooses tiers from PR size', () => {
  assert.equal(resolveReviewBudget({ changedFiles: 2, additions: 50, deletions: 25 }, {}).tier, 'tiny');
  assert.equal(resolveReviewBudget({ changedFiles: 8, additions: 200, deletions: 100 }, {}).tier, 'small');
  assert.equal(resolveReviewBudget({ changedFiles: 20, additions: 700, deletions: 200 }, {}).tier, 'medium');
  assert.equal(resolveReviewBudget({ changedFiles: 40, additions: 1200, deletions: 100 }, {}).tier, 'large');
});

test('resolveReviewBudget lets REVIEW_TIMEOUT_MS override tier timeout', () => {
  assert.equal(resolveReviewBudget({ changedFiles: 2, additions: 1, deletions: 1 }, { REVIEW_TIMEOUT_MS: '1234' }).timeoutMs, 1234);
});

test('timeoutReviewResult returns a non-blocking comment result', () => {
  assert.deepEqual(timeoutReviewResult(1500), {
    verdict: 'comment',
    summary: 'Automated review timed out after 2s. No reliable findings were produced.',
    findings: [],
  });
});
