import { vec3, vec4 } from "gl-matrix";
import type { vec2 } from "gl-matrix";
import { GeomNode, PandaNode, TransformState } from "../nodes";
import { TextGlyph } from "./TextGlyph";

export enum TextAlignment {
  Left = 0,
  Right = 1,
  Center = 2,
}

/**
 * Common interface for text fonts (both static BAM-based and dynamic TTF-based).
 * Mirrors Panda3D's TextFont abstract interface.
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
  private _textWidth = 0;
  private _textHeight = 0;

  constructor(
    private font: TextFont,
    private wordwrapWidth: number = 0,
    private align: TextAlignment = TextAlignment.Left,
  ) {}

  get textWidth(): number {
    return this._textWidth;
  }

  get textHeight(): number {
    return this._textHeight;
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
    this._textWidth = 0;
    this._textHeight = 0;

    if (!text) return;

    const words = this.wordwrapWidth > 0 ? this.splitIntoWords(text) : [text];

    let currentRow: TextRow = {
      glyphs: [],
      width: 0,
      yPos: -this._textHeight,
    };
    let xPos = 0;

    for (const word of words) {
      const wordWidth = this.calcWidth(word);

      if (
        this.wordwrapWidth > 0 &&
        currentRow.glyphs.length > 0 &&
        xPos + wordWidth > this.wordwrapWidth
      ) {
        currentRow.width = xPos;
        this.finishRow(currentRow);
        currentRow = {
          glyphs: [],
          width: 0,
          yPos: -this._textHeight,
        };
        xPos = 0;
      }

      for (const char of word) {
        const charCode = char.charCodeAt(0);

        if (charCode === 32) {
          xPos += this.font.spaceAdvance;
        } else if (charCode === 10) {
          currentRow.width = xPos;
          this.finishRow(currentRow);
          currentRow = {
            glyphs: [],
            width: 0,
            yPos: -this._textHeight,
          };
          xPos = 0;
        } else {
          const glyph = this.getGlyphForChar(charCode);
          if (glyph) {
            currentRow.glyphs.push({ glyph, xPos });
            xPos += glyph.advance;
          }
        }
      }
    }

    if (currentRow.glyphs.length > 0 || this.rows.length === 0) {
      currentRow.width = xPos;
      this.finishRow(currentRow);
    }

    this.applyAlignment();
  }

  generateGeometry(
    textColor: vec4,
    shadowColor: vec4 | null = null,
    shadowOffset: vec2 | null = null,
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

  private splitIntoWords(text: string): string[] {
    const words: string[] = [];
    let current = "";

    for (const char of text) {
      current += char;
      if (char === " " || char === "\n") {
        words.push(current);
        current = "";
      }
    }

    if (current) words.push(current);
    return words;
  }

  private finishRow(row: TextRow): void {
    this.rows.push(row);
    this._textWidth = Math.max(this._textWidth, row.width);
    this._textHeight += this.font.lineHeight;
  }

  private applyAlignment(): void {
    for (const row of this.rows) {
      let offset = 0;

      switch (this.align) {
        case TextAlignment.Left:
          offset = 0;
          break;
        case TextAlignment.Center:
          offset = -row.width / 2;
          break;
        case TextAlignment.Right:
          offset = -row.width;
          break;
      }

      for (const glyph of row.glyphs) {
        glyph.xPos += offset;
      }
    }
  }

  private createGlyphNode(
    glyph: TextGlyph,
    x: number,
    y: number,
    color: vec4,
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
