import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, type CopyContext, registerBAMObject } from "./base";
import { type DebugInfo, dbgStr } from "./debug";

export class InternalName extends BAMObject {
  public name = "";

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.name = data.readString();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = this.name;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    return info;
  }
}

export class TexCoordName extends InternalName {}

registerBAMObject("InternalName", InternalName);
registerBAMObject("TexCoordName", TexCoordName);
