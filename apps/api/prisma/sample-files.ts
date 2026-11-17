/**
 * Small, valid sample files for the development seed, so an officer can open,
 * verify and reject documents in the console without anyone uploading first.
 * Clearly marked SAMPLE; no real person's papers.
 */
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

type Rgb = [number, number, number];

/** A 480×300 PNG that looks like an ID card: header band, photo box and text lines. */
export function sampleIdCardPng(): Buffer {
  const w = 480;
  const h = 300;
  const px = (x: number, y: number): Rgb => {
    const inCard = x > 8 && x < w - 8 && y > 8 && y < h - 8;
    if (!inCard) return [244, 245, 241];
    if (y < 64) return [14, 59, 46]; // forest header
    if (y > 70 && y < 76 && x > 24 && x < 200) return [198, 244, 50]; // lime rule
    if (x > 60 && x < 116 && y > 120 && y < 176) return [168, 176, 164]; // head
    if (x > 44 && x < 132 && y > 184 && y < 252) return [168, 176, 164]; // shoulders
    if (x > 28 && x < 148 && y > 92 && y < 252) return [214, 220, 210]; // photo
    for (const [top, len] of [
      [104, 230],
      [132, 180],
      [160, 260],
      [188, 150],
      [216, 210],
    ] as const) {
      if (y > top && y < top + 12 && x > 172 && x < 172 + len) return [91, 99, 94];
    }
    return [255, 255, 255];
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a few lines of text and correct cross-references. */
export function samplePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 60 ${740 - i * 28} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
