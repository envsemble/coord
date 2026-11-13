import { Button, Kbd, List, Surface, Text, Tooltip } from '@envsemble/envui';
import { IconDifference } from '@envsemble/envui/icons/Difference';
import { IconPhotoCamera } from '@envsemble/envui/icons/PhotoCamera';
import type { Layer } from './layers';
import type { DiagramEntry } from '../types';
import { DiagramIcon } from '../ui/icons';
import { ProvenanceBadge } from '../ui/badges';

/**
 * A diagram's layers, one above another as layers stack: the proposals on top, the first capture at
 * the bottom, the layer shown marked. A layer is chosen by its row, or stepped to with `[` and `]`,
 * as the heading's tooltip says.
 */
export function LayerList({ layers, value, onChange }: { layers: Layer[]; value: string; onChange(path: string): void }) {
  return <Surface background="default" radius="xl" padding={2} className="layer-list">
    <Tooltip content={<><Kbd>[</Kbd> and <Kbd>]</Kbd> step between the layers.</>} side="right">
      <Text render={<h2 />} variant="body-sm" className="layer-list-heading">Layers</Text>
    </Tooltip>
    <List.Root aria-label="Layers" density="xs">
      {[...layers].reverse().map(layer => <List.Item key={layer.path} interactive current={layer.path === value}
        start={layer.kind === 'capture' ? <IconPhotoCamera /> : <IconDifference />}
        label={<Button variant="text" data-row-target className="layer-list-name" title={layer.title} onClick={() => onChange(layer.path)}>{layer.title}</Button>}
        description={layer.label} />)}
    </List.Root>
  </Surface>;
}

/** A diagram's name in the diagram's top left, with where it came from. */
export function DiagramName({ diagram }: { diagram: DiagramEntry }) {
  return <div className="layer-marker">
    <span className="layer-marker-icon" aria-hidden="true"><DiagramIcon /></span>
    <Text render={<span />} variant="title" className="layer-marker-title diagram-title" title={diagram.title}>{diagram.title}</Text>
    <ProvenanceBadge provenance={diagram.provenance} />
  </div>;
}
