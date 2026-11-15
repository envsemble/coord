import { IconButton } from '@envsemble/envui';
import { IconStar } from '@envsemble/envui/icons/Star';
import { useStars } from './stars';

/** Star or unstar a work item: the outlined star, filled in amber while it is starred. */
export function StarButton({ projectId, workId, title, className }: { projectId: string; workId: string; title: string; className?: string }) {
  const { starred, setStarred } = useStars();
  const on = starred(projectId, workId);
  return <IconButton variant="ghost" size="sm" className={'star-button' + (className ? ' ' + className : '')} aria-pressed={on}
    aria-label={(on ? 'Unstar ' : 'Star ') + title} title={on ? 'Starred' : 'Star'} icon={<IconStar filled={on} />}
    onClick={event => { event.stopPropagation(); event.preventDefault(); setStarred(projectId, workId, !on); }} />;
}
