// Reading a planning folder's registry, planning.json: its work items and the folders the project
// covers. Changing it keeps its text as written (registryText.ts).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { absoluteFolder } from '../check/check.ts';

export interface RegistryEntry { id?: unknown; path?: unknown; current_plan?: unknown }
/** A planning folder's work items and folders (the absolute paths of this computer's form; `atlas check` warns of the others), as planning.json lists them. */
export async function readRegistry(root: string): Promise<{ work_items: RegistryEntry[]; folders: string[] }> {
  const registry = JSON.parse((await readFile(path.join(root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, ''));
  return {
    work_items: Array.isArray(registry?.work_items) ? registry.work_items : [],
    folders: Array.isArray(registry?.folders) ? registry.folders.filter(absoluteFolder) : [],
  };
}
