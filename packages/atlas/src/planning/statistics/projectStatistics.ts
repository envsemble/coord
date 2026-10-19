// A project's statistics over a period (or several projects' together, for all plans), to look back
// on the work: agent time and the time at least one agent worked, by day or week and by model and
// reasoning effort; the plans completed and how long they took from acceptance; and the time work
// waited for the person.
// Time goes where it was worked, by the reports' working intervals; a report without intervals
// counts at its report time. Days and weeks begin at midnight in this computer's local time (a week
// on Monday). One pass over the projects' reports, kept until they change.
import type { HomeDatabase } from '../home/database.ts';
import { projectSummary, type ProjectWork } from '../projects/projectSummary.ts';
import { workDates, workTimeline } from './sessions.ts';
import { mergeSpans, sessionGap, storedReports, type StatisticsReport } from './statistics.ts';

export interface PeriodFigures { agentMs: number; activeMs: number; plansCompleted: number; medianImplementingMs: number | null; waitedMs: number }
/** A project the statistics cover: its row and its planning folder. */
export interface StatisticsSource { projectId: number; root: string }
export interface StatisticsBucket { start: string; agents: { model: string | null; effort: string | null; agentMs: number }[]; activeMs: number; completed: { id: string; title: string }[] }
export interface ProjectStatisticsEntry {
  from: string | null; to: string; unit: 'day' | 'week';
  current: PeriodFigures; previous: PeriodFigures | null;
  buckets: StatisticsBucket[];
  models: { model: string | null; effort: string | null; agentMs: number; tokens: number | null }[];
}

/** Agent time worked in a stretch, by model and effort; `merge` says whether it joins the union (it has intervals). */
interface Piece { workId: string; start: number; end: number; agentMs: number; model: string | null; effort: string | null; merge: boolean }
interface Spend { workId: string; at: number; model: string | null; effort: string | null; tokens: number }

/** A model and effort's share of an agent's time in a report: its efforts where its log named them, else its models'. */
function shares(report: StatisticsReport, agent: string | null): { model: string | null; effort: string | null; part: number }[] {
  const measured = report.measured;
  const levels = (measured?.efforts ?? []).filter(level => level.agent === agent);
  const total = levels.reduce((sum, level) => sum + level.agentMs, 0);
  if (total > 0) return levels.map(level => ({ model: level.model, effort: level.effort, part: level.agentMs / total }));
  if (agent === null) {
    const models = (measured?.models ?? []).filter(item => item.agentMs > 0);
    const sum = models.reduce((all, item) => all + item.agentMs, 0);
    if (sum > 0 && !(measured?.subagents?.agents.length)) return models.map(item => ({ model: item.model, effort: null, part: item.agentMs / sum }));
  }
  const helper = measured?.subagents?.agents.find(item => item.id === agent);
  return [{ model: agent === null ? report.model : helper?.model ?? null, effort: null, part: 1 }];
}

/** Every report's time as pieces where it was worked, and its tokens at its report time, as summarizeReports counts them. */
function piecesOf(reports: Map<string, StatisticsReport[]>) {
  const pieces: Piece[] = [], spends: Spend[] = [];
  for (const [workId, list] of reports) {
    const last = new Map<string, number>();
    for (const report of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
      const time = Date.parse(report.at), key = report.session ?? 'model:' + report.model;
      const previous = last.get(key) ?? null;
      last.set(key, time);
      const measured = report.measured;
      if (measured) {
        const since = Date.parse(measured.since);
        const from = previous !== null && previous > since ? previous : since;
        const share = previous === null || since >= previous ? 1 : time > since ? Math.max(0, time - previous) / (time - since) : 0;
        if (measured.intervals) {
          for (const interval of measured.intervals) {
            const start = Math.max(Date.parse(interval.start), from), end = Math.min(Date.parse(interval.end), time);
            if (end <= start) continue;
            for (const level of shares(report, interval.agent)) pieces.push({ workId, start, end, agentMs: (end - start) * level.part, model: level.model, effort: level.effort, merge: true });
          }
        } else {
          for (const level of shares(report, null)) pieces.push({ workId, start: time, end: time, agentMs: measured.agentMs * share * level.part, model: level.model, effort: level.effort, merge: false });
        }
        const levels = measured.efforts ?? [];
        if (levels.length) for (const level of levels) spends.push({ workId, at: time, model: level.model, effort: level.effort, tokens: level.tokens * share });
        else for (const item of measured.models) spends.push({ workId, at: time, model: item.model, effort: null, tokens: (item.input + item.cacheRead + item.cacheWrite + item.output) * share });
      } else if (previous !== null && time - previous <= sessionGap) {
        pieces.push({ workId, start: time, end: time, agentMs: time - previous, model: report.model, effort: null, merge: false });
      }
    }
  }
  return { pieces, spends };
}

