export function selectModelHandle(
  models: readonly { handle: string }[],
  previous: string,
  requested = '',
  invalidHandles: readonly string[] = [],
): string {
  return requested || (models.some(model => model.handle === previous) || invalidHandles.includes(previous) ? previous : models[0]?.handle || '');
}
