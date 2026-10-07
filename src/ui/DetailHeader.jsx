import { FileCodeIcon } from "./Icons";

export function DetailHeader({
  title,
  tag,
  status,
  description,
  stereotype,
  icon: Icon = FileCodeIcon,
}) {
  return (
    <div className="detail-header">
      <h1>
        <Icon size={20} />
        <span>{title}</span>
      </h1>
      <div className="detail-tags">
        <span className="tag stereotype-tag" data-stereotype={stereotype}>
          {tag}
        </span>
        {status && (
          <span className="tag evidence-status" data-status={status}>
            {status}
          </span>
        )}
      </div>
      {description && <p>{description}</p>}
    </div>
  );
}
