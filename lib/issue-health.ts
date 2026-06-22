import type { FlueSession } from '@flue/runtime';

export const ISSUE_HEALTH_MARKER = '<!-- flipt-issue-health-agent -->';
export const ISSUE_HEALTH_SUPPORT_FOOTER =
  '_Need help with Flipt? Support the project through [GitHub Sponsors](https://github.com/sponsors/flipt-io) or learn about [Flipt Pro](https://docs.flipt.io/v2/pro)._';

export type IssueType = 'bug' | 'feature' | 'docs' | 'question' | 'other';
export type IssueHealthVerdict = 'well_scoped' | 'mostly_actionable' | 'needs_info' | 'not_actionable';
export type IssueHealthCommentMode = 'always' | 'needs-improvement' | 'off';
export type IssueHealthLabelMode = 'existing-only' | 'off';

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

const ISSUE_TYPE_LABEL_CANDIDATES: Record<IssueType, string[]> = {
  bug: ['bug'],
  feature: ['enhancement', 'feature'],
  docs: ['documentation', 'docs'],
  question: ['question'],
  other: ['needs-triage'],
};

const SEMANTIC_LABEL_CANDIDATES: Record<string, string[]> = {
  bug: ['bug'],
  defect: ['bug'],
  error: ['bug'],
  feature: ['enhancement', 'feature'],
  enhancement: ['enhancement', 'feature'],
  request: ['enhancement', 'feature'],
  docs: ['documentation', 'docs'],
  documentation: ['documentation', 'docs'],
  doc: ['documentation', 'docs'],
  question: ['question'],
  support: ['question'],
  help: ['question'],
  'needs info': ['needs-info', 'needs info', 'more information needed'],
  'needs information': ['needs-info', 'needs info', 'more information needed'],
  'missing info': ['needs-info', 'needs info', 'more information needed'],
  incomplete: ['needs-info', 'needs info', 'more information needed'],
  'not actionable': ['needs-info', 'needs-triage', 'needs info'],
  triage: ['needs-triage', 'triage'],
  'needs triage': ['needs-triage', 'triage'],
  security: ['security'],
  secret: ['security'],
  privacy: ['security'],
};

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

function addFirstExistingLabel(
  labels: string[],
  existingByExactName: Map<string, string>,
  existingByNormalizedName: Map<string, string>,
  candidates: string[],
): void {
  for (const candidate of candidates) {
    const before = labels.length;
    addExistingLabel(labels, existingByExactName, existingByNormalizedName, candidate);
    if (labels.length > before) return;
  }
}

function semanticCandidatesForSuggestion(suggestion: string): string[] {
  const normalized = normalizeLabel(suggestion);
  const direct = SEMANTIC_LABEL_CANDIDATES[normalized];
  if (direct) return direct;

  return Object.entries(SEMANTIC_LABEL_CANDIDATES)
    .filter(([term]) => normalized.includes(term))
    .flatMap(([, candidates]) => candidates);
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
    addFirstExistingLabel(labels, existingByExactName, existingByNormalizedName, semanticCandidatesForSuggestion(suggestion));
  }

  addFirstExistingLabel(labels, existingByExactName, existingByNormalizedName, ISSUE_TYPE_LABEL_CANDIDATES[result.issueType]);
  if (result.verdict === 'needs_info' || result.verdict === 'not_actionable') {
    addFirstExistingLabel(labels, existingByExactName, existingByNormalizedName, ['needs-info', 'needs info']);
  }
  addFirstExistingLabel(labels, existingByExactName, existingByNormalizedName, ['needs-triage', 'triage']);

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
