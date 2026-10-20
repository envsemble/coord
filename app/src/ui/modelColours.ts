// How Atlas shows models at a reasoning effort in its charts, legends, tables and swatches, the same
// everywhere: each model its own hue (by its provider's family of hues first: Anthropic's warm,
// OpenAI's greens, Google's blues…), its efforts steps of lightness within that hue from low to high,
// and "Model not recorded" a neutral grey. Colours are OKLCH with a light and a dark value, each at
// least 3:1 against the chart's background in its theme. Pure, so it is unit-tested.
import { aiModel, type Provider } from './aiModels';

/** Reasoning efforts from least to most, as agents report them. */
export const effortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Where an effort is among the levels, 0 to 5; one not recorded, or not known, sits mid-way. */
export function effortStep(effort: string | null): number {
  const at = effort ? (effortLevels as readonly string[]).indexOf(effort.toLowerCase()) : -1;
  return at < 0 ? 2.5 : at;
}

/** Each provider's family of hues (OKLCH degrees), its first the most its own; models Atlas does not know share the last. */
const families: Record<Provider | 'other', number[]> = {
  anthropic: [42, 18, 68],
  openai: [158, 132, 184],
  google: [256, 236, 276],
  mistral: [342, 322],
  deepseek: [292, 306],
  other: [204, 100, 220],
};
const allHues = Object.values(families).flat();

/** A model's own hue, stable wherever it shows: a slot of its provider's family, by its name. */
function ownHue(model: string): number {
  const family = families[aiModel(model).provider ?? 'other'];
  let hash = 0;
  for (const character of aiModel(model).name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return family[hash % family.length];
}

/** A colour at an effort's step: darker in the light theme and lighter in the dark one as effort grows, so more effort stands out more. */
function shade(hue: number, chroma: number, step: number): string {
  const light = 0.66 - step * 0.05, dark = 0.6 + step * 0.055;
  return `light-dark(oklch(${light.toFixed(3)} ${chroma} ${hue}), oklch(${dark.toFixed(3)} ${chroma === 0 ? 0 : chroma - 0.01} ${hue}))`;
}

/** The grey of a model not recorded. */
export const unrecordedColour = shade(0, 0, 2.5);

/**
 * The colours of the models shown together: each model its own hue, another of its family (then any
 * other hue) where two would share one, and each effort its step of lightness. The same model takes
 * the same hue wherever it is alone in its hue.
 */
export function modelPalette(items: { model: string | null }[]): (model: string | null, effort: string | null) => string {
  const models = [...new Set(items.map(item => item.model).filter((model): model is string => Boolean(model)))].sort();
  const hues = new Map<string, number>();
  const taken = new Set<number>();
  for (const model of models) {
    const own = ownHue(model);
    const family = families[aiModel(model).provider ?? 'other'];
    const hue = [own, ...family, ...allHues].find(candidate => !taken.has(candidate)) ?? own;
    taken.add(hue);
    hues.set(model, hue);
  }
  return (model, effort) => model ? shade(hues.get(model) ?? ownHue(model), 0.13, effortStep(effort)) : unrecordedColour;
}

/**
 * Models at an effort in the order charts stack them and legends list them: models by their agent
 * time (the most first), a model's efforts together from low to high, a model not recorded last.
 */
export function orderModels<T extends { model: string | null; effort: string | null; agentMs: number }>(items: T[]): T[] {
  const totals = new Map<string | null, number>();
  for (const item of items) totals.set(item.model, (totals.get(item.model) ?? 0) + item.agentMs);
  const rank = (model: string | null) => model === null ? -1 : totals.get(model) ?? 0;
  return [...items].sort((a, b) => a.model === b.model ? effortStep(a.effort) - effortStep(b.effort)
    : (a.model === null ? 1 : b.model === null ? -1 : rank(b.model) - rank(a.model) || a.model.localeCompare(b.model)));
}

/** An effort as shown beside its model: "effort not recorded" where other rows of the same model have one. */
export function shownEffort(items: { model: string | null; effort: string | null }[], model: string | null, effort: string | null): string | null {
  return effort ?? (model && items.some(item => item.model === model && item.effort) ? 'effort not recorded' : null);
}
