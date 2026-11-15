import { Button, Kbd } from '@envsemble/envui';
import { SearchIcon } from '../ui/icons';
import { modifierKey } from '../titleBar/TitleBar';

/**
 * The search's trigger: plans, documents, diagrams and projects. It looks like the field it opens,
 * with a field's fill and edge on whatever it sits on: the icon, its label and the shortcut's keys at its end. The title bar has it
 * on every page.
 */
export function SearchButton({ platform, onClick, label = 'Search', className }: { platform: string; onClick(): void; label?: string; className?: string }) {
  return <Button variant="outline" className={'search-button' + (className ? ' ' + className : '')} startIcon={<SearchIcon />} end={<span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'P']} /></span>}
    onClick={onClick} aria-label={label} aria-haspopup="dialog" aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'}>
    <span className="search-button-label">{label}</span>
  </Button>;
}
