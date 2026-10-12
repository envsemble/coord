import { useSyncExternalStore } from "react";
import { Button, ButtonGroup, Kbd, Tooltip } from "@envsemble/envui";
import { ToolButton } from "./Button";
import { FitIcon, ZoomInIcon, ZoomOutIcon } from "./Icons";

function ZoomReadout({ zoom, onReset }) {
  return (
    <Tooltip content="Reset to 100%" side="bottom">
      <Button
        id="zoom-value"
        variant="secondary"
        className="zoom-readout"
        aria-label={`Zoom ${zoom}%; reset to 100%`}
        onClick={onReset}
      >
        {zoom}%
      </Button>
    </Tooltip>
  );
}

function ObservedZoomReadout({ store, onReset }) {
  const zoom = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return <ZoomReadout zoom={zoom} onReset={onReset} />;
}

/**
 * Connected zoom controls. `compact` drops the step buttons; wheel, pinch,
 * the keyboard and the readout still zoom.
 */
export function CameraControls({
  zoom,
  zoomStore,
  onZoom,
  onReset,
  onFit,
  compact = false,
}) {
  return (
    <ButtonGroup aria-label="Zoom" className="camera-controls">
      {!compact && (
        <ToolButton
          id="zoom-out"
          label="Zoom out"
          tooltip={
            <>
              Zoom out <Kbd>−</Kbd>
            </>
          }
          aria-keyshortcuts="-"
          icon={<ZoomOutIcon />}
          onClick={() => onZoom(1 / 1.25)}
        />
      )}
      {zoomStore ? (
        <ObservedZoomReadout store={zoomStore} onReset={onReset} />
      ) : (
        <ZoomReadout zoom={zoom} onReset={onReset} />
      )}
      {!compact && (
        <ToolButton
          id="zoom-in"
          label="Zoom in"
          tooltip={
            <>
              Zoom in <Kbd>+</Kbd>
            </>
          }
          aria-keyshortcuts="+"
          icon={<ZoomInIcon />}
          onClick={() => onZoom(1.25)}
        />
      )}
      <ToolButton
        id="fit"
        label="Fit diagram"
        tooltip={
          <>
            Fit diagram <Kbd>0</Kbd>
          </>
        }
        aria-keyshortcuts="0"
        icon={<FitIcon />}
        onClick={onFit}
      />
    </ButtonGroup>
  );
}
