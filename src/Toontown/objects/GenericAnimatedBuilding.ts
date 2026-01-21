import { DecalEffect, DepthWriteAttrib, DepthWriteMode } from "../nodes";
import { GenericAnimatedProp } from "./GenericAnimatedProp";

export class GenericAnimatedBuilding extends GenericAnimatedProp {
  override async init(): Promise<void> {
    await super.init();

    // Fix rendering issues (from DistributedAnimBuilding)
    const mf = this.node.find("**/*mesh_front*");
    const signJoints = this.node.findAllMatches("**/sign_origin_joint");
    if (mf) {
      const sign = mf.find("**/sign");
      mf.clearEffect(DecalEffect);
      if (sign) {
        sign.setAttrib(DepthWriteAttrib.create(DepthWriteMode.On), 1);
        sign.setEffect(new DecalEffect());
        if (signJoints.length > 0) {
          sign.wrtReparentTo(signJoints[signJoints.length - 1]);
        }
      }
    }
  }

  override enter(): void {
    // No-op
  }
}
