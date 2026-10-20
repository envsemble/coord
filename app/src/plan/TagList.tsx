// A work item's tags (its plan header's `tags`), read-only: under the plan's title and on its search
// results, so people see what the work can be found by, and `tag:<tag>` in the search finds it again.

export function TagList({ tags, className }: { tags: readonly string[]; className?: string }) {
  if (!tags.length) return null;
  return <ul className={'tag-list' + (className ? ' ' + className : '')} aria-label="Tags">
    {tags.map(tag => <li key={tag} className="tag">{tag}</li>)}
  </ul>;
}
