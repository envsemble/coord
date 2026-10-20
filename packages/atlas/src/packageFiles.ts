// Files of this package that its code reads at run time: package.json (for the version a plan export
// records) and dist/plan-viewer.html (the plan export template). This module stays directly in src:
// the app bundles it into out/main and copies both files into out, so `../` reaches them from either.
export const packageJson = new URL('../package.json', import.meta.url);
export const planViewerFile = new URL('../dist/plan-viewer.html', import.meta.url);
