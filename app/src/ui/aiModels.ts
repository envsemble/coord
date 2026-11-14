// AI model identifiers as people say them: `claude-opus-5-5` is "Claude Opus 5.5" by Anthropic,
// `gpt-6.1-sol` is "GPT-6.1 Sol" by OpenAI. Agents and session logs name models by their API
// identifiers, sometimes with a routing prefix (`anthropic/…`, `us.anthropic.…`), a snapshot date
// or a variant in brackets (`[1m]`). An identifier Coord does not recognise stays as it is.

export type Provider = 'anthropic' | 'openai' | 'google' | 'mistral' | 'deepseek';
export const providerNames: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', mistral: 'Mistral AI', deepseek: 'DeepSeek' };

export interface AiModel {
  /** The identifier as reported. */
  id: string;
  /** Its name, with the variant: "Claude Opus 5.5 (1M context)". */
  name: string;
  provider: Provider | null;
}

/** Words that keep their own spelling; sizes and versions such as 8b and v3 are capitals. */
const spellings: Record<string, string> = { deepseek: 'DeepSeek' };
const word = (part: string) => spellings[part] ?? (/^\d+[a-z]$|^[a-z]\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1));

/** Name the parts after a family: consecutive small numbers form a version (`5-5` is 5.5). */
function spoken(parts: string[], options: { dropZero?: boolean } = {}) {
  const words: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (/^\d{1,2}$/.test(part)) {
      const numbers = [part];
      while (index + 1 < parts.length && /^\d{1,2}$/.test(parts[index + 1])) numbers.push(parts[++index]);
      if (options.dropZero && numbers.length === 2 && numbers[1] === '0') numbers.pop();
      words.push(numbers.join('.'));
    } else if (/^\d+(\.\d+)+$/.test(part)) words.push(part);
    else words.push(word(part));
  }
  return words;
}

/** Without routing prefixes, snapshot dates and revisions: what names the model itself. */
function core(id: string) {
  let value = id.toLowerCase();
  value = value.slice(value.lastIndexOf('/') + 1); // anthropic/claude-…, models/gemini-…
  // Bedrock: us.anthropic.claude-…-v1:0; a version suffix elsewhere (deepseek-v3) names the model.
  if (/^(?:[a-z]{2,6}\.)?anthropic\./.test(value) || /-v\d+:\d+$/.test(value)) value = value.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '');
  value = value.replace(/@\d{8}$/, ''); // Vertex: claude-…@20250929
  return value.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '');
}

/** A model's name with the reasoning effort it worked at, when its log recorded one: "Claude Opus 5.5 · high". */
export const withEffort = (name: string, effort: string | null | undefined) => effort ? name + ' · ' + effort : name;

/** What an identifier names: its provider and how people say it. */
export function aiModel(id: string): AiModel {
  const trimmed = id.trim();
  const bracket = /^(.*?)\[([^\]]+)\]$/.exec(trimmed);
  const base = bracket ? bracket[1] : trimmed;
  const window = bracket ? /^(\d+(?:\.\d+)?)([km])$/i.exec(bracket[2]) : null;
  const variant = bracket ? ' (' + (window ? window[1] + window[2].toUpperCase() + ' context' : bracket[2]) + ')' : '';
  const value = core(base);
  const parts = value.split('-').filter(Boolean);
  const named = (name: string, provider: Provider): AiModel => ({ id, name: name + variant, provider });

  if (/^claude(?:-|$)/.test(value)) return named(['Claude', ...spoken(parts.slice(1), { dropZero: true })].join(' '), 'anthropic');
  if (/^(?:opus|sonnet|haiku|fable)(?:-|$)/.test(value)) return named(['Claude', ...spoken(parts, { dropZero: true })].join(' '), 'anthropic');
  // GPT-6.1 Sol, GPT-4o mini; gpt-oss-120b and the o-series keep their own spelling.
  if (/^gpt-oss/.test(value)) return named(value, 'openai');
  if (/^gpt-[\d.]+[a-z]?(?:-|$)/.test(value)) {
    const [, version, ...rest] = parts.filter(part => !/^\d{4}$/.test(part));
    return named(['GPT-' + version, ...rest.map((part, index) => index === 0 && (part === 'mini' || part === 'nano') ? part : word(part))].join(' '), 'openai');
  }
  if (/^chatgpt-/.test(value)) return named('ChatGPT-' + parts.slice(1).join('-'), 'openai');
  if (/^o\d+(?:-|$)/.test(value)) return named(value.replace(/-\d{4}-\d{2}-\d{2}$/, ''), 'openai');
  if (/^codex(?:-|$)/.test(value)) return named(spoken(parts).join(' '), 'openai');
  if (/^gemini(?:-|$)/.test(value)) return named(['Gemini', ...spoken(parts.slice(1).filter(part => !/^\d{3}$/.test(part)))].join(' ').replace('Flash Lite', 'Flash-Lite'), 'google');
  if (/^(?:open-)?(?:mistral|mixtral|codestral|devstral|magistral|ministral|pixtral)(?:-|$)/.test(value)) return named(spoken(parts.filter(part => !/^\d{4}$/.test(part))).join(' '), 'mistral');
  if (/^deepseek(?:-|$)/.test(value)) return named(spoken(parts).join(' '), 'deepseek');
  return { id, name: trimmed, provider: null };
}
