import { IconButton } from "./Button";
import { DashIcon, PlusIcon, FocusCenterIcon } from "./Icons";
import { useSyncExternalStore } from "react";

function ZoomReadout({ zoom, onReset }) {
  return (
    <button
      id="zoom-value"
      className="zoom-readout"
      title="Reset to 100%"
      aria-label={`Zoom ${zoom}%; reset to 100%`}
      onClick={onReset}
    >
      {zoom}%
    </button>
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

export function CameraControls({ zoom, zoomStore, onZoom, onReset, onFit }) {
  return (
    <div className="camera-controls" role="group" aria-label="Zoom">
      <IconButton
        id="zoom-out"
        label="Zoom out"
        title="Zoom out (−)"
        aria-keyshortcuts="-"
        onClick={() => onZoom(1 / 1.25)}
      >
        <DashIcon size={16} />
      </IconButton>
      {zoomStore ? (
        <ObservedZoomReadout store={zoomStore} onReset={onReset} />
      ) : (
        <ZoomReadout zoom={zoom} onReset={onReset} />
      )}
      <IconButton
        id="zoom-in"
        label="Zoom in"
        title="Zoom in (+)"
        aria-keyshortcuts="+"
        onClick={() => onZoom(1.25)}
      >
        <PlusIcon size={16} />
      </IconButton>
      <IconButton
        id="fit"
        label="Fit"
        title="Fit diagram (0)"
        aria-keyshortcuts="0"
        onClick={onFit}
      >
        <FocusCenterIcon size={16} />
      </IconButton>
    </div>
  );
}
