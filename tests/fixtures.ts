import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Generates PNG fixtures at test time rather than committing binaries.
 *
 * The palettes are deliberately far apart so an assertion that two uploads
 * produce different characters cannot pass by luck.
 */
function encodePng(size: number, draw: (x: number, y: number) => [number, number, number, number]) {
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = draw(x, y);
      row[1 + x * 4] = r;
      row[2 + x * 4] = g;
      row[3 + x * 4] = b;
      row[4 + x * 4] = a;
    }
    rows.push(row);
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Fixtures {
  /** Orange disc with a magenta star, transparent background. */
  mascotWarm: string;
  /** Teal square with a navy band, transparent corners. */
  mascotCool: string;
  /** Byte-identical to mascotWarm, saved under a different name. */
  mascotWarmRenamed: string;
}

export function writeFixtures(): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), 'meshstage-fixtures-'));
  const size = 192;

  const warm = encodePng(size, (x, y) => {
    const cx = size / 2;
    const d = Math.hypot(x - cx, y - cx);
    if (d > size * 0.42) return [0, 0, 0, 0];
    const angle = Math.atan2(y - cx, x - cx);
    const star = size * 0.16 + size * 0.09 * Math.cos(5 * angle);
    return d < star ? [233, 30, 160, 255] : [255, 138, 24, 255];
  });

  const cool = encodePng(size, (x, y) => {
    const margin = size * 0.14;
    if (x < margin || x > size - margin || y < margin || y > size - margin) return [0, 0, 0, 0];
    if (y > size * 0.42 && y < size * 0.58) return [18, 32, 92, 255];
    return [26, 196, 186, 255];
  });

  const paths = {
    mascotWarm: join(dir, 'mascot-warm.png'),
    mascotCool: join(dir, 'mascot-cool.png'),
    mascotWarmRenamed: join(dir, 'totally-different-name.png'),
  };

  writeFileSync(paths.mascotWarm, warm);
  writeFileSync(paths.mascotCool, cool);
  writeFileSync(paths.mascotWarmRenamed, warm);

  return paths;
}
