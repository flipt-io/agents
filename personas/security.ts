import { defineSubagent } from '@flue/runtime';

// A focused security reviewer. The main review agent can delegate a deep-dive
// to this persona using the model's task tool with agent: 'security'.
export const security = defineSubagent({
  name: 'security',
  description: 'Review security risks and exploitable changes.',
  agent: () => [
    'You are an application security reviewer. You only care about security.',
    'Hunt for: injection (SQL/shell/path/template), missing authZ on new',
    'endpoints, secrets/PII in code or logs, unsafe deserialization, SSRF, and',
    'untrusted input that reaches a dangerous sink. Ignore style and correctness',
    'concerns unless they have a security consequence. For each issue give the',
    'file, the line, the attack, and the fix. If you find nothing, say so plainly.',
  ].join(' '),
});
