/** Offline Bengali-safe PDF engine: HarfBuzz shaping + pdf-lib glyph embedding.
 * Correctly renders যুক্তাক্ষর, কার, ফলা and mixed Bengali/English. Pure Node. */
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFOperator, PDFName, PDFNumber, PDFHexString, PDFArray, PDFRawStream, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Blob as HBBlob, Face, Font as HBFont, Buffer as HBBuffer, shape } from 'harfbuzzjs';

export interface FontSet { regular: Uint8Array; semibold?: Uint8Array; bold?: Uint8Array; }
export type FontVariant = 'regular' | 'semibold' | 'bold';
export interface RGB { r: number; g: number; b: number; }

const SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  receipt80: [226.77, 841.89], // 80mm wide, continuous height trimmed later
  receipt58: [164.41, 841.89], // 58mm
};

class ShapedFont {
  hbFont: HBFont; face: Face; blob: HBBlob; upem: number;
  fk: any; embedded!: PDFFont; refName = '';
  constructor(public data: Uint8Array, fkCreate: (d: Uint8Array) => any) {
    this.blob = new HBBlob(data);
    this.face = new Face(this.blob, 0);
    this.upem = (this.face as any).upem ?? 1000;
    this.hbFont = new HBFont(this.face);
    this.hbFont.setScale(this.upem, this.upem);
    this.fk = fkCreate(data);
  }
  shape(text: string) {
    const buf = new HBBuffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    shape(this.hbFont, buf);
    const infos = buf.getGlyphInfos();
    const pos = buf.getGlyphPositions();
    const glyphs = infos.map((g, i) => ({ id: g.codepoint, ax: pos[i]!.xAdvance, xo: pos[i]!.xOffset, yo: pos[i]!.yOffset }));
    (buf as any).destroy?.();
    return glyphs;
  }
  advanceWidth(gid: number): number {
    try { return this.fk.getGlyph(gid).advanceWidth; } catch { return this.upem * 0.5; }
  }
  measure(text: string, size: number): number {
    const scale = size / this.upem;
    return this.shape(text).reduce((w, g) => w + g.ax * scale, 0);
  }
}

export class PdfDocument {
  private doc!: PDFDocument;
  private fonts: Record<FontVariant, ShapedFont> = {} as any;
  private page!: PDFPage;
  private fontCounter = 0;
  private pageW = 595.28; private pageH = 841.89;
  margin = 40;
  private y = 0;
  private pageCount = 0;
  title = '';

  private constructor() {}

  static async create(fonts: FontSet, opts: { title?: string } = {}): Promise<PdfDocument> {
    const d = new PdfDocument();
    d.title = opts.title ?? '';
    d.doc = await PDFDocument.create();
    d.doc.registerFontkit(fontkit);
    if (opts.title) d.doc.setTitle(opts.title);
    d.doc.setProducer('Ponno');
    const fkCreate = (data: Uint8Array) => fontkit.create(data);
    d.fonts.regular = new ShapedFont(fonts.regular, fkCreate);
    d.fonts.semibold = new ShapedFont(fonts.semibold ?? fonts.regular, fkCreate);
    d.fonts.bold = new ShapedFont(fonts.bold ?? fonts.semibold ?? fonts.regular, fkCreate);
    for (const v of ['regular', 'semibold', 'bold'] as FontVariant[]) {
      const f = d.fonts[v];
      f.embedded = await d.doc.embedFont(f.data, { subset: false });
      f.refName = `F${++d.fontCounter}`;
    }
    return d;
  }

  addPage(size: keyof typeof SIZES | [number, number] = 'A4', margin = 40): this {
    const [w, h] = Array.isArray(size) ? size : SIZES[size] ?? SIZES.A4!;
    this.pageW = w; this.pageH = h; this.margin = margin;
    this.page = this.doc.addPage([w, h]);
    this.pageCount++;
    // register font resources
    const fontObj: any = {};
    for (const v of ['regular', 'semibold', 'bold'] as FontVariant[]) fontObj[this.fonts[v].refName] = this.fonts[v].embedded.ref;
    this.page.node.set(PDFName.of('Resources'), this.doc.context.obj({ Font: fontObj }));
    this.y = h - margin;
    return this;
  }

