// The Windows app carries the coord command as one file, resources/agent/command.pack, in place of
// its command/ folder (scripts/agent-payload.cjs's packCommand): the installer spends its time per
// file, and the command's thousands of small files made every update minutes slower. The agent
// folder unpacks it.
//
// The file is a 4-byte big-endian length, an index of that length as JSON ([{ path, size, mode }],
// paths relative with forward slashes), then each file's bytes in the index's order.
import { chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

export const packName = 'command.pack';

interface Entry { path: string; size: number; mode: number }

/** A relative path of plain names, which cannot leave the folder it is unpacked into. */
const inside = (relative: string) => /^[^/\\:\0]+(?:\/[^/\\:\0]+)*$/.test(relative) && !relative.split('/').some(name => name === '.' || name === '..');

function readIndex(text: string): Entry[] {
  const index = JSON.parse(text) as unknown;
  if (!Array.isArray(index) || !index.every(entry => typeof entry?.path === 'string' && inside(entry.path) && Number.isSafeInteger(entry.size) && entry.size >= 0 && Number.isInteger(entry.mode)))
    throw new Error(`${packName} has no index of files inside it`);
  return index as Entry[];
}

/** Unpack a pack into `destination`, creating it. */
export async function unpack(file: string, destination: string) {
  const pack = await open(file, 'r');
  try {
    const read = async (buffer: Buffer, length: number, position: number) => {
      const { bytesRead } = await pack.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error(`${packName} ends early`);
    };
    const length = Buffer.alloc(4);
    await read(length, 4, 0);
    const header = Buffer.alloc(length.readUInt32BE(0));
    await read(header, header.length, 4);
    const chunk = Buffer.allocUnsafe(1 << 20);
    const folders = new Set<string>();
    let position = 4 + header.length;
    for (const entry of readIndex(header.toString('utf8'))) {
      const target = path.join(destination, ...entry.path.split('/'));
      const parent = path.dirname(target);
      if (!folders.has(parent)) { await mkdir(parent, { recursive: true }); folders.add(parent); }
      const out = await open(target, 'w', entry.mode & 0o777);
      try {
        for (let done = 0; done < entry.size;) {
          const size = Math.min(chunk.length, entry.size - done);
          await read(chunk, size, position + done);
          for (let written = 0; written < size;) written += (await out.write(chunk, written, size - written)).bytesWritten;
          done += size;
        }
      } finally { await out.close(); }
      // The mode a file is created with passes through the umask: the Node.js binary must stay executable.
      if (process.platform !== 'win32') await chmod(target, entry.mode & 0o777);
      position += entry.size;
    }
  } finally { await pack.close(); }
}
