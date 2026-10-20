import { Button } from "@envsemble/envui";
import { useBlobURL } from "./useBlobURL";
import { DownloadIcon } from "./icons";

/** A text button that downloads data held in memory. */
export function DownloadLink({ data, filename, type, children, ...props }) {
  const href = useBlobURL(data, type);
  return (
    <Button
      {...props}
      variant="text"
      startIcon={<DownloadIcon />}
      {...(href ? { href, download: filename } : { disabled: true })}
    >
      {children}
    </Button>
  );
}
