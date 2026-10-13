import { useMemo } from "react";
import { formatCaptureDate } from "./provenance";

/**
 * A proposal opens in its change view: the proposal with the baseline's
 * removed elements retained and every change marked. The rolled-up changes
 * travel to the viewer as `review`, for its Changes overview and details.
 */
export function ComparisonViewer({ payload, focus = payload.focus, render }) {
  const comparison = payload.comparison;
  const document = payload.model.document;
  const capturedAt = document?.snapshots?.find(
    (s) => s.id === document.baselineId,
  )?.capture?.capturedAt;
  const review = useMemo(
    () => ({ comparison, baselineDate: formatCaptureDate(capturedAt) }),
    [comparison, capturedAt],
  );
  const shown = useMemo(
    () => ({
      ...payload,
      ...(comparison.changeView || {}),
      comparison: undefined,
    }),
    [payload, comparison],
  );
  return render(shown, focus, { review, provenanceDocument: document });
}
