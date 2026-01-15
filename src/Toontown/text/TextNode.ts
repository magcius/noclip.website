import { vec2, vec4 } from "gl-matrix";
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

  get textColor(): vec4 {
    return this._textColor;
  }
  set textColor(value: vec4) {
    vec4.copy(this._textColor, value);
  }

  get shadowColor(): vec4 | null {
    return this._shadowColor;
  }
  set shadowColor(value: vec4 | null) {
    this._shadowColor = value ? vec4.clone(value) : null;
  }

  get shadowOffset(): vec2 | null {
    return this._shadowOffset;
  }
  set shadowOffset(value: vec2 | null) {
    this._shadowOffset = value ? vec2.clone(value) : null;
  }

  get width(): number {
    this.ensureAssembled();
    return this.assembler?.textWidth ?? 0;
  }

  get height(): number {
    this.ensureAssembled();
    return this.assembler?.textHeight ?? 0;
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

    this.assembler = new TextAssembler(this._font, this._wordwrap, this._align);
    this.assembler.assembleText(this._text);
    this.dirty = false;
  }
}
