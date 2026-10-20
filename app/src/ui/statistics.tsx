// The pieces the statistics pages share: a headline figure's card, and a model at an effort with its
// colour.
import type { ReactNode } from 'react';
import { Surface } from '@envsemble/envui';
import { shownEffort } from './modelColours';
import { ModelName } from './ModelName';

export function StatsCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Surface className="stat" padding={4}><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{note != null && <small className="stat-note">{note}</small>}</Surface>;
}

/** A model at an effort's colour, from the palette of the models shown with it (`modelPalette`). */
function ModelSwatch({ colour }: { colour: string }) {
  return <span className="model-swatch" style={{ background: colour }} aria-hidden="true" />;
}

/** A model at an effort as charts, legends and tables show it: its colour, then its name with its provider's mark and effort. */
export function ModelKey({ model, effort, colour, items }: { model: string | null; effort: string | null; colour: string; items: { model: string | null; effort: string | null }[] }) {
  return <span className="model-cell"><ModelSwatch colour={colour} /><ModelName model={model} effort={shownEffort(items, model, effort)} /></span>;
}
