// The window-wide actions the menus start, as a context App provides. A module of its own, so that
// changing the menus while developing (Vite replacing their modules) keeps the context App provides.
import { createContext, useContext } from 'react';

/** Window-wide actions the menus start: pairing, remote access, the computers and About. */
export interface AppActions {
  connect(): void;
  remoteAccess(): void;
  manageComputers(): void;
  /** The menu's About Atlas. */
  about(): void;
}
const nothing = () => undefined;
export const AppActionsContext = createContext<AppActions>({ connect: nothing, remoteAccess: nothing, manageComputers: nothing, about: nothing });
export const useAppActions = () => useContext(AppActionsContext);
