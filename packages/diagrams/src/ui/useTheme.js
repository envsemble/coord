import { useLayoutEffect, useState } from "react";

export function useTheme(storageKey) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(storageKey, theme);
    } catch {}
  }, [theme, storageKey]);
  return [theme, () => setTheme((old) => (old === "dark" ? "light" : "dark"))];
}
