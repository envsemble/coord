import { Menu, MenuItem } from "@envsemble/envui";
import { ToolButton } from "./Button";
import { DownloadIcon } from "./Icons";

/** Starts a download of a URL (such as a blob URL) under a file name. */
export function downloadURL(href, filename) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Downloads text or bytes held in memory. */
export function downloadData(
  data,
  filename,
  type = "text/plain;charset=utf-8",
) {
  const href = URL.createObjectURL(new Blob([data], { type }));
  downloadURL(href, filename);
  // The browser reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** The standalone viewer's downloads: `{ key, label, description, icon, onSelect }` items. */
export function ExportMenu({ items }) {
  return (
    <Menu
      aria-label="Export"
      trigger={
        <ToolButton
          id="export"
          label="Export"
          tooltip="Export the diagram or model"
          icon={<DownloadIcon />}
        />
      }
    >
      {items.map((item) => (
        <MenuItem
          key={item.key}
          className={item.key}
          icon={item.icon}
          description={item.description}
          onClick={item.onSelect}
        >
          {item.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
