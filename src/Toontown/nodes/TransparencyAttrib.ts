import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderAttrib";

export enum TransparencyMode {
  None = 0,
  Alpha = 1,
  // Value 2 was previously used, now unused
  Multisample = 3,
  MultisampleMask = 4,
  Binary = 5,
  Dual = 6,
}

export class TransparencyAttrib extends RenderAttrib {
  public mode = TransparencyMode.None;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as TransparencyMode;
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, TransparencyMode));
    return info;
  }

  static create(
    mode: TransparencyMode = TransparencyMode.None,
  ): TransparencyAttrib {
    const attrib = new TransparencyAttrib();
    attrib.mode = mode;
    return attrib;
  }
}

registerBAMObject("TransparencyAttrib", TransparencyAttrib);
