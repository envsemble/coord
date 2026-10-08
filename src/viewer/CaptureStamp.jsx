export function CaptureStamp({ model }) {
  const meta = model.document;
  if (!meta) return null;
  const snapshot = meta.snapshots.find((s) => s.id === meta.baselineId);
  return (
    <span
      className="atlas-capture"
      title={
        snapshot
          ? `${snapshot.capture.source.kind}: ${snapshot.capture.source.identity}\n${snapshot.capture.coverage.status} coverage; ${meta.imported ? "imported claims" : "retained capture"}`
          : `Revision ${meta.revision.id}`
      }
    >
      {meta.profile} · {meta.state} ·{" "}
      {snapshot ? snapshot.capture.capturedAt : meta.revision.createdAt}
      {snapshot ? ` · ${snapshot.capture.coverage.status}` : ""}
      {meta.imported ? " · imported" : ""}
    </span>
  );
}
