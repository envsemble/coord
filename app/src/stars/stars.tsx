// Starred work items: ones the person keeps coming back to, starred from the hub or a plan's page.
// They are the same in every window, kept by main in the home database; a window reads them again
// when it comes to the front, so a star given in another window shows there too.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { starKey } from '../../shared/contract';
import { api } from '../api';

interface Stars {
  starred(projectId: string, workId: string): boolean;
  setStarred(projectId: string, workId: string, starred: boolean): void;
}
const StarsContext = createContext<Stars>({ starred: () => false, setStarred: () => undefined });
export const useStars = () => useContext(StarsContext);

/** The stars of the window's computer (`hostId`, null for this one). */
export function StarsProvider({ hostId, children }: { hostId: string | null; children: ReactNode }) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let current = true;
    const read = () => { api.stars().then(list => { if (current) setKeys(new Set(list)); }, () => undefined); };
    read();
    window.addEventListener('focus', read);
    return () => { current = false; window.removeEventListener('focus', read); };
  }, []);
  const setStarred = useCallback((projectId: string, workId: string, starred: boolean) => {
    const key = starKey(hostId, projectId, workId);
    // Shown at once; main's answer, every window's stars, follows.
    setKeys(previous => { const next = new Set(previous); if (starred) next.add(key); else next.delete(key); return next; });
    api.setStar(key, starred).then(list => setKeys(new Set(list)), () => { api.stars().then(list => setKeys(new Set(list)), () => undefined); });
  }, [hostId]);
  const value = useMemo<Stars>(() => ({ starred: (projectId, workId) => keys.has(starKey(hostId, projectId, workId)), setStarred }), [keys, hostId, setStarred]);
  return <StarsContext.Provider value={value}>{children}</StarsContext.Provider>;
}
