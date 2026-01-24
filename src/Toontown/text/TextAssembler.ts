import type { ReadonlyVec2, ReadonlyVec4 } from "gl-matrix";
import { vec3 } from "gl-matrix";
import { GeomNode, PandaNode, TransformState } from "../nodes";
import type { TextGlyph } from "./TextGlyph";

export enum TextAlignment {
  Left = 0,
  Right = 1,
  Center = 2,
}

/**
 * Common interface for text fonts (both static BAM-based and dynamic TTF-based).
 */
export interface TextFont {
  /** Height of a line of text, in font units */
  readonly lineHeight: number;
  /** Horizontal advance for a space character */
  readonly spaceAdvance: number;
  /** Get a glyph for the given Unicode code point, or null if not found */
  getGlyph(charCode: number): TextGlyph | null;
}

type PositionedGlyph = {
  glyph: TextGlyph;
  xPos: number;
};

type TextRow = {
  glyphs: PositionedGlyph[];
  width: number;
  yPos: number;
};

export class TextAssembler {
  private rows: TextRow[] = [];
  /** Upper-left corner of text bounds (x=left edge, y=top edge) */
  private _ul: [number, number] = [0, 0];
  /** Lower-right corner of text bounds (x=right edge, y=bottom edge) */
  private _lr: [number, number] = [0, 0];

  constructor(
    private font: TextFont,
    private wordwrapWidth: number = 0,
    private align: TextAlignment = TextAlignment.Left,
    private lineHeightOverride: number | null = null,
  ) {}

  /** Upper-left corner of text bounds (x=left edge, y=top edge) */
  get ul(): readonly [number, number] {
    return this._ul;
  }

  /** Lower-right corner of text bounds (x=right edge, y=bottom edge) */
  get lr(): readonly [number, number] {
    return this._lr;
  }

  /**
   * Returns the text frame as (left, right, bottom, top).
   */
  get frame(): readonly [number, number, number, number] {
    return [this._ul[0], this._lr[0], this._lr[1], this._ul[1]];
  }

  calcWidth(text: string): number {
    let width = 0;
    for (const char of text) {
      const charCode = char.charCodeAt(0);
      if (charCode === 32) {
        width += this.font.spaceAdvance;
      } else {
        const glyph = this.getGlyphForChar(charCode);
        if (glyph) width += glyph.advance;
      }
    }
    return width;
  }

  assembleText(text: string): void {
    this.rows = [];
    this._ul = [0, 0];
    this._lr = [0, 0];

    if (!text) return;

    const lineHeight =
      this.lineHeightOverride !== null
        ? this.lineHeightOverride
        : this.font.lineHeight;

    // First pass: word wrap text into lines
    const lines = this.wordwrapText(text);

    // Second pass: assemble rows with positioned glyphs
    let yPos = 0;
    let numRows = 0;

    for (const line of lines) {
      if (numRows === 0) {
        this._ul[1] = 0.8 * lineHeight;
      } else {
        yPos -= lineHeight;
      }

      const row = this.assembleRow(line, yPos);
      this.rows.push(row);

      this._lr[1] = yPos - 0.2 * lineHeight;
      numRows++;
    }

    // Ensure at least one row exists
    if (this.rows.length === 0) {
      this.rows.push({ glyphs: [], width: 0, yPos: 0 });
      this._ul[1] = 0.8 * lineHeight;
      this._lr[1] = -0.2 * lineHeight;
    }

    this.applyAlignment();
  }

