import { type ReadonlyVec2, type ReadonlyVec4, vec2, vec4 } from "gl-matrix";
import { PandaNode } from "../nodes";
import { TextAlignment, TextAssembler, type TextFont } from "./TextAssembler";

export class TextNode {
  private _text = "";
  private _font: TextFont | null = null;
  private _textColor: vec4 = vec4.fromValues(1, 1, 1, 1);
  private _shadowColor: vec4 | null = null;
  private _shadowOffset: vec2 | null = null;
  private _wordwrap = 0;
  private _align: TextAlignment = TextAlignment.Left;
  private _lineHeight: number | null = null;

  private dirty = true;
  private assembler: TextAssembler | null = null;

  constructor(public readonly name: string) {}

  get text(): string {
    return this._text;
  }
  set text(value: string) {
    this._text = value;
    this.dirty = true;
  }

  get font(): TextFont | null {
    return this._font;
  }
  set font(value: TextFont | null) {
    this._font = value;
    this.dirty = true;
  }

  get wordwrap(): number {
    return this._wordwrap;
  }
  set wordwrap(value: number) {
    this._wordwrap = value;
    this.dirty = true;
  }

  get align(): TextAlignment {
    return this._align;
  }
  set align(value: TextAlignment) {
    this._align = value;
    this.dirty = true;
  }

  get textColor(): ReadonlyVec4 {
    return this._textColor;
  }
  set textColor(value: ReadonlyVec4) {
    vec4.copy(this._textColor, value);
  }

  get shadowColor(): ReadonlyVec4 | null {
    return this._shadowColor;
  }
  set shadowColor(value: ReadonlyVec4 | null) {
    this._shadowColor = value ? vec4.clone(value) : null;
  }

  get shadowOffset(): ReadonlyVec2 | null {
    return this._shadowOffset;
  }
  set shadowOffset(value: ReadonlyVec2 | null) {
    this._shadowOffset = value ? vec2.clone(value) : null;
  }

  get lineHeight(): number {
    if (this._lineHeight !== null) return this._lineHeight;
    return this._font?.lineHeight ?? 1.0;
  }
  set lineHeight(value: number | null) {
    this._lineHeight = value;
    this.dirty = true;
  }

  get width(): number {
    this.ensureAssembled();
    if (!this.assembler) return 0;
    return this.assembler.lr[0] - this.assembler.ul[0];
  }

  get height(): number {
    this.ensureAssembled();
    if (!this.assembler) return 0;
    return this.assembler.ul[1] - this.assembler.lr[1];
  }

  /** Upper-left corner of text bounds (x=left edge, y=top edge) */
  get ul(): readonly [number, number] {
    this.ensureAssembled();
    return this.assembler?.ul ?? [0, 0];
  }

  /** Lower-right corner of text bounds (x=right edge, y=bottom edge) */
  get lr(): readonly [number, number] {
    this.ensureAssembled();
    return this.assembler?.lr ?? [0, 0];
  }

  /**
   * Returns the text frame as (left, right, bottom, top).
   */
  get frame(): readonly [number, number, number, number] {
    this.ensureAssembled();
    return this.assembler?.frame ?? [0, 0, 0, 0];
  }

  generate(): PandaNode {
    this.ensureAssembled();
    if (!this.assembler) {
      return PandaNode.create(this.name);
    }
    const node = this.assembler.generateGeometry(
      this._textColor,
      this._shadowColor,
      this._shadowOffset,
    );
    node.name = this.name;
    return node;
  }

  private ensureAssembled(): void {
    if (!this.dirty && this.assembler) return;
    if (!this._font) {
      this.assembler = null;
      return;
    }

    this.assembler = new TextAssembler(
      this._font,
      this._wordwrap,
      this._align,
      this._lineHeight,
    );
    this.assembler.assembleText(this._text);
    this.dirty = false;
  }
}
