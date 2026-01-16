import { vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import type { MaterialData } from "../Geom";
import { type DebugInfo, dbgColor, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export enum ColorBlendMode {
  None = 0,
  Add = 1,
  Subtract = 2,
  InverseSubtract = 3,
  Min = 4,
  Max = 5,
}

export enum ColorBlendOperand {
  Zero = 0,
  One = 1,
  IncomingColor = 2,
  OneMinusIncomingColor = 3,
  FramebufferColor = 4,
  OneMinusFramebufferColor = 5,
  IncomingAlpha = 6,
  OneMinusIncomingAlpha = 7,
  FramebufferAlpha = 8,
  OneMinusFramebufferAlpha = 9,
  ConstantColor = 10,
  OneMinusConstantColor = 11,
  ConstantAlpha = 12,
  OneMinusConstantAlpha = 13,
  IncomingColorSaturate = 14,
  Incoming1Color = 15,
  OneMinusIncoming1Color = 16,
  Incoming1Alpha = 17,
  OneMinusIncoming1Alpha = 18,
  ColorScale = 19,
  OneMinusColorScale = 20,
  AlphaScale = 21,
  OneMinusAlphaScale = 22,
}

export class ColorBlendAttrib extends RenderAttrib {
  public mode = ColorBlendMode.None;
  public operandA = ColorBlendOperand.One;
  public operandB = ColorBlendOperand.One;
  public alphaMode = ColorBlendMode.None;
  public alphaOperandA = ColorBlendOperand.One;
  public alphaOperandB = ColorBlendOperand.One;
  public color = vec4.create();

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as ColorBlendMode;
    this.operandA = data.readUint8() as ColorBlendOperand;
    this.operandB = data.readUint8() as ColorBlendOperand;

    if (this._version.compare(new AssetVersion(6, 42)) >= 0) {
      this.alphaMode = data.readUint8() as ColorBlendMode;
      this.alphaOperandA = data.readUint8() as ColorBlendOperand;
      this.alphaOperandB = data.readUint8() as ColorBlendOperand;
    } else {
      if (this.operandA >= ColorBlendOperand.Incoming1Color) {
        this.operandA = (this.operandA + 4) as ColorBlendOperand;
      }
      if (this.operandB >= ColorBlendOperand.Incoming1Color) {
        this.operandB = (this.operandB + 4) as ColorBlendOperand;
      }
      this.alphaMode = this.mode;
      this.alphaOperandA = this.operandA;
      this.alphaOperandB = this.operandB;
    }

    this.color = data.readVec4();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.mode = this.mode;
    target.operandA = this.operandA;
    target.operandB = this.operandB;
    target.alphaMode = this.alphaMode;
    target.alphaOperandA = this.alphaOperandA;
    target.alphaOperandB = this.alphaOperandB;
    vec4.copy(target.color, this.color);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, ColorBlendMode));
    info.set("operandA", dbgEnum(this.operandA, ColorBlendOperand));
    info.set("operandB", dbgEnum(this.operandB, ColorBlendOperand));
    info.set("alphaMode", dbgEnum(this.alphaMode, ColorBlendMode));
    info.set("alphaOperandA", dbgEnum(this.alphaOperandA, ColorBlendOperand));
    info.set("alphaOperandB", dbgEnum(this.alphaOperandB, ColorBlendOperand));
    info.set("color", dbgColor(this.color));
    return info;
  }

  override applyToMaterial(_material: MaterialData): void {
    console.warn("ColorBlendAttrib.applyToMaterial not implemented");
  }
}

registerTypedObject("ColorBlendAttrib", ColorBlendAttrib);
