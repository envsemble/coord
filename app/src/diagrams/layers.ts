import { shortDate } from '../ui/format';

/** What a diagram's layers need of each file of its family. */
export interface LayerEntry { path: string; title: string; role: string; family: string | null; capturedAt: string | null; valid: boolean }
export interface Layer { path: string; title: string; kind: 'capture' | 'proposal'; label: string }

/**
 * A diagram's layers: the files of its family, which are one diagram laid out once. The first capture
 * comes first, then the later captures by date, then the proposals by title. A diagram alone, or the
 * only valid file of its family, has none.
 */
export function familyLayers(diagrams: readonly LayerEntry[], path: string): Layer[] {
  const family = diagrams.find(diagram => diagram.path === path)?.family;
  if (!family) return [];
  const members = diagrams.filter(diagram => diagram.family === family && diagram.valid);
  const order = (diagram: LayerEntry) => diagram.path === family ? 0 : diagram.role === 'capture' ? 1 : 2;
  members.sort((a, b) => order(a) - order(b) || (a.capturedAt ?? '').localeCompare(b.capturedAt ?? '') || a.title.localeCompare(b.title, undefined, { numeric: true }));
  if (members.length < 2) return [];
  const proposals = members.filter(member => member.role !== 'capture').length;
  let proposal = 0;
  return members.map(member => {
    const capture = member.role === 'capture';
    // A word or two each: a capture by when it was taken, a proposal by its place among them.
    const label = capture ? (member.path === family ? 'Captured' : shortDate(member.capturedAt) || 'Captured')
      : proposals === 1 ? 'Proposal' : 'Proposal ' + ++proposal;
    return { path: member.path, title: member.title, kind: capture ? 'capture' : 'proposal', label };
  });
}

/** The layer `delta` steps from `path`, wrapping round at either end. */
export function stepLayer(layers: readonly Layer[], path: string, delta: number): string | null {
  if (!layers.length) return null;
  const at = Math.max(0, layers.findIndex(layer => layer.path === path));
  return layers[(at + delta + layers.length * Math.abs(delta)) % layers.length].path;
}
