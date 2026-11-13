import { Kbd, SegmentedControl, Select, Text, Tooltip } from '@envsemble/envui';
import { IconLayers } from '@envsemble/envui/icons/Layers';
import { IconDifference } from '@envsemble/envui/icons/Difference';
import { IconPhotoCamera } from '@envsemble/envui/icons/PhotoCamera';
import type { Layer } from './layers';

/**
 * A diagram's layers, in the diagram's top left: one segment per file of its family, the one shown
 * chosen, and the name of the layer shown. `[` and `]` step through them too, as its tooltip says.
 * A family of more layers than a segmented control holds chooses in a select.
 */
export function LayerMarker({ layers, value, onChange }: { layers: Layer[]; value: string; onChange(path: string): void }) {
  const current = layers.find(layer => layer.path === value) ?? layers[0];
  const items = layers.map(layer => ({ value: layer.path, label: layer.label, icon: layer.kind === 'capture' ? <IconPhotoCamera /> : <IconDifference /> }));
  return <div className="layer-marker">
    <Tooltip content={<>Layers of this diagram. <Kbd>[</Kbd> and <Kbd>]</Kbd> switch between them.</>} side="bottom">
      <span className="layer-marker-icon" aria-hidden="true"><IconLayers /></span>
    </Tooltip>
    {items.length <= 5
      ? <SegmentedControl size="sm" aria-label="Layer" items={items} value={current.path} onValueChange={next => next && onChange(next)} />
      : <Select size="sm" aria-label="Layer" items={items.map(({ value: path, label }) => ({ value: path, label }))} value={current.path} onValueChange={next => next && onChange(next)} />}
    <Text render={<span />} emphasis="muted" className="layer-marker-title" title={current.title}>{current.title}</Text>
  </div>;
}
