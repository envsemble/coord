import { formatCaptureDate } from "./provenance";

const reviews = new WeakMap();

/**
 * What a payload shows. A proposal opens in its change view: the proposal with
 * the baseline's removed elements retained and every change marked. Its
 * rolled-up changes travel to the viewer as `review`, for the Changes overview
 * and details, and `provenanceDocument` is the proposal's. Other payloads show
 * themselves. A plain function rather than a wrapper component, so a viewer
 * switching between a capture and its proposals stays mounted. A comparison
 * has one `review`, however its payload arrives (as one object, or spread
 * into a viewer's props), so what the viewer derives from it is kept.
 * `plain` is the proposal as itself, without its changes, for a reader who
 * turns them off (null for other payloads); a family shares one layout, so
 * nothing moves between the two.
 */
export function reviewedPayload(payload) {
  const comparison = payload.comparison;
  const document = payload.model.document;
  if (!comparison)
    return { payload, review: null, plain: null, provenanceDocument: document };
  let review = reviews.get(comparison);
  if (!review) {
    const capturedAt = document?.snapshots?.find(
      (s) => s.id === document.baselineId,
    )?.capture?.capturedAt;
    review = { comparison, baselineDate: formatCaptureDate(capturedAt) };
    reviews.set(comparison, review);
  }
  return {
    payload: {
      ...payload,
      ...(comparison.changeView || {}),
      comparison: undefined,
    },
    review,
    plain: { ...payload, comparison: undefined },
    provenanceDocument: document,
  };
}
