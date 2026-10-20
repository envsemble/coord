import { Stack, Text } from "@envsemble/envui";

/** One titled part of the details, such as What changes. */
export function Section({ title, label = title, className = "", children }) {
  return (
    <Stack
      as="section"
      gap={2}
      className={`detail-section${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <Text as="h2" variant="caption" className="detail-section-title">
        {title}
      </Text>
      {children}
    </Stack>
  );
}
