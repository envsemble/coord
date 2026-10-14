import test from 'node:test';
import assert from 'node:assert/strict';
import { aiModel } from './aiModels.ts';

const named = (id: string) => [aiModel(id).name, aiModel(id).provider];

test('Claude models read as their names, new and old identifiers alike', () => {
  for (const [id, name] of [
    ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-haiku-5-5', 'Claude Haiku 5.5'], ['claude-fable-5-1', 'Claude Fable 5.1'],
    ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'], ['claude-opus-4-1', 'Claude Opus 4.1'], ['claude-opus-4-0', 'Claude Opus 4'],
    ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet'], ['claude-3-opus-20240229', 'Claude 3 Opus'], ['claude-3-7-sonnet-latest', 'Claude 3.7 Sonnet'],
    ['claude-2.1', 'Claude 2.1'], ['claude-instant-1.2', 'Claude Instant 1.2'],
    ['claude-opus-5-5[1m]', 'Claude Opus 5.5 (1M context)'], ['opus[1m]', 'Claude Opus (1M context)'], ['sonnet', 'Claude Sonnet'],
    ['anthropic/claude-opus-4.5', 'Claude Opus 4.5'], ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5'], ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'Claude 3.5 Sonnet'],
    ['claude-sonnet-4-5@20250929', 'Claude Sonnet 4.5'], ['Claude-Opus-5-5', 'Claude Opus 5.5'],
  ]) assert.deepEqual(named(id), [name, 'anthropic'], id);
});

test('OpenAI models: GPT names, the o-series and gpt-oss as OpenAI spells them', () => {
  for (const [id, name] of [
    ['gpt-6.1-sol', 'GPT-6.1 Sol'], ['gpt-5-codex', 'GPT-5 Codex'], ['gpt-5.1-codex-max', 'GPT-5.1 Codex Max'], ['gpt-5', 'GPT-5'],
    ['gpt-4o', 'GPT-4o'], ['gpt-4o-mini', 'GPT-4o mini'], ['gpt-4.1-nano', 'GPT-4.1 nano'], ['gpt-4o-2024-08-06', 'GPT-4o'], ['gpt-4-0613', 'GPT-4'], ['gpt-3.5-turbo', 'GPT-3.5 Turbo'],
    ['o3', 'o3'], ['o4-mini', 'o4-mini'], ['o3-2025-04-16', 'o3'], ['o3-pro', 'o3-pro'],
    ['gpt-oss-120b', 'gpt-oss-120b'], ['codex-mini-latest', 'Codex Mini'], ['chatgpt-4o-latest', 'ChatGPT-4o'], ['openai/gpt-5', 'GPT-5'],
  ]) assert.deepEqual(named(id), [name, 'openai'], id);
});

test('Gemini, Mistral and DeepSeek models', () => {
  for (const [id, name, provider] of [
    ['gemini-2.5-pro', 'Gemini 2.5 Pro', 'google'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'google'], ['gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'google'],
    ['gemini-1.5-pro-002', 'Gemini 1.5 Pro', 'google'], ['models/gemini-2.0-flash', 'Gemini 2.0 Flash', 'google'],
    ['mistral-large-latest', 'Mistral Large', 'mistral'], ['mistral-large-2411', 'Mistral Large', 'mistral'], ['codestral-latest', 'Codestral', 'mistral'], ['devstral-small-2505', 'Devstral Small', 'mistral'], ['ministral-8b-latest', 'Ministral 8B', 'mistral'],
    ['deepseek-chat', 'DeepSeek Chat', 'deepseek'], ['deepseek-v3.1', 'DeepSeek V3.1', 'deepseek'], ['deepseek-v3', 'DeepSeek V3', 'deepseek'], ['deepseek-r1', 'DeepSeek R1', 'deepseek'],
  ]) assert.deepEqual(named(id), [name, provider], id);
});

test('an unknown model keeps its identifier and has no provider', () => {
  for (const id of ['model-alpha-2', 'llama-3.1-70b', 'opusplan', 'my model', 'claudette-1']) assert.deepEqual(aiModel(id), { id, name: id, provider: null }, id);
  assert.equal(aiModel('  model-x  ').name, 'model-x');
  assert.equal(aiModel('model-x[beta]').name, 'model-x[beta]', 'an unknown model keeps its variant as written');
});
