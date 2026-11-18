import PDFDocument from 'pdfkit';

const FOREST = '#173C2E';
const INK = '#121614';
const MUTED = '#5B635E';
const LINE = '#E1E4DD';
const DRAFT = '#8A2412';

/**
 * Render an agreement body (see template.ts for its three markers) as an A4
 * PDF. `footer` goes at the foot of every page: who accepted it and when, or
 * signature lines for a copy to be signed at a branch.
 */
export function agreementPdf(body: string, footer: string[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 72, left: 56, right: 56 },
    info: { Title: 'Loan agreement and Key Facts', Author: 'Loan agreement' },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) {
      doc.font('Helvetica-Bold').fontSize(20).fillColor(FOREST).text(line.slice(2));
      doc.moveDown(0.4);
    } else if (line.startsWith('## ')) {
      // Never leave a heading alone at the foot of a page.
      if (doc.y + 90 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      else doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(FOREST).text(line.slice(3));
      doc.moveDown(0.3);
    } else if (line.startsWith('| ')) {
      const [label = '', value = ''] = line.slice(2).split(' | ');
      const y = doc.y;
      const labelWidth = width * 0.48;
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      const h1 = doc.heightOfString(label, { width: labelWidth - 8 });
      doc.font('Helvetica-Bold');
      const h2 = doc.heightOfString(value, { width: width - labelWidth });
      if (y + Math.max(h1, h2) + 8 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const top = doc.y;
      doc
        .font('Helvetica')
        .fillColor(MUTED)
        .text(label, left, top, { width: labelWidth - 8 });
      doc
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(value, left + labelWidth, top, { width: width - labelWidth });
      const bottom = top + Math.max(h1, h2) + 4;
      doc
        .moveTo(left, bottom)
        .lineTo(left + width, bottom)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
      doc.x = left;
      doc.y = bottom + 4;
    } else if (line.startsWith('DRAFT')) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DRAFT).text(line, { width });
    } else if (line === '') {
      doc.moveDown(0.5);
    } else {
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(line, { width, lineGap: 2 });
    }
  }

  // Footer and page numbers on every page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 56;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${footer.join('  ·  ')}  ·  Page ${i + 1} of ${range.count}`, left, y, {
        width,
        align: 'center',
      });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}
