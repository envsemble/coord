import { useEffect, useState } from "react";
export function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState(undefined);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([data], { type }));
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [data, type]);
  return url;
}
