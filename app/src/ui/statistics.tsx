// The pieces the statistics pages share: the headline figures, and a model at an effort with its colour.
import type { ReactNode } from 'react';
import { Column, Grid, Surface, Text } from '@envsemble/envui';
import { shownEffort } from './modelColours';
import { ModelName } from './ModelName';

/** The headline figures, after envUI's key figures pattern: one surface, its figures in even columns. */
export function KeyFigures({ label, children }: { label: string; children: ReactNode }) {
  return <Surface role="group" aria-label={label} className="stats-grid" render={<Grid name="key-figures" columns="repeat(auto-fit, minmax(min(100%, 11rem), 1fr))" gap={5} />}>{children}</Surface>;
}

/** A headline figure: its label, the figure, and a note on how it changed or how it is counted. */
export function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Column gap={1} className="stat">
    <Text variant="body-sm" emphasis="muted">{label}</Text>
    <Text variant="headline" className="stat-value">{value}</Text>
    {note != null && <Text variant="body-sm" emphasis="muted" className="stat-note">{note}</Text>}
  </Column>;
}

/** A model at an effort's colour, from the palette of the models shown with it (`modelPalette`). */
function ModelSwatch({ colour }: { colour: string }) {
  return <span className="model-swatch" style={{ background: colour }} aria-hidden="true" />;
}

/** A model at an effort as charts, legends and tables show it: its colour, then its name with its provider's mark and effort. */
export function ModelKey({ model, effort, colour, items }: { model: string | null; effort: string | null; colour: string; items: { model: string | null; effort: string | null }[] }) {
  return <span className="model-cell"><ModelSwatch colour={colour} /><ModelName model={model} effort={shownEffort(items, model, effort)} /></span>;
}
