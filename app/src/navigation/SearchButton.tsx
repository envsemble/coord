import { Button, Kbd } from '@envsemble/envui';
import { SearchIcon } from '../ui/icons';
import { modifierKey } from '../titleBar/TitleBar';

/**
 * The search's trigger: plans, documents, diagrams and projects. A secondary button, as envUI's site
 * has it: the icon, its label and the shortcut's keys at its far end. The title bar has it
 * on every page.
 */
export function SearchButton({ platform, onClick, label = 'Search', className }: { platform: string; onClick(): void; label?: string; className?: string }) {
  return <Button variant="secondary" className={'search-button' + (className ? ' ' + className : '')} start={<SearchIcon />} end={<span className="search-button-keys"><Kbd keys={[modifierKey(platform), 'K']} /></span>}
    onClick={onClick} aria-label={label} aria-haspopup="dialog" aria-keyshortcuts={platform === 'darwin' ? 'Meta+K Meta+P' : 'Control+K Control+P'}>
    <span className="search-button-label">{label}</span>
  </Button>;
}
