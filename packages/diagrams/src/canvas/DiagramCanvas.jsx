import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { UMLDiagram } from "./UMLDiagram";
import { useDiagramCamera } from "./useDiagramCamera";
import { readTarget, sameTarget } from "./interaction";

export const DiagramCanvas = memo(
  forwardRef(function DiagramCanvas(
    {
      diagram,
      selected,
      hovered,
      focusRequest,
      backgroundURL,
      fitInsets,
      onSelect,
      onZoom,
      onHover,
      onClearHover,
      elementDrag = null,
    },
    ref,
  ) {
    const canvasRef = useRef(null),
      worldRef = useRef(null);
    const [focused, setFocused] = useState(null);
    const clearTransient = useCallback(() => {
      onClearHover();
      setFocused(null);
    }, [onClearHover]);
    const controls = useDiagramCamera({
      canvasRef,
      worldRef,
      diagram,
      focusRequest,
      onZoom,
      // A background tap has no model target and clears selection. The camera
      // invokes this only for taps, so panning and zooming retain selection.
      onTap: (element) => onSelect(readTarget(element)),
      onMotion: clearTransient,
      insets: fitInsets,
      elementDrag,
    });
    useImperativeHandle(ref, () => controls, [controls]);
    // A selected element is kept in view as the view changes, though not
    // while it is dragged about within one.
    useLayoutEffect(() => {
      if (selected?.kind === "node") controls.revealNode(selected.id);
    }, [controls, diagram.key, diagram.initialFocus, selected]);
    useLayoutEffect(clearTransient, [
      clearTransient,
      diagram.key,
      diagram.initialFocus,
    ]);
    useLayoutEffect(clearTransient, [clearTransient, selected]);
    useEffect(() => {
      const escape = (e) => {
        if (e.key === "Escape") clearTransient();
      };
      document.addEventListener("keydown", escape);
      return () => document.removeEventListener("keydown", escape);
    }, [clearTransient]);
    const handlers = {
      onHover,
      onFocus: (value) =>
        setFocused((old) => (sameTarget(old, value) ? old : value)),
      onActivate: (value, e) => {
        if (e.type === "keydown" || !controls.hasDragged()) onSelect(value);
      },
    };
    return (
      <main
        ref={canvasRef}
        id="canvas"
        className={elementDrag ? "arrangeable" : undefined}
        aria-label="Interactive diagram"
        onPointerLeave={() => onHover(null)}
      >
        <div className="canvas-grid" aria-hidden="true" />
        <div ref={worldRef} id="world">
          <UMLDiagram
            diagram={diagram}
            active={hovered || focused || selected}
            selected={selected}
            backgroundURL={backgroundURL}
            handlers={handlers}
          />
        </div>
      </main>
    );
  }),
);
