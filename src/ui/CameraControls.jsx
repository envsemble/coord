import { IconButton } from "./Button";

export function CameraControls({ zoom, onZoom, onReset, onFit }) {
  return (
    <div className="camera-controls">
      <IconButton
        id="zoom-out"
        label="Zoom out"
        title="Zoom out (−)"
        onClick={() => onZoom(1 / 1.25)}
      >
        −
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
        +
      </IconButton>
      <button id="fit" title="Fit diagram (0)" onClick={onFit}>
        Fit
      </button>
    </div>
  );
}
