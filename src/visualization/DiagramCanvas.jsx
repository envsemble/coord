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
      onSelect,
      onZoom,
      onHover,
      onClearHover,
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
      onTap: (element) => {
        const target = readTarget(element);
        if (target) onSelect(target);
      },
      onMotion: clearTransient,
    });
    useImperativeHandle(ref, () => controls, [controls]);
    useLayoutEffect(() => {
      if (selected?.kind === "node") controls.revealNode(selected.id);
    }, [controls, diagram, selected]);
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
        aria-label="Interactive OntoUML diagram"
        onPointerLeave={() => onHover(null)}
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
