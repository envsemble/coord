import { createElement } from "react";
import { Column, Text } from "@envsemble/envui";

/**
 * What a region shows when it has nothing to show: a heading that states the
 * fact and a sentence under it, as envUI's empty-state pattern composes them.
 * `headingLevel` places the heading in the page outline; it looks the same.
 */
export function EmptyState({
  title,
  description,
  headingLevel = 4,
  className,
}) {
  return (
    <Column
      gap={2}
      className={`atlas-empty-state${className ? ` ${className}` : ""}`}
    >
      <Text
        render={createElement(`h${headingLevel}`)}
        variant="title"
        className="atlas-section-heading"
      >
        {title}
      </Text>
      {description && <Text variant="body-sm">{description}</Text>}
    </Column>
  );
}
