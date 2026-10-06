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
    { diagram, selected, focusRequest, onSelect, onZoom },
    ref,
  ) {
    const canvasRef = useRef(null),
      worldRef = useRef(null);
    const [hovered, setHovered] = useState(null),
      [focused, setFocused] = useState(null);
    const clearTransient = useCallback(() => {
      setHovered(null);
      setFocused(null);
    }, []);
    const controls = useDiagramCamera({
      canvasRef,
      worldRef,
      diagram,
      focusRequest,
      onZoom,
      onTap: (element) => {
        const target = readTarget(element);
        if (target) onSelect(target);
      },
      onMotion: clearTransient,
    });
    useImperativeHandle(ref, () => controls, [controls]);
    useLayoutEffect(clearTransient, [clearTransient, diagram]);
    useLayoutEffect(clearTransient, [clearTransient, selected]);
    useEffect(() => {
      const escape = (e) => {
        if (e.key === "Escape") clearTransient();
      };
      document.addEventListener("keydown", escape);
      return () => document.removeEventListener("keydown", escape);
    }, [clearTransient]);
    const handlers = {
      onHover: (value) =>
        setHovered((old) => (sameTarget(old, value) ? old : value)),
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
        aria-label="Interactive OntoUML diagram"
        onPointerLeave={() => setHovered(null)}
      >
        <div ref={worldRef} id="world">
          <UMLDiagram
            diagram={diagram}
            active={hovered || focused || selected}
            selected={selected}
            handlers={handlers}
          />
        </div>
      </main>
    );
  }),
);
