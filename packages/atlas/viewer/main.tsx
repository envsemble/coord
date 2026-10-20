// Entry of the plan viewer bundle (built by scripts/build-viewer.mjs into dist/plan-viewer.html).
import { createRoot } from 'react-dom/client';
import { ThemePreferenceProvider } from '@envsemble/envui';
import '@envsemble/envui/styles.css';
// The app's own layout for the work page, so an export looks like the app.
import '../../../app/src/atlas.css';
import '@envsemble/atlas-diagrams/embedded.css';
import './viewer.css';
import { readData } from './data.ts';
import { ExportError, PlanViewer } from './PlanViewer.tsx';
import { viewerThemeKey } from './theme.ts';

const root = createRoot(document.getElementById('root')!);
let content;
try {
  content = <PlanViewer data={readData()} />;
} catch (error) {
  content = <ExportError message={error instanceof Error ? error.message : 'The embedded data could not be read.'} />;
}
root.render(<ThemePreferenceProvider storageKey={viewerThemeKey}>{content}</ThemePreferenceProvider>);
