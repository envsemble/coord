import { ScenarioPanel } from "../scenarios/ScenarioPanel";
import { Panel } from "../ui/Panel";

/**
 * The pane beside the canvas: a proposal's changes, with stepping through
 * them, or the scenarios that exemplify the model. `state` is the viewer's
 * (see useViewerState); it opens only from its own toolbar button.
 */
export function SidePanel({ state, model, scenarios }) {
  const { panel, changes, closePanel, hover, inspectScenario } = state;
  if (!panel) return null;
  const showsChanges = panel === "changes";
  return (
    <Panel
      id="side-panel"
      className="side-panel"
      open
      title={showsChanges ? "Changes" : "Understand the model"}
      label={showsChanges ? "Changes in this proposal" : "Model guide"}
      toolbar={showsChanges ? changes.navigation : null}
      closeLabel={showsChanges ? "Hide the changes" : "Close the guide"}
      onClose={closePanel}
      onPointerLeave={() => hover(null)}
    >
      {showsChanges && changes.content}
      {panel === "scenarios" && (
        <ScenarioPanel
          model={model}
          scenarios={scenarios}
          onInspect={inspectScenario}
        />
      )}
    </Panel>
  );
}