/** Midnight of the day (or the week's Monday) that holds `time`, in local time. */
function bucketStart(time: number, unit: 'day' | 'week') {
  const date = new Date(time);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === 'week') day.setDate(day.getDate() - (day.getDay() + 6) % 7);
  return day.getTime();
}
function nextBucket(start: number, unit: 'day' | 'week') {
  const date = new Date(start);
  date.setDate(date.getDate() + (unit === 'week' ? 7 : 1));
  return date.getTime();
}
/** Local midnight of a plan's date (YYYY-MM-DD). */
const localDay = (day: string | null) => day && /^\d{4}-\d{2}-\d{2}/.test(day) ? new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime() : null;
/** The agent time of a piece that falls in [from, to): a stretch's part, or all of it at its moment. */
const within = (piece: Piece, from: number, to: number) => piece.end > piece.start
  ? piece.agentMs * Math.max(0, Math.min(piece.end, to) - Math.max(piece.start, from)) / (piece.end - piece.start)
  : piece.start >= from && piece.start < to ? piece.agentMs : 0;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const cache = new Map<string, Promise<ProjectStatisticsEntry>>();

/**
 * The statistics of a project, or of several together (all plans), for [from, to) (from null: since
 * the first report or plan; to null: now), by day or week, with the period before it as long; kept
 * until the reports or waits change, or for a minute when the period ends now.
 */
export function projectStatistics(database: HomeDatabase, sources: StatisticsSource[], period: { from: string | null; to: string | null; unit: 'day' | 'week' }, now = Date.now()): Promise<ProjectStatisticsEntry> {
  const ids = sources.map(source => source.projectId);
  const waits = database.db.prepare(`SELECT count(*) AS n, ifnull(max(id), 0) AS last, ifnull(max(ended_at), '') AS ended FROM session_wait WHERE project_id IN (${ids.map(() => '?').join(', ') || 'NULL'})`).get(...ids) as { n: number; last: number; ended: string };
  const key = [ids.join(','), period.from, period.to ?? Math.floor(now / 60_000), period.unit, database.reportsMark(), waits.n, waits.last, waits.ended].join('|');
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  const value = compute(database, sources, period, now);
  cache.set(key, value);
  value.catch(() => cache.delete(key));
  return value;
}

/** A work item of one of the projects, by a key unique among them all. */
interface Item extends ProjectWork { key: string; source: StatisticsSource }

