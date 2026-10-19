// Open in: the title bar's split button that opens the file the window shows (a plan's document, a
// diagram's source, a file) in the chosen editor, or shows it in the system's file manager. Its arrow
// lists the editors Atlas knows, each with its mark; choosing one makes it the editor files open in
// (another window may change it, so it is read again as the list opens) and opens the file with it.
// Ctrl+O (⌘O) does what the main part does. Main builds each editor's link and checks the file.
import { useEffect, useState } from 'react';
import { Button, ButtonGroup, IconButton, Menu, MenuItem, Tooltip } from '@envsemble/envui';
import { ExpandMore } from '@envsemble/envui/icons/ExpandMore';
import { editorNames, editors, type Editor } from '../../shared/contract';
import { api } from '../api';
import { EditorMark } from '../ui/EditorMark';
import { CheckIcon } from '../ui/icons';
import { modifierKey } from './AppMenu';

/** The system's file manager by its name on each platform. */
export const fileManagerName = (platform: string) => platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'Files';
/** An editor by its name, the system's choice by its file manager's. */
export const editorName = (editor: Editor, platform: string) => editor === 'system' ? fileManagerName(platform) : editorNames[editor];
/** What the main part says: "Open in VS Code", or "Show in File Explorer". */
export const editorAction = (editor: Editor, platform: string) => (editor === 'system' ? 'Show in ' : 'Open in ') + editorName(editor, platform);

/** The editor files open in, as main keeps it; VS Code until it is read. */
export function useEditor(): [Editor, (editor: Editor) => Promise<void>, () => void] {
  const [editor, setEditor] = useState<Editor>('vscode');
  const read = () => { api.editor().then(setEditor, () => undefined); };
  useEffect(read, []);
  const choose = async (next: Editor) => { setEditor(next); await api.setEditor(next); };
  return [editor, choose, read];
}

/** `open`: open the shown file with the chosen editor. Shown only where the window shows a file. */
export function EditorButton({ platform, editor, choose, read, open }: { platform: string; editor: Editor; choose(editor: Editor): Promise<void>; read(): void; open(): void }) {
  const mod = modifierKey(platform);
  const keys = platform === 'darwin' ? 'Meta+O' : 'Control+O';
  return <ButtonGroup className="editor-button" aria-label="Open in editor">
    <Tooltip content={editorAction(editor, platform) + ' (' + mod + '+O)'} side="bottom">
      <Button variant="secondary" startIcon={<EditorMark editor={editor} />} aria-label={editorAction(editor, platform)} aria-keyshortcuts={keys} onClick={open}>
        <span className="editor-button-label">{editorAction(editor, platform)}</span>
      </Button>
    </Tooltip>
    <Menu aria-label="Open in" align="end" density="compact" onOpenChange={shown => { if (shown) read(); }}
      trigger={<IconButton variant="secondary" className="editor-button-more" icon={<ExpandMore />} aria-label="Choose the editor" />}>
      {editors.map(value => <MenuItem key={value} icon={<EditorMark editor={value} />} shortcut={value === editor ? mod + '+O' : undefined}
        trailing={value === editor ? <CheckIcon className="editor-current" aria-label="Current" /> : undefined}
        onClick={() => { void choose(value).then(open, () => undefined); }}>
        {editorName(value, platform)}
      </MenuItem>)}
    </Menu>
  </ButtonGroup>;
}
