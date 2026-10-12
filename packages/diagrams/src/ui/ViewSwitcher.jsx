import { SegmentedControl, Select } from "@envsemble/envui";

/**
 * Chooses which diagram view the canvas shows: a segmented control, or a
 * select when the toolbar is crowded. Views are not tab panels: the canvas
 * beside the toolbar shows the chosen one.
 */
export function ViewSwitcher({
  items,
  value,
  onChange,
  label = "Diagram view",
  compact = false,
}) {
  const options = items.map((item) => ({ value: item.key, label: item.label }));
  if (compact)
    return (
      <Select
        className="view-select"
        aria-label={label}
        options={options}
        value={value}
        onValueChange={(next) => next && onChange(next)}
      />
    );
  return (
    <SegmentedControl
      className="view-switcher"
      aria-label={label}
      size="compact"
      options={options}
      value={value}
      onValueChange={onChange}
    />
  );
}
