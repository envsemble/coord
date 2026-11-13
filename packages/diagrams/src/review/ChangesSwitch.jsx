import { ToolButton } from "../ui/ToolButton";
import { ChangeColorsIcon } from "../ui/icons";

/**
 * Whether a proposal shows its changes (what it adds, changes and removes, in
 * their colours) or the diagram as it is, plainly. Off, the Changes panel and
 * fading go with them; the family's shared layout keeps everything in place.
 */
export function ChangesSwitch({ shown, onChange }) {
  return (
    <ToolButton
      label="Show changes"
      tooltip={
        shown ? "Show the diagram plainly" : "Colour what the proposal changes"
      }
      pressed={shown}
      icon={<ChangeColorsIcon />}
      onClick={() => onChange(!shown)}
    />
  );
}
