import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";
import { RenderAttrib } from "./RenderState";

export enum DepthWriteMode {
  Off = 0,
  On = 1,
}

export class DepthWriteAttrib extends RenderAttrib {
  public mode = DepthWriteMode.On;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.mode = data.readUint8() as DepthWriteMode;
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.mode = this.mode;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("mode", dbgEnum(this.mode, DepthWriteMode));
    return info;
  }
}

registerBAMObject("DepthWriteAttrib", DepthWriteAttrib);
