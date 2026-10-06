import { useMemo } from "react";
import { unzipSync, strFromU8 } from "fflate";
export function useArtifactArchive(exportData) {
  return useMemo(() => {
    const bundle = Uint8Array.from(atob(exportData.bundle), (c) =>
      c.charCodeAt(0),
    );
    const entries = unzipSync(bundle);
    const textCache = new Map();
    return {
      slug: exportData.slug,
      bundle,
      readText(name) {
        if (!entries[name]) throw new Error(`Missing export ${name}`);
        if (!textCache.has(name)) textCache.set(name, strFromU8(entries[name]));
        return textCache.get(name);
      },
    };
  }, [exportData]);
}
