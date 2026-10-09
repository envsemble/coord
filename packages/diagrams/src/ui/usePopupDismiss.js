import { useEffect, useLayoutEffect, useRef } from "react";

export function usePopupDismiss(onClose, ...roots) {
  const latest = useRef({ onClose, roots });
  useLayoutEffect(() => {
    latest.current = { onClose, roots };
  });
  useEffect(() => {
    const outside = (e) => {
      if (!latest.current.roots.some((ref) => ref.current?.contains(e.target)))
        latest.current.onClose();
    };
    const escape = (e) => {
      if (e.key === "Escape") latest.current.onClose();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
}
