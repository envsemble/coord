import { Column, Text } from "@envsemble/envui";

/** One titled part of the details, such as What changes. */
export function Section({ title, label = title, className = "", children }) {
  return (
    <Column
      render={<section />}
      gap={2}
      className={`detail-section${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <Text render={<h2 />} variant="body-sm" className="detail-section-title">
        {title}
      </Text>
      {children}
    </Column>
  );
}
