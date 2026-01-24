import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgNum } from "./debug";
import { PandaNode } from "./PandaNode";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export class UvScrollNode extends PandaNode {
  public uSpeed = 0;
  public vSpeed = 0;
  public wSpeed = 0;
  public rSpeed = 0;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.uSpeed = data.readStdFloat();
    this.vSpeed = data.readStdFloat();
    if (this._version.compare(new AssetVersion(6, 33)) >= 0) {
      this.wSpeed = data.readStdFloat();
    }
    if (this._version.compare(new AssetVersion(6, 22)) >= 0) {
      this.rSpeed = data.readStdFloat();
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.uSpeed = this.uSpeed;
    target.vSpeed = this.vSpeed;
    target.wSpeed = this.wSpeed;
    target.rSpeed = this.rSpeed;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("uSpeed", dbgNum(this.uSpeed));
    info.set("vSpeed", dbgNum(this.vSpeed));
    if (this._version.compare(new AssetVersion(6, 33)) >= 0) {
      info.set("wSpeed", dbgNum(this.wSpeed));
    }
    if (this._version.compare(new AssetVersion(6, 22)) >= 0) {
      info.set("rSpeed", dbgNum(this.rSpeed));
    }
    return info;
  }
}

registerTypedObject("UvScrollNode", UvScrollNode);
