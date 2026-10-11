// A time scatter: one dot per item at its date, coloured by series, with a legend, hairline
// grid, a hover and keyboard tooltip (the nearest dot within 24 px), and Enter to open the item.
// Hand-built SVG: the window's content security policy allows no chart library code from elsewhere.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface ChartSeries { key: string; label: string; color: string }
export interface ChartPoint { id: string; x: number; y: number; series: string; title: string; detail: string }

const height = 260;
const margin = { top: 16, right: 20, bottom: 30, left: 60 };
const day = 86400000;

export type ValueKind = 'number' | 'count' | 'duration';
const minute = 60000, hour = 60 * minute;
const durationSteps = [minute, 2 * minute, 5 * minute, 10 * minute, 15 * minute, 30 * minute, hour, 2 * hour, 3 * hour, 6 * hour, 12 * hour, 24 * hour, 2 * 24 * hour, 7 * 24 * hour];

/**
 * Ticks from zero to at least the maximum, at round steps: 1, 2, 2.5 or 5 × 10^n for numbers,
 * whole numbers for counts, and clock-sized steps (minutes, hours, days) for durations.
 */
export function valueTicks(maximum: number, kind: ValueKind = 'number', count = 4): number[] {
  if (!(maximum > 0)) return kind === 'duration' ? [0, hour] : [0, 1];
  const rough = maximum / count;
  let step: number;
  if (kind === 'duration') step = durationSteps.find(candidate => candidate >= rough) ?? Math.ceil(rough / (7 * 24 * hour)) * 7 * 24 * hour;
  else {
    const power = 10 ** Math.floor(Math.log10(rough));
    step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough)!;
    if (kind === 'count') step = Math.max(1, Math.ceil(step));
  }
  const ticks: number[] = [];
  for (let value = 0; value < maximum + step / 2 && ticks.length <= count + 1; value += step) ticks.push(Number(value.toPrecision(12)));
  if (ticks.at(-1)! < maximum) ticks.push(Number((ticks.at(-1)! + step).toPrecision(12)));
  return ticks;
}

/** Date ticks at whole days, weeks or months: the finest step that keeps at most `most` labels. */
export function timeTicks(start: number, end: number, most = 6): number[] {
  const first = new Date(start);
  const days = (every: number) => {
    const ticks: number[] = [];
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1);
    while (cursor.getTime() <= end) { ticks.push(cursor.getTime()); cursor.setDate(cursor.getDate() + every); }
    return ticks;
  };
  const months = (every: number) => {
    const ticks: number[] = [];
    const cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    while (cursor.getTime() <= end) { ticks.push(cursor.getTime()); cursor.setMonth(cursor.getMonth() + every); }
    return ticks;
  };
  const candidates = [() => days(1), () => days(2), () => days(7), () => days(14), () => months(1), () => months(2), () => months(3), () => months(6), () => months(12)];
  for (const candidate of candidates) { const ticks = candidate(); if (ticks.length <= Math.max(2, most)) return ticks; }
  return months(Math.ceil((end - start) / (365 * day) / most) * 12);
}

export function ScatterChart({ label, points, series, formatValue, valueKind = 'number', onOpen }: {
  label: string; points: ChartPoint[]; series: ChartSeries[]; formatValue(value: number): string; valueKind?: ValueKind; onOpen?(id: string): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(280, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const colors = useMemo(() => new Map(series.map(entry => [entry.key, entry])), [series]);
  const ordered = useMemo(() => [...points].sort((a, b) => a.x - b.x || a.y - b.y), [points]);
  const xs = ordered.map(point => point.x);
  const start = Math.min(...xs) - 2 * day, end = Math.max(...xs) + 2 * day;
  const yTicks = valueTicks(Math.max(...ordered.map(point => point.y)), valueKind);
  const yMax = yTicks.at(-1)!;
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  const x = (value: number) => margin.left + (value - start) / (end - start) * plotWidth;
  const y = (value: number) => margin.top + plotHeight - value / yMax * plotHeight;
  const dateLabel = new Intl.DateTimeFormat(undefined, end - start > 300 * day ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' });
  const shown = ordered.find(point => point.id === active) ?? null;

  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left, py = event.clientY - box.top;
    let best: ChartPoint | null = null, distance = 24;
    for (const point of ordered) {
      const gap = Math.hypot(x(point.x) - px, y(point.y) - py);
      if (gap <= distance) { best = point; distance = gap; }
    }
    setActive(best?.id ?? null);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ordered.findIndex(point => point.id === active);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? Math.min(ordered.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
      setActive(ordered[next]?.id ?? null);
    } else if (event.key === 'Enter' && shown && onOpen) onOpen(shown.id);
    else if (event.key === 'Escape') setActive(null);
  };

  return <div className="chart">
    <ul className="chart-legend" aria-label="Legend">{series.filter(entry => ordered.some(point => point.series === entry.key)).map(entry =>
      <li key={entry.key}><span className="chart-swatch" style={{ background: entry.color }} />{entry.label}</li>)}</ul>
    <div className="chart-frame" ref={frame} tabIndex={0} role="group" aria-label={label + '. Use the arrow keys to move between work items and Enter to open one.'} onKeyDown={key} onBlur={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={label} onPointerMove={nearest} onPointerLeave={() => setActive(null)}
        onClick={() => { if (shown && onOpen) onOpen(shown.id); }} style={{ cursor: shown && onOpen ? 'pointer' : 'default' }}>
        {yTicks.map(tick => <g key={'y' + tick}>
          <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-tick" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatValue(tick)}</text>
        </g>)}
        <line className="chart-axis" x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} />
        {timeTicks(start, end, Math.floor(plotWidth / 90)).map(tick => <text key={'x' + tick} className="chart-tick" x={x(tick)} y={height - 8} textAnchor="middle">{dateLabel.format(tick)}</text>)}
        {ordered.map(point => <circle key={point.id} cx={x(point.x)} cy={y(point.y)} r={point.id === active ? 6 : 5}
          className={'chart-dot' + (point.id === active ? ' active' : '')} fill={colors.get(point.series)?.color ?? 'var(--fgColor-muted)'} />)}
      </svg>
      {shown && <div className="chart-tooltip" role="status" style={{ left: Math.min(x(shown.x) + 12, width - 220), top: Math.max(0, y(shown.y) - 64) }}>
        <strong>{formatValue(shown.y)}</strong>
        <span className="chart-tooltip-series"><span className="chart-key" style={{ background: colors.get(shown.series)?.color }} />{colors.get(shown.series)?.label}</span>
        <span>{shown.title}</span>
        <span className="muted">{shown.detail}</span>
      </div>}
    </div>
  </div>;
}
