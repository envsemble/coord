/** The file name the command line uses: `<slug>-<work-id>.atlas-plan.html`. */
export function exportFileName(workPath: string, workId: string) {
  const folder = workPath.split('/').at(-1) ?? '';
  return (folder.replace(/^[0-9]+-/, '') || 'plan') + '-' + workId + '.atlas-plan.html';
}
