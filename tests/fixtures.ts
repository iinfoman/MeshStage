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
  /** A face: round, two eyes above a mouth, on a flat white background. */
  face: string;
  /** A standing figure: much taller than wide. */
  figure: string;
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

  // A face on flat white, in a tall frame — the shape of a phone screenshot,
  // which is how most people actually send a mascot.
  const face = encodePng(size, (x, y) => {
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.34;
    if (Math.hypot(x - cx, y - cy) > radius) return [255, 255, 255, 255];

    const eyeY = cy - radius * 0.24;
    for (const side of [-1, 1]) {
      if (Math.hypot(x - (cx + side * radius * 0.36), y - eyeY) < radius * 0.15) {
        return [26, 18, 16, 255];
      }
    }
    // Mouth: a warm dark band low on the face.
    if (Math.abs(x - cx) < radius * 0.38 && Math.abs(y - (cy + radius * 0.36)) < radius * 0.14) {
      return [150, 22, 30, 255];
    }
    return [255, 150, 30, 255];
  });

  const figure = encodePng(size, (x, y) => {
    const cx = size / 2;
    // Deliberately narrow so the corrected aspect reads as a standing figure.
    if (y < size * 0.18 && Math.abs(x - cx) < size * 0.09) return [60, 70, 110, 255];
    if (y >= size * 0.18 && y < size * 0.62 && Math.abs(x - cx) < size * 0.14) {
      return [40, 120, 190, 255];
    }
    if (y >= size * 0.62 && Math.abs(x - cx) < size * 0.11) return [30, 40, 80, 255];
    return [0, 0, 0, 0];
  }, 96);

  const paths = {
    mascotWarm: join(dir, 'mascot-warm.png'),
    mascotCool: join(dir, 'mascot-cool.png'),
    mascotWarmRenamed: join(dir, 'totally-different-name.png'),
    face: join(dir, 'face.png'),
    figure: join(dir, 'figure.png'),
  };

  writeFileSync(paths.mascotWarm, warm);
  writeFileSync(paths.mascotCool, cool);
  writeFileSync(paths.mascotWarmRenamed, warm);
  writeFileSync(paths.face, face);
  writeFileSync(paths.figure, figure);

  return paths;
}

/**
 * Builds a valid GLB with named viseme morph targets, to stand in for what an
 * image-to-3D provider returns.
 *
 * Written by hand rather than exported from three: the point of the test that
 * consumes this is that the app loads a *foreign* file correctly, and a file
 * produced by the same library the app loads it with would not prove that.
 * It is also the only way to assert the blendshape-discovery path without
 * committing a binary to the repo.
 */
export function buildGlbWithVisemes(targetNames: string[] = ['viseme_AA', 'viseme_O']): Buffer {
  // A unit cube centred on the origin, non-indexed faces avoided by using an
  // index buffer — smaller, and it exercises the loader's accessor handling.
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
  ]);
  // Wound counter-clockwise as seen from outside each face. Get this wrong and
  // backface culling hides the near side, so the viewport shows the inside of
  // the box — which looks like a framing bug and is not one.
  const indices = new Uint16Array([
    4, 5, 6, 4, 6, 7, // +Z
    1, 0, 3, 1, 3, 2, // -Z
    0, 4, 7, 0, 7, 3, // -X
    5, 1, 2, 5, 2, 6, // +X
    7, 6, 2, 7, 2, 3, // +Y
    0, 1, 5, 0, 5, 4, // -Y
  ]);

  const chunks: Buffer[] = [Buffer.from(positions.buffer.slice(0))];
  const accessors: unknown[] = [
    {
      bufferView: 0,
      componentType: 5126, // FLOAT
      count: positions.length / 3,
      type: 'VEC3',
      // Required on POSITION by the spec, and three's loader uses it.
      min: [-0.5, 0, -0.5],
      max: [0.5, 1, 0.5],
    },
  ];
  const bufferViews: unknown[] = [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }];
  let offset = positions.byteLength;

  // One delta set per viseme, each nudging the top face in a different axis so
  // a driven morph is visibly distinct from an undriven one.
  targetNames.forEach((_, index) => {
    const deltas = new Float32Array(positions.length);
    for (let vertex = 4; vertex < 8; vertex += 1) {
      deltas[vertex * 3 + (index % 3)] = 0.25;
    }
    chunks.push(Buffer.from(deltas.buffer.slice(0)));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: deltas.byteLength });
    const min = [0, 1, 2].map((axis) =>
      Math.min(...Array.from({ length: deltas.length / 3 }, (_, v) => deltas[v * 3 + axis])),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...Array.from({ length: deltas.length / 3 }, (_, v) => deltas[v * 3 + axis])),
    );
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: deltas.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    offset += deltas.byteLength;
  });

  chunks.push(Buffer.from(indices.buffer.slice(0)));
  bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: indices.byteLength,
    target: 34963, // ELEMENT_ARRAY_BUFFER
  });
  const indexAccessor = accessors.length;
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType: 5123, // UNSIGNED_SHORT
    count: indices.length,
    type: 'SCALAR',
  });
  offset += indices.byteLength;

  const gltf = {
    asset: { version: '2.0', generator: 'MeshStage test fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'ProviderMesh' }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: indexAccessor,
            targets: targetNames.map((_, index) => ({ POSITION: index + 1 })),
          },
        ],
        weights: targetNames.map(() => 0),
        // glTF has no first-class name for a morph target; `targetNames` in
        // mesh extras is the de-facto convention, and what three reads to
        // populate `morphTargetDictionary`.
        extras: { targetNames },
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const pad = (buffer: Buffer, filler: number) => {
    const remainder = buffer.length % 4;
    return remainder === 0
      ? buffer
      : Buffer.concat([buffer, Buffer.alloc(4 - remainder, filler)]);
  };

  const json = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const bin = pad(Buffer.concat(chunks), 0x00);

  const chunkHeader = (length: number, type: number) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(length, 0);
    header.writeUInt32LE(type, 4);
    return header;
  };

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);

  return Buffer.concat([
    header,
    chunkHeader(json.length, 0x4e4f534a), // JSON
    json,
    chunkHeader(bin.length, 0x004e4942), // BIN
    bin,
  ]);
}
