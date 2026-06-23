import type { FlueSession } from '@flue/runtime';

export const ISSUE_HEALTH_MARKER = '<!-- flipt-issue-health-agent -->';
export const ISSUE_HEALTH_SUPPORT_FOOTER =
  '_Need help with Flipt? Support the project through [GitHub Sponsors](https://github.com/sponsors/flipt-io) or learn about [Flipt Pro](https://docs.flipt.io/v2/pro)._';

export const ISSUE_HEALTH_ISSUE_TYPES = ['bug', 'feature', 'docs', 'question', 'other'] as const;
export const ISSUE_HEALTH_VERDICTS = ['well_scoped', 'mostly_actionable', 'needs_info', 'not_actionable'] as const;
export const ISSUE_HEALTH_COMMENT_MODES = ['always', 'needs-improvement', 'off'] as const;
export const ISSUE_HEALTH_LABEL_MODES = ['existing-only', 'off'] as const;
export const ISSUE_HEALTH_RESULT_FIELDS = [
  'issueType',
  'verdict',
  'score',
  'summary',
  'missingInfo',
  'suggestedLabels',
  'redactionWarning',
] as const;

export type IssueType = (typeof ISSUE_HEALTH_ISSUE_TYPES)[number];
export type IssueHealthVerdict = (typeof ISSUE_HEALTH_VERDICTS)[number];
export type IssueHealthCommentMode = (typeof ISSUE_HEALTH_COMMENT_MODES)[number];
export type IssueHealthLabelMode = (typeof ISSUE_HEALTH_LABEL_MODES)[number];

export type IssueHealthResult = {
  issueType: IssueType;
  verdict: IssueHealthVerdict;
  score: number;
  summary: string;
  missingInfo: string[];
  suggestedLabels: string[];
  redactionWarning: string | null;
};

export type RenderIssueHealthOptions = {
  showScore?: boolean;
};

export type ApplyIssueHealthLabelsOptions = {
  labelMode?: IssueHealthLabelMode;
};

export type ApplyIssueHealthLabelsResult = {
  labels: string[];
  applied: boolean;
};

export type IssueHealthConfig = {
  commentMode: IssueHealthCommentMode;
  labelMode: IssueHealthLabelMode;
};

const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  bug: 'Bug report',
  feature: 'Feature request',
  docs: 'Documentation issue',
  question: 'Question',
  other: 'Issue',
};

const VERDICT_LABEL: Record<IssueHealthVerdict, string> = {
  well_scoped: 'Well scoped',
  mostly_actionable: 'Mostly actionable',
  needs_info: 'Needs more information',
  not_actionable: 'Not actionable yet',
};

function parseMode<T extends string>(value: string | undefined, allowedModes: readonly T[], defaultMode: T): T {
  if (!value) return defaultMode;
  if (allowedModes.includes(value as T)) return value as T;
  throw new Error(`Invalid issue-health mode: ${value}`);
}

export function parseIssueHealthCommentMode(value: string | undefined): IssueHealthCommentMode {
  return parseMode(value, ISSUE_HEALTH_COMMENT_MODES, 'always');
}

export function parseIssueHealthLabelMode(value: string | undefined): IssueHealthLabelMode {
  return parseMode(value, ISSUE_HEALTH_LABEL_MODES, 'existing-only');
}

export function resolveIssueHealthConfig(env: Record<string, string | undefined>): IssueHealthConfig {
  return {
    commentMode: parseIssueHealthCommentMode(env.ISSUE_HEALTH_COMMENT_MODE),
    labelMode: parseIssueHealthLabelMode(env.ISSUE_HEALTH_LABEL_MODE),
  };
}

export function shouldPostIssueHealthComment(mode: IssueHealthCommentMode, result: Pick<IssueHealthResult, 'verdict'>): boolean {
  if (mode === 'off') return false;
  if (mode === 'needs-improvement') return result.verdict === 'needs_info' || result.verdict === 'not_actionable';
  return true;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[_-]+/g, ' ').replaceAll(/\s+/g, ' ');
}

