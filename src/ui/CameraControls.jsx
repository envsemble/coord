import { IconButton } from "./Button";
import { DashIcon, PlusIcon, ScreenFullIcon } from "./Icons";

export function CameraControls({ zoom, onZoom, onReset, onFit }) {
  return (
    <div className="camera-controls">
      <IconButton
        id="zoom-out"
        label="Zoom out"
        title="Zoom out (−)"
        onClick={() => onZoom(1 / 1.25)}
      >
        <DashIcon size={16} />
      </IconButton>
      <button
        id="zoom-value"
        className="zoom-readout"
        title="Reset to 100%"
        onClick={onReset}
      >
        {zoom}%
      </button>
      <IconButton
        id="zoom-in"
        label="Zoom in"
        title="Zoom in (+)"
        onClick={() => onZoom(1.25)}
      >
        <PlusIcon size={16} />
      </IconButton>
      <button id="fit" aria-label="Fit" title="Fit diagram (0)" onClick={onFit}>
        <ScreenFullIcon size={16} />
      </button>
    </div>
  );
}