async function compute(database: HomeDatabase, sources: StatisticsSource[], period: { from: string | null; to: string | null; unit: 'day' | 'week' }, now: number): Promise<ProjectStatisticsEntry> {
  const reports = new Map<string, StatisticsReport[]>();
  const work: Item[] = [];
  for (const source of sources) {
    const own = storedReports(database, source.projectId);
    const summary = await projectSummary(source.root, { reports: own });
    for (const [workId, list] of own) reports.set(source.projectId + '\0' + workId, list);
    for (const item of [...summary.active, ...summary.closed]) work.push({ ...item, key: source.projectId + '\0' + item.id, source });
  }
  const { pieces, spends } = piecesOf(reports);
  const to = period.to ? Date.parse(period.to) : now;
  const firstPlan = Math.min(...work.map(item => localDay(item.completed) ?? Infinity));
  const first = Math.min(...pieces.map(piece => piece.start), ...spends.map(spend => spend.at), firstPlan);
  const from = period.from ? Date.parse(period.from) : Number.isFinite(first) ? first : to;
  // Each plan's timeline, for its waits.
  const dates = new Map(await Promise.all(work.map(async item => [item.key, await workDates(item.source.root, item.id)] as const)));
  const timelines = new Map(work.map(item => [item.key, workTimeline(database, item.source.projectId, item.id, dates.get(item.key)!, now, reports.get(item.key) ?? [])]));
  const clipped = (spans: [number, number][], start: number, end: number) => spans.reduce((total, [a, b]) => total + Math.max(0, Math.min(b, end) - Math.max(a, start)), 0);
  const allWaits = mergeSpans([...timelines.values()].flatMap(timeline => timeline.lanes.flatMap(lane => lane.waiting.map(([start, end]): [number, number] => [Date.parse(start), Date.parse(end)]))));
  const completedIn = (start: number, end: number) => work.filter(item => { const day = localDay(item.completed); return day !== null && day >= start && day < end; });
  const figures = (start: number, end: number): PeriodFigures => {
    const inside = pieces.filter(piece => within(piece, start, end) > 0);
    const union = mergeSpans(inside.filter(piece => piece.merge).map((piece): [number, number] => [Math.max(piece.start, start), Math.min(piece.end, end)]));
    const completed = completedIn(start, end);
    return {
      agentMs: Math.round(inside.reduce((total, piece) => total + within(piece, start, end), 0)),
      activeMs: Math.round(union.reduce((total, [a, b]) => total + b - a, 0) + inside.filter(piece => !piece.merge).reduce((total, piece) => total + piece.agentMs, 0)),
      plansCompleted: completed.length,
      medianImplementingMs: median(completed.flatMap(item => { const accepted = localDay(dates.get(item.key)?.accepted ?? null), done = localDay(item.completed); return accepted !== null && done !== null ? [done - accepted] : []; })),
      waitedMs: clipped(allWaits, start, end),
    };
  };
  // The buckets, from the one holding the period's start; at most a thousand.
  const buckets: StatisticsBucket[] = [];
  for (let start = bucketStart(from, period.unit); start < to && buckets.length < 1000; start = nextBucket(start, period.unit)) {
    const end = Math.min(nextBucket(start, period.unit), to), begin = Math.max(start, from);
    const byLevel = new Map<string, { model: string | null; effort: string | null; agentMs: number }>();
    for (const piece of pieces) {
      const agentMs = within(piece, begin, end);
      if (agentMs <= 0) continue;
      const levelKey = (piece.model ?? '') + '\0' + (piece.effort ?? '');
      const entry = byLevel.get(levelKey) ?? { model: piece.model, effort: piece.effort, agentMs: 0 };
      entry.agentMs += agentMs;
      byLevel.set(levelKey, entry);
    }
    const figure = figures(begin, end);
    buckets.push({
      start: new Date(start).toISOString(),
      agents: [...byLevel.values()].map(entry => ({ ...entry, agentMs: Math.round(entry.agentMs) })).filter(entry => entry.agentMs > 0).sort((a, b) => b.agentMs - a.agentMs),
      activeMs: figure.activeMs,
      completed: completedIn(begin, end).map(item => ({ id: item.id, title: item.title })),
    });
  }
  // Agent time and tokens by model and effort in the period.
  const levels = new Map<string, { model: string | null; effort: string | null; agentMs: number; tokens: number | null }>();
  const level = (model: string | null, effort: string | null) => {
    const levelKey = (model ?? '') + '\0' + (effort ?? '');
    let entry = levels.get(levelKey);
    if (!entry) levels.set(levelKey, entry = { model, effort, agentMs: 0, tokens: null });
    return entry;
  };
  for (const piece of pieces) { const agentMs = within(piece, from, to); if (agentMs > 0) level(piece.model, piece.effort).agentMs += agentMs; }
  for (const spend of spends) if (spend.at >= from && spend.at < to) { const entry = level(spend.model, spend.effort); entry.tokens = (entry.tokens ?? 0) + spend.tokens; }
  const length = to - from;
  return {
    from: period.from ? new Date(from).toISOString() : null, to: new Date(to).toISOString(), unit: period.unit,
    current: figures(from, to), previous: period.from ? figures(from - length, from) : null,
    buckets,
    models: [...levels.values()].map(entry => ({ ...entry, agentMs: Math.round(entry.agentMs), tokens: entry.tokens === null ? null : Math.round(entry.tokens) }))
      .filter(entry => entry.agentMs > 0 || (entry.tokens ?? 0) > 0).sort((a, b) => b.agentMs - a.agentMs || (b.tokens ?? 0) - (a.tokens ?? 0)),
  };
}
