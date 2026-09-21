import assert from 'node:assert/strict';
import test from 'node:test';
import { requireModel } from '../lib/model.ts';

test('requireModel returns a provider-qualified model unchanged', () => {
  assert.equal(
    requireModel('cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6', 'REVIEW_MODEL'),
    'cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6',
  );
  assert.equal(requireModel('  anthropic/claude-sonnet-4-6  ', 'REVIEW_MODEL'), 'anthropic/claude-sonnet-4-6');
});

test('requireModel rejects a missing model, naming the env var', () => {
  for (const value of [undefined, '', '   ']) {
    assert.throws(() => requireModel(value, 'ISSUE_HEALTH_MODEL'), /ISSUE_HEALTH_MODEL is required/);
  }
});

test('requireModel rejects a model that names no provider', () => {
  for (const value of ['gpt-4.1', '/claude-sonnet-4-6', 'anthropic/']) {
    assert.throws(() => requireModel(value, 'REVIEW_MODEL'), /provider-qualified/);
  }
});
