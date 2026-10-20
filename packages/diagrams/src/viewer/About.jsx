import { Kbd, Stack, Text } from "@envsemble/envui";
import { DownloadLink } from "../ui/DownloadLink";
import { ProvenanceBadge } from "./ProvenanceBadge";

/** Help for the standalone viewer: how to move around, and source downloads. */
export function About({ model, exports, provenance }) {
  return (
    <Stack gap={4} className="atlas-portal about-content">
      <ProvenanceBadge document={provenance} className="inline" />
      <Text tone="muted">{model.status}</Text>
      <dl className="shortcut-list">
        {[
          ["Scroll or pinch", "Zoom"],
          ["Drag", "Pan"],
          [
            <>
              <Kbd>+</Kbd> <Kbd>−</Kbd>
            </>,
            "Zoom in or out",
          ],
          [<Kbd>0</Kbd>, "Fit the diagram"],
          [<Kbd>/</Kbd>, "Find a concept"],
          [<Kbd>Esc</Kbd>, "Clear the selection"],
        ].map(([keys, action], i) => (
          <div className="shortcut" key={i}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <Stack gap={1} align="start">
        <DownloadLink
          data={exports.readText(`${exports.slug}-model-notes.txt`)}
          filename={`${exports.slug}-model-notes.txt`}
        >
          Source notes
        </DownloadLink>
        <DownloadLink
          data={exports.readText(`${exports.slug}-validation.json`)}
          filename={`${exports.slug}-validation.json`}
          type="application/json"
        >
          Validation report
        </DownloadLink>
      </Stack>
    </Stack>
  );
}