  /**
   * Split text into lines, handling word wrap and trimming trailing whitespace.
   */
  private wordwrapText(text: string): string[] {
    if (this.wordwrapWidth <= 0) {
      // No word wrap - split only on newlines
      return text.split("\n");
    }

    const lines: string[] = [];
    let p = 0;

    while (p < text.length) {
      // Skip leading whitespace (but not newlines) and track its width
      let initialWidth = 0;
      const lineStart = p;
      while (p < text.length && text[p] === " ") {
        initialWidth += this.font.spaceAdvance;
        p++;
      }

      // Handle leading newlines
      if (p < text.length && text[p] === "\n") {
        lines.push(text.substring(lineStart, p));
        p++;
        continue;
      }

      // Scan forward to find where to break
      let q = p;
      let lastSpace = -1;
      let width = initialWidth;

      while (q < text.length && text[q] !== "\n") {
        const charCode = text.charCodeAt(q);

        if (charCode === 32) {
          // Space - record as potential break point
          lastSpace = q;
        }

        // Add character width
        if (charCode === 32) {
          width += this.font.spaceAdvance;
        } else {
          const glyph = this.getGlyphForChar(charCode);
          if (glyph) width += glyph.advance;
        }

        q++;

        // Check if we've exceeded wordwrap width
        if (width > this.wordwrapWidth && q > p + 1) {
          q--;
          // Try to break at a space
          if (lastSpace > p) {
            q = lastSpace;
          }
          break;
        }
      }

      // Find where next line starts (skip whitespace after break point)
      let nextStart = q;
      while (nextStart < text.length && text[nextStart] === " ") {
        nextStart++;
      }

      // Trim trailing whitespace from this line
      while (q > lineStart && text[q - 1] === " ") {
        q--;
      }

      // Add the line (from lineStart to q, trimmed)
      lines.push(text.substring(lineStart, q));

      // Handle newline at break point
      if (nextStart < text.length && text[nextStart] === "\n") {
        nextStart++;
      }

      p = nextStart;
    }

    // Handle trailing newline
    if (text.length > 0 && text[text.length - 1] === "\n") {
      lines.push("");
    }

    return lines.length > 0 ? lines : [""];
  }

  /**
   * Assemble a single row of text into positioned glyphs.
   */
  private assembleRow(line: string, yPos: number): TextRow {
    const glyphs: PositionedGlyph[] = [];
    let xPos = 0;

    for (const char of line) {
      const charCode = char.charCodeAt(0);

      if (charCode === 32) {
        xPos += this.font.spaceAdvance;
      } else if (charCode !== 10) {
        const glyph = this.getGlyphForChar(charCode);
        if (glyph) {
          glyphs.push({ glyph, xPos });
          xPos += glyph.advance;
        }
      }
    }

    return { glyphs, width: xPos, yPos };
  }

  generateGeometry(
    textColor: ReadonlyVec4,
    shadowColor: ReadonlyVec4 | null = null,
    shadowOffset: ReadonlyVec2 | null = null,
  ): PandaNode {
    const root = PandaNode.create("text");

    if (shadowColor && shadowOffset) {
      for (const row of this.rows) {
        for (const { glyph, xPos } of row.glyphs) {
          if (!glyph.geom) continue;
          const shadowNode = this.createGlyphNode(
            glyph,
            xPos - shadowOffset[0],
            row.yPos - shadowOffset[1],
            shadowColor,
          );
          root.addChild(shadowNode);
        }
      }
    }

    for (const row of this.rows) {
      for (const { glyph, xPos } of row.glyphs) {
        if (!glyph.geom) continue;
        const glyphNode = this.createGlyphNode(
          glyph,
          xPos,
          row.yPos,
          textColor,
        );
        root.addChild(glyphNode);
      }
    }

    return root;
  }

  private applyAlignment(): void {
    for (const row of this.rows) {
      let xOffset = 0;

      switch (this.align) {
        case TextAlignment.Left:
          xOffset = 0;
          this._lr[0] = Math.max(this._lr[0], row.width);
          break;
        case TextAlignment.Right:
          xOffset = -row.width;
          this._ul[0] = Math.min(this._ul[0], xOffset);
          break;
        case TextAlignment.Center:
          xOffset = -row.width / 2;
          this._ul[0] = Math.min(this._ul[0], xOffset);
          this._lr[0] = Math.max(this._lr[0], -xOffset);
          break;
      }

      for (const glyph of row.glyphs) {
        glyph.xPos += xOffset;
      }
    }
  }

  private createGlyphNode(
    glyph: TextGlyph,
    x: number,
    y: number,
    color: ReadonlyVec4,
  ): GeomNode {
    const geomCopy = glyph.geom!.clone();
    const geomNode = new GeomNode();
    geomNode.name = "glyph";
    geomNode.geoms.push({ geom: geomCopy, state: glyph.state });
    geomNode.transform = TransformState.fromPos(vec3.fromValues(x, 0, y));
    geomNode.setColor(color);
    return geomNode;
  }

  private getGlyphForChar(charCode: number): TextGlyph | null {
    const glyph = this.font.getGlyph(charCode);
    if (glyph) return glyph;
    // Try uppercase glyph if lowercase glyph doesn't exist
    if (charCode >= 97 && charCode <= 122) {
      return this.font.getGlyph(charCode - 32);
    }
    return null;
  }
}
