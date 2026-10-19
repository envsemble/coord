// What a plan's statistics say of its agent time and models: how agent time was counted (measured,
// estimated or both), the other models beside the primary one and what each did, and time and tokens
// by model and reasoning effort. Pure, so it is unit-tested.
import type { ModelUsage, WorkStatistics } from '../types';
import { absoluteDate, compactNumber, duration } from '../ui/format';

type Timed = Pick<WorkStatistics, 'reports' | 'agentMs' | 'measuredMs' | 'estimatedMs' | 'measuredReports' | 'firstReport'>;
/** How agent time was counted: measured from session logs, estimated from report times, or both. */
export function timeSource(statistics: Timed): 'measured' | 'estimated' | 'mixed' | null {
  if (!statistics.reports) return null;
  return !statistics.measuredReports ? 'estimated' : statistics.estimatedMs > 0 ? 'mixed' : 'measured';
}
/** What agent time stands for, and since when it is counted. */
export function agentTimeNote(statistics: Timed): string {
  const since = statistics.firstReport ? ' since ' + absoluteDate(statistics.firstReport) : '';
  switch (timeSource(statistics)) {
    case 'measured': return 'Measured from the agent\'s session logs' + since + ': the time it worked, not the time it waited for a person.';
    case 'mixed': return duration(statistics.measuredMs) + ' measured from the agent\'s session logs and ' + duration(statistics.estimatedMs) + ' estimated from the time between its reports,' + since + '.';
    case 'estimated': return 'Estimated from the time between the agent\'s reports' + since + '; breaks of more than two hours are left out.';
    default: return 'No agent reports yet.';
  }
}

/** The models besides the primary one that did something, most agent time first. */
export function otherModels(statistics: Pick<WorkStatistics, 'models' | 'primaryModel'>): ModelUsage[] {
  return statistics.models.filter(model => model.model !== statistics.primaryModel && (model.agentMs > 0 || (model.tokens ?? 0) > 0 || model.reports > 0));
}
/** What one model did: "20 min, 1.3K tokens". */
export function modelShare(model: ModelUsage) {
  return [model.agentMs ? duration(model.agentMs) : null, model.tokens !== null ? compactNumber(model.tokens) + ' tokens' : null].filter(Boolean).join(', ');
}

/** A model's time and tokens at one reasoning effort; `effort` null for what no log recorded an effort for. */
export interface EffortRow { model: string; effort: string | null; agentMs: number; tokens: number | null }
/**
 * Time and tokens by model and reasoning effort: each effort a model's logs recorded, then the rest
 * of its time and tokens without one, so a model's rows add up to its totals.
 */
export function effortRows(models: ModelUsage[]): EffortRow[] {
  return models.flatMap(model => {
    const efforts = model.efforts.map(effort => ({ model: model.model, effort: effort.effort, agentMs: effort.agentMs, tokens: effort.tokens }));
    const agentMs = Math.max(0, model.agentMs - efforts.reduce((sum, row) => sum + row.agentMs, 0));
    const tokens = model.tokens === null ? null : Math.max(0, model.tokens - efforts.reduce((sum, row) => sum + (row.tokens ?? 0), 0));
    // What rounding leaves over (under a second and a hundredth of its tokens) is no row of its own.
    const rounding = agentMs < 1000 && (tokens ?? 0) <= (model.tokens ?? 0) / 100;
    const rest = !efforts.length || !rounding ? [{ model: model.model, effort: null, agentMs, tokens }] : [];
    return [...efforts, ...rest];
  });
}