  get cursorY() { return this.y; }
  get width() { return this.pageW; }
  get contentWidth() { return this.pageW - this.margin * 2; }
  get pageNumber() { return this.pageCount; }

  ensureSpace(needed: number, size: keyof typeof SIZES | [number, number] = 'A4'): void {
    if (this.y - needed < this.margin) this.addPage(size, this.margin);
  }

  private mkArray(items: Array<PDFHexString | PDFNumber>): PDFArray {
    const arr = PDFArray.withContext(this.doc.context);
    for (const it of items) arr.push(it);
    return arr;
  }

  /** Draw shaped text at absolute coordinates. Returns drawn width. */
  drawText(text: string, x: number, y: number, opts: { size?: number; variant?: FontVariant; color?: RGB } = {}): number {
    const size = opts.size ?? 11;
    const variant = opts.variant ?? 'regular';
    const color = opts.color ?? { r: 0.1, g: 0.13, b: 0.2 };
    const f = this.fonts[variant];
    const scale = size / f.upem;
    const glyphs = f.shape(text);
    if (!glyphs.length) return 0;
    // Per-glyph absolute positioning (Tm + Tj). This is the correct approach for
    // complex scripts: HarfBuzz reorders Bengali vowel signs and emits zero-advance
    // combining marks; absolute positioning honors shaped advances/offsets exactly.
    const ops: PDFOperator[] = [];
    ops.push(PDFOperator.of('q', []));
    ops.push(PDFOperator.of('BT', []));
    ops.push(PDFOperator.of('Tf', [PDFName.of(f.refName), PDFNumber.of(size)]));
    ops.push(PDFOperator.of('rg', [PDFNumber.of(color.r), PDFNumber.of(color.g), PDFNumber.of(color.b)]));
    let pen = x;
    for (const g of glyphs) {
      const gx = pen + g.xo * scale;
      const gy = y + g.yo * scale;
      ops.push(PDFOperator.of('Tm', [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1), PDFNumber.of(round2(gx)), PDFNumber.of(round2(gy))]));
      ops.push(PDFOperator.of('Tj', [PDFHexString.of(g.id.toString(16).padStart(4, '0'))]));
      pen += g.ax * scale;
    }
    ops.push(PDFOperator.of('ET', []));
    ops.push(PDFOperator.of('Q', []));
    this.page.pushOperators(...ops);
    return pen - x;
  }

  /** Draw text aligned within the content width at current cursor; advances cursor by lineHeight. */
  text(text: string, opts: { size?: number; variant?: FontVariant; color?: RGB; align?: 'left' | 'center' | 'right'; lineHeight?: number; x?: number; maxWidth?: number } = {}): this {
    const size = opts.size ?? 11;
    const lh = opts.lineHeight ?? size * 1.5;
    const f = this.fonts[opts.variant ?? 'regular'];
    const maxWidth = opts.maxWidth ?? this.contentWidth;
    const lines = this.wrap(text, maxWidth, size, opts.variant ?? 'regular');
    for (const line of lines) {
      this.ensureSpace(lh);
      const w = f.measure(line, size);
      let x = this.margin;
      if (opts.align === 'center') x = this.margin + (maxWidth - w) / 2;
      else if (opts.align === 'right') x = this.margin + maxWidth - w;
      if (opts.x !== undefined) x = opts.x;
      this.drawText(line, x, this.y - size, { size, variant: opts.variant, color: opts.color });
      this.y -= lh;
    }
    return this;
  }

  wrap(text: string, maxWidth: number, size: number, variant: FontVariant): string[] {
    const f = this.fonts[variant];
    const out: string[] = [];
    for (const paragraph of String(text).split('\n')) {
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (f.measure(test, size) <= maxWidth || !line) line = test;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  space(h = 8): this { this.y -= h; return this; }

  line(color: RGB = { r: 0.85, g: 0.87, b: 0.9 }): this {
    this.ensureSpace(2);
    this.page.pushOperators(
      PDFOperator.of('q', []),
      PDFOperator.of('RG', [PDFNumber.of(color.r), PDFNumber.of(color.g), PDFNumber.of(color.b)]),
      PDFOperator.of('w', [PDFNumber.of(0.7)]),
      PDFOperator.of('m', [PDFNumber.of(this.margin), PDFNumber.of(round2(this.y))]),
      PDFOperator.of('l', [PDFNumber.of(this.pageW - this.margin), PDFNumber.of(round2(this.y))]),
      PDFOperator.of('S', []),
      PDFOperator.of('Q', []),
    );
    this.y -= 6;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB): this {
    this.page.pushOperators(
      PDFOperator.of('q', []),
      PDFOperator.of('rg', [PDFNumber.of(color.r), PDFNumber.of(color.g), PDFNumber.of(color.b)]),
      PDFOperator.of('re', [PDFNumber.of(x), PDFNumber.of(y), PDFNumber.of(w), PDFNumber.of(h)]),
      PDFOperator.of('f', []),
      PDFOperator.of('Q', []),
    );
    return this;
  }

  /** Simple table with header row. columns: {header, width, align}. rows: string[][]. */
  table(columns: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center' }>, rows: string[][], opts: { size?: number; rowHeight?: number } = {}): this {
    const size = opts.size ?? 9.5;
    const rowH = opts.rowHeight ?? size * 1.9;
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    const scale = this.contentWidth / totalW;
    const widths = columns.map((c) => c.width * scale);
    // header
    this.ensureSpace(rowH * 2);
    this.rect(this.margin, this.y - rowH, this.contentWidth, rowH, { r: 0.91, g: 0.95, b: 0.93 });
    let x = this.margin;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]!;
      this.drawText(c.header, x + 4, this.y - size - 3, { size, variant: 'semibold', color: { r: 0.05, g: 0.42, b: 0.31 } });
      x += widths[i]!;
    }
    this.y -= rowH;
    // rows
    for (let r = 0; r < rows.length; r++) {
      this.ensureSpace(rowH);
      if (r % 2 === 1) this.rect(this.margin, this.y - rowH, this.contentWidth, rowH, { r: 0.97, g: 0.98, b: 0.99 });
      x = this.margin;
      for (let i = 0; i < columns.length; i++) {
        const c = columns[i]!;
        const cell = String(rows[r]![i] ?? '');
        const truncated = this.fit(cell, widths[i]! - 8, size);
        const w = this.fonts.regular.measure(truncated, size);
        let cx = x + 4;
        if (c.align === 'right') cx = x + widths[i]! - 4 - w;
        else if (c.align === 'center') cx = x + (widths[i]! - w) / 2;
        this.drawText(truncated, cx, this.y - size - 3, { size });
        x += widths[i]!;
      }
      this.y -= rowH;
    }
    this.space(4);
    return this;
  }

  private fit(text: string, maxWidth: number, size: number): string {
    const f = this.fonts.regular;
    if (f.measure(text, size) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && f.measure(t + '…', size) > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  /** key: value rows, right-aligned values. */
  keyValues(pairs: Array<[string, string]>, opts: { size?: number; bold?: boolean } = {}): this {
    const size = opts.size ?? 11;
    for (const [k, v] of pairs) {
      this.ensureSpace(size * 1.6);
      this.drawText(k, this.margin, this.y - size, { size, variant: 'regular', color: { r: 0.35, g: 0.39, b: 0.45 } });
      const w = this.fonts[opts.bold ? 'semibold' : 'regular'].measure(v, size);
      this.drawText(v, this.pageW - this.margin - w, this.y - size, { size, variant: opts.bold ? 'semibold' : 'regular' });
      this.y -= size * 1.6;
    }
    return this;
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Load the bundled Hind Siliguri fonts. Resolves assets dir relative to this module or PONNO_FONTS_DIR. */
export function loadFontSet(fontsDir?: string): FontSet {
  const dir = fontsDir ?? process.env.PONNO_FONTS_DIR ?? resolveAssetsFonts();
  const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(dir, n)));
  return { regular: read('HindSiliguri-Regular.otf'), semibold: read('HindSiliguri-SemiBold.otf'), bold: read('HindSiliguri-Bold.otf') };
}

function resolveAssetsFonts(): string {
  // module is at packages/core/{src,dist}/pdf → repo root is 4 levels up from src/pdf
  const candidates = [
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../assets/fonts'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../assets/fonts'),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'HindSiliguri-Regular.otf'))) return c;
  return candidates[0]!;
}
