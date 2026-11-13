import { Kbd, SegmentedControl, Text, Tooltip } from '@envsemble/envui';
import { IconLayers } from '@envsemble/envui/icons/Layers';
import { IconDifference } from '@envsemble/envui/icons/Difference';
import { IconPhotoCamera } from '@envsemble/envui/icons/PhotoCamera';
import type { Layer } from './layers';
import type { DiagramEntry } from '../types';
import { DiagramIcon } from '../ui/icons';
import { ProvenanceBadge } from '../ui/badges';

/**
 * A diagram's layers, in the diagram's top left: one segment per file of its family, the one shown
 * chosen, and the name of the layer shown. `[` and `]` step through them too, as its tooltip says.
 * No dropdown: a family of many layers keeps its segments, which scroll in a narrow window.
 */
export function LayerMarker({ layers, value, onChange }: { layers: Layer[]; value: string; onChange(path: string): void }) {
  const current = layers.find(layer => layer.path === value) ?? layers[0];
  const items = layers.map(layer => ({ value: layer.path, label: layer.label, icon: layer.kind === 'capture' ? <IconPhotoCamera /> : <IconDifference /> }));
  return <div className="layer-marker">
    <Tooltip content={<>Layers of this diagram. <Kbd>[</Kbd> and <Kbd>]</Kbd> switch between them.</>} side="bottom">
      <span className="layer-marker-icon" aria-hidden="true"><IconLayers /></span>
    </Tooltip>
    <SegmentedControl size="sm" aria-label="Layer" items={items} value={current.path} onValueChange={next => next && onChange(next)} />
    <Text render={<span />} emphasis="muted" className="layer-marker-title diagram-title" title={current.title}>{current.title}</Text>
  </div>;
}

/** A diagram that is not one of a family's layers, named in the diagram's top left with where it came from. */
export function DiagramName({ diagram }: { diagram: DiagramEntry }) {
  return <div className="layer-marker">
    <span className="layer-marker-icon" aria-hidden="true"><DiagramIcon /></span>
    <Text render={<span />} variant="title" className="layer-marker-title diagram-title" title={diagram.title}>{diagram.title}</Text>
    <ProvenanceBadge provenance={diagram.provenance} />
  </div>;
}
