import { formatCaptureDate } from "./provenance";

const reviewed = new WeakMap();

/**
 * What a payload shows. A proposal opens in its change view: the proposal with
 * the baseline's removed elements retained and every change marked. Its
 * rolled-up changes travel to the viewer as `review`, for the Changes overview
 * and details, and `provenanceDocument` is the proposal's. Other payloads show
 * themselves. A plain function rather than a wrapper component, so a viewer
 * switching between a capture and its proposals stays mounted; memoized per
 * payload, so each switch shows the same objects again.
 */
export function reviewedPayload(payload) {
  if (!payload.comparison)
    return {
      payload,
      review: null,
      provenanceDocument: payload.model.document,
    };
  let result = reviewed.get(payload);
  if (!result) {
    const comparison = payload.comparison;
    const document = payload.model.document;
    const capturedAt = document?.snapshots?.find(
      (s) => s.id === document.baselineId,
    )?.capture?.capturedAt;
    result = {
      payload: {
        ...payload,
        ...(comparison.changeView || {}),
        comparison: undefined,
      },
      review: { comparison, baselineDate: formatCaptureDate(capturedAt) },
      provenanceDocument: document,
    };
    reviewed.set(payload, result);
  }
  return result;
}
