import { useBlobURL } from "./useBlobURL";
export function DownloadLink({
  data,
  filename,
  type,
  children,
  id,
  className = "source",
}) {
  const href = useBlobURL(data, type);
  return (
    <a id={id} className={className} href={href} download={filename}>
      {children}
    </a>
  );
}
