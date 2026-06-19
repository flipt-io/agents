const DEFAULT_REVIEW_TIMEOUT_MS = 25 * 60_000;

export type ReviewStats = {
  changedFiles: number;
  additions: number;
  deletions: number;
};

export type ReviewBudget = {
  tier: 'tiny' | 'small' | 'medium' | 'large';
  timeoutMs: number;
  maxToolCalls: number;
  allowSubagents: boolean;
  scope: string;
  stats: ReviewStats;
};

export function resolveReviewTimeoutMs(env: Record<string, string | undefined>, fallback = DEFAULT_REVIEW_TIMEOUT_MS) {
  const value = Number(env.REVIEW_TIMEOUT_MS ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function reviewStatsCommand(prNumber: number, repo: string) {
  return `gh pr view ${prNumber} --repo ${shellQuote(repo)} --json additions,deletions,changedFiles`;
}

export function parseReviewStats(stdout: string): ReviewStats {
  const parsed = JSON.parse(stdout) as Partial<ReviewStats>;
  return {
    changedFiles: Number(parsed.changedFiles) || 0,
    additions: Number(parsed.additions) || 0,
    deletions: Number(parsed.deletions) || 0,
  };
}

export function resolveReviewBudget(stats: ReviewStats, env: Record<string, string | undefined>): ReviewBudget {
  const lines = stats.additions + stats.deletions;
  const base =
    stats.changedFiles <= 3 && lines <= 100
      ? {
          tier: 'tiny' as const,
          timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
          maxToolCalls: 6,
          allowSubagents: false,
          scope: 'Review the diff directly. Do not delegate. Return as soon as concrete findings are clear.',
        }
      : stats.changedFiles <= 10 && lines <= 400
        ? {
            tier: 'small' as const,
            timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
            maxToolCalls: 10,
            allowSubagents: false,
            scope: 'Review the whole diff, with brief repo-context lookups only when needed. Do not delegate.',
          }
        : stats.changedFiles <= 25 && lines <= 1_000
          ? {
              tier: 'medium' as const,
              timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
              maxToolCalls: 16,
              allowSubagents: true,
              scope: 'Review high-risk files first, then the rest of the diff if budget remains. Delegate at most once for clear security or correctness risk.',
            }
          : {
              tier: 'large' as const,
              timeoutMs: DEFAULT_REVIEW_TIMEOUT_MS,
              maxToolCalls: 20,
              allowSubagents: true,
              scope: 'Run a scoped review: prioritize auth, data access, migrations, concurrency, public APIs, and untrusted input. Do not attempt exhaustive coverage.',
            };

  return { ...base, timeoutMs: resolveReviewTimeoutMs(env, base.timeoutMs), stats };
}

export function timeoutReviewResult(timeoutMs: number) {
  return {
    verdict: 'comment' as const,
    summary: `Automated review timed out after ${Math.round(timeoutMs / 1000)}s. No reliable findings were produced.`,
    findings: [],
  };
}
