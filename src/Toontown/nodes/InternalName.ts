import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgStr } from "./debug";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export class InternalName extends TypedObject {
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

registerTypedObject("InternalName", InternalName);
registerTypedObject("TexCoordName", TexCoordName);
