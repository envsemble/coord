// Entry of the plan viewer bundle (built by scripts/build-viewer.mjs into dist/plan-viewer.html).
import { createRoot } from 'react-dom/client';
import '@primer/primitives/dist/css/functional/themes/dark-dimmed.css';
// The app's own Primer-based styles, so an export looks like the app.
import '../../../app/src/style.css';
import '@envsemble/atlas-diagrams/embedded.css';
import './viewer.css';
import { readData } from './data.ts';
import { ExportError, PlanViewer } from './PlanViewer.tsx';

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<PlanViewer data={readData()} />);
} catch (error) {
  root.render(<ExportError message={error instanceof Error ? error.message : 'The embedded data could not be read.'} />);
}
