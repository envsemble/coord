// The window-wide actions the menus start, as a context App provides. A module of its own, so that
// changing the menus while developing (Vite replacing their modules) keeps the context App provides.
import { createContext, useContext } from 'react';

/** Window-wide actions the menus start: About. */
export interface AppActions {
  /** The menu's About Coord. */
  about(): void;
}
const nothing = () => undefined;
export const AppActionsContext = createContext<AppActions>({ about: nothing });
export const useAppActions = () => useContext(AppActionsContext);
