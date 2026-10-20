import { useState } from 'react';
import { Button } from '@envsemble/envui';
import { api } from '../api';
import { CheckIcon, CopyIcon } from './icons';

/** Copies text to the clipboard, and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <Button variant="secondary" startIcon={done ? <CheckIcon /> : <CopyIcon />} onClick={() => { void api.copy(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>
    {done ? 'Copied' : label}
  </Button>;
}
