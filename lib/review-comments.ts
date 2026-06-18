import type { FlueSession } from '@flue/runtime';

export const REVIEW_MARKER = '<!-- flipt-pr-review-agent -->';
export const REVIEW_FOOTER = '_🤖 Automated review by the Flipt [PR review agent](https://github.com/flipt-io/agents)._';

export type ReviewFinding = {
  file: string;
  line?: number;
  severity: 'critical' | 'major' | 'minor' | 'nit';
  comment: string;
};

export type ReviewResult = {
  verdict: 'approve' | 'comment' | 'request_changes';
  summary: string;
  findings: ReviewFinding[];
};

export type ExistingReviewTarget = { kind: 'issue-comment' | 'review'; id: number };
export type ExistingDiscussion = {
  issueComments: Array<{ id?: number; body?: string | null; created_at?: string | null; updated_at?: string | null }>;
  reviews: Array<{ id?: number; body?: string | null; submitted_at?: string | null; updated_at?: string | null }>;
};

const VERDICT_LABEL: Record<ReviewResult['verdict'], string> = {
  approve: 'approve',
  comment: 'comment',
  request_changes: 'request changes',
};

function isBotReviewBody(body: string | null | undefined): boolean {
  return Boolean(body && (body.includes(REVIEW_MARKER) || body.includes(REVIEW_FOOTER)));
}

function timestampMillis(value: string | null | undefined): number {
  if (!value) return 0;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? 0 : millis;
}

export function findExistingReviewTarget(discussion: ExistingDiscussion): ExistingReviewTarget | undefined {
  const candidates: Array<ExistingReviewTarget & { timestamp: number }> = [];

  for (const comment of discussion.issueComments) {
    if (typeof comment.id === 'number' && isBotReviewBody(comment.body)) {
      candidates.push({
        kind: 'issue-comment',
        id: comment.id,
        timestamp: Math.max(timestampMillis(comment.updated_at), timestampMillis(comment.created_at)),
      });
    }
  }

  for (const review of discussion.reviews) {
    if (typeof review.id === 'number' && isBotReviewBody(review.body)) {
      candidates.push({
        kind: 'review',
        id: review.id,
        timestamp: Math.max(timestampMillis(review.updated_at), timestampMillis(review.submitted_at)),
      });
    }
  }

  const newest = candidates.sort((a, b) => b.timestamp - a.timestamp)[0];
  return newest ? { kind: newest.kind, id: newest.id } : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseGhPaginatedArray<T>(stdout: string): T[] {
  const parsed = JSON.parse(stdout) as T[] | T[][];
  return Array.isArray(parsed[0]) ? (parsed as T[][]).flat() : (parsed as T[]);
}

export function renderReview(r: ReviewResult): string {
  const lines = [REVIEW_MARKER, '', `**Verdict: ${VERDICT_LABEL[r.verdict]}**`, '', r.summary.trim()];
  if (r.findings.length > 0) {
    for (const file of [...new Set(r.findings.map((f) => f.file))]) {
      lines.push('', `### ${file}`);
      for (const f of r.findings.filter((f) => f.file === file)) {
        lines.push(`- **${f.severity}**${f.line ? ` (L${f.line})` : ''}: ${f.comment}`);
      }
    }
  }
  lines.push('', REVIEW_FOOTER);
  return lines.join('\n');
}

async function fetchExistingReviewTarget(
  session: FlueSession,
  prNumber: number,
  repo: string,
): Promise<ExistingReviewTarget | undefined> {
  const issueComments = await session.shell(
    `gh api ${shellQuote(`repos/${repo}/issues/${prNumber}/comments`)} --paginate --slurp`,
  );
  const reviews = await session.shell(`gh api ${shellQuote(`repos/${repo}/pulls/${prNumber}/reviews`)} --paginate --slurp`);

  if (issueComments.exitCode !== 0 || reviews.exitCode !== 0) return undefined;

  try {
    return findExistingReviewTarget({
      issueComments: parseGhPaginatedArray(issueComments.stdout),
      reviews: parseGhPaginatedArray(reviews.stdout),
    });
  } catch {
    return undefined;
  }
}

async function updateExistingReview(
  session: FlueSession,
  prNumber: number,
  repo: string,
  target: ExistingReviewTarget,
  body: string,
): Promise<boolean> {
  const payloadPath = '/tmp/flue-review-payload.json';
  await session.fs.writeFile(payloadPath, JSON.stringify({ body }));

  const endpoint =
    target.kind === 'issue-comment'
      ? `repos/${repo}/issues/comments/${target.id}`
      : `repos/${repo}/pulls/${prNumber}/reviews/${target.id}`;
  const method = target.kind === 'issue-comment' ? 'PATCH' : 'PUT';
  const { exitCode } = await session.shell(
    `gh api --method ${method} ${shellQuote(endpoint)} --input ${shellQuote(payloadPath)}`,
  );
  return exitCode === 0;
}

export async function postReview(
  session: FlueSession,
  prNumber: number,
  repo: string,
  body: string,
): Promise<boolean> {
  const existing = await fetchExistingReviewTarget(session, prNumber, repo);
  if (existing && (await updateExistingReview(session, prNumber, repo, existing, body))) return true;

  const bodyPath = '/tmp/flue-review.md';
  await session.fs.writeFile(bodyPath, body);
  const target = `${prNumber} --repo ${shellQuote(repo)} --body-file ${shellQuote(bodyPath)}`;
  for (const cmd of [`gh pr review ${target} --comment`, `gh pr comment ${target}`]) {
    const { exitCode } = await session.shell(cmd);
    if (exitCode === 0) return true;
  }
  return false;
}