function addExistingLabel(
  labels: string[],
  existingByExactName: Map<string, string>,
  existingByNormalizedName: Map<string, string>,
  candidate: string,
): void {
  const exact = existingByExactName.get(candidate);
  const existing = exact ?? existingByNormalizedName.get(normalizeLabel(candidate));
  if (existing && !labels.includes(existing)) labels.push(existing);
}

export function renderIssueHealthComment(result: IssueHealthResult, options: RenderIssueHealthOptions = {}): string {
  const lines = [
    ISSUE_HEALTH_MARKER,
    '',
    `**Issue Health Check: ${VERDICT_LABEL[result.verdict]}**`,
    '',
    `Type: ${ISSUE_TYPE_LABEL[result.issueType]}`,
  ];

  if (options.showScore) lines.push(`Internal score: ${Math.trunc(result.score)}/100`);

  const summary = result.summary.trim();
  if (summary) lines.push('', summary);

  if (result.redactionWarning) {
    lines.push('', `> ⚠️ ${result.redactionWarning.trim()}`);
  }

  if (result.verdict === 'well_scoped' || result.verdict === 'mostly_actionable') {
    lines.push(
      '',
      result.verdict === 'well_scoped'
        ? 'Thanks — this issue looks well scoped and ready for the maintainers to evaluate.'
        : 'Thanks — this issue is mostly actionable. A maintainer may still ask for a little more detail while reviewing it.',
    );
  } else {
    const missingInfo = result.missingInfo.map((item) => item.trim()).filter(Boolean);
    lines.push('', 'To help the maintainers act on this, please add:');
    if (missingInfo.length > 0) {
      lines.push(...missingInfo.map((item) => `- [ ] ${item}`));
    } else {
      lines.push('- [ ] Enough detail for a maintainer to reproduce, evaluate, or answer the issue.');
    }
  }

  lines.push('', ISSUE_HEALTH_SUPPORT_FOOTER);
  return lines.join('\n');
}

export function filterIssueHealthLabels(
  result: IssueHealthResult,
  existingLabels: string[],
  labelMode: IssueHealthLabelMode = 'existing-only',
): string[] {
  if (labelMode === 'off') return [];

  const labels: string[] = [];
  const existingByExactName = new Map(existingLabels.map((label) => [label, label]));
  const existingByNormalizedName = new Map(existingLabels.map((label) => [normalizeLabel(label), label]));

  for (const suggestion of result.suggestedLabels) {
    addExistingLabel(labels, existingByExactName, existingByNormalizedName, suggestion);
  }

  return labels;
}

type IssueHealthShell = Pick<FlueSession, 'shell'>;
type IssueHealthShellFs = Pick<FlueSession, 'shell' | 'fs'>;

export async function fetchExistingIssueLabels(session: IssueHealthShell, repo: string): Promise<string[]> {
  const { exitCode, stdout } = await session.shell(
    `gh label list --repo ${shellQuote(repo)} --limit 1000 --json name --jq ${shellQuote('.[].name')}`,
  );
  if (exitCode !== 0) return [];

  return stdout
    .split('\n')
    .map((label) => label.trim())
    .filter(Boolean);
}

export async function postIssueHealthComment(
  session: IssueHealthShellFs,
  issueNumber: number,
  repo: string,
  body: string,
): Promise<boolean> {
  const bodyPath = '/tmp/flue-issue-health-comment.md';
  await session.fs.writeFile(bodyPath, body);

  const { exitCode } = await session.shell(
    `gh issue comment ${issueNumber} --repo ${shellQuote(repo)} --body-file ${shellQuote(bodyPath)}`,
  );
  return exitCode === 0;
}

export async function applyIssueHealthLabels(
  session: IssueHealthShell,
  issueNumber: number,
  repo: string,
  result: IssueHealthResult,
  existingLabels: string[],
  options: ApplyIssueHealthLabelsOptions = {},
): Promise<ApplyIssueHealthLabelsResult> {
  const labels = filterIssueHealthLabels(result, existingLabels, options.labelMode ?? 'existing-only');
  if (labels.length === 0) return { labels, applied: true };

  const labelArgs = labels.map((label) => `--add-label ${shellQuote(label)}`).join(' ');
  const { exitCode } = await session.shell(`gh issue edit ${issueNumber} --repo ${shellQuote(repo)} ${labelArgs}`);
  return { labels, applied: exitCode === 0 };
}
