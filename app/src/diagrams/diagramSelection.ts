/**
 * The diagram the Diagrams section shows: the one asked for, else the one shown before while it is
 * still listed, else the first that can be drawn (or the first at all).
 */
export function selectDiagram(diagrams: readonly { path: string; valid?: boolean }[], previous: string, requested = ''): string {
  if (requested) return requested;
  if (diagrams.some(diagram => diagram.path === previous)) return previous;
  return (diagrams.find(diagram => diagram.valid !== false) ?? diagrams[0])?.path ?? '';
}
