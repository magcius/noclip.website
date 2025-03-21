import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode } from "../types";
import { mat4, quat, vec3, vec4 } from 'gl-matrix';
import { getDescendants, reparent } from "../util";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";

export default class RobotCircus implements ISimulation {

  private isTech: boolean;
  private bar: SceneNode;
  private bot1: SceneNode;
  private bot2: SceneNode;

  setup(sceneNodesByName: Map<string, SceneNode>): void {
    this.isTech = sceneNodesByName.has("Balance_Tech_Bar.scx/balance bar");
    this.bar = sceneNodesByName.get(this.isTech ? "Balance_Tech_Bar.scx/_root" : "Balance_Bar.scx/_root")!;
    this.bot1 = sceneNodesByName.get(this.isTech ? "Balance_Man3A.scx/_root" : "Balance_Man1A.scx/_root")!;
    this.bot2 = sceneNodesByName.get(this.isTech ? "Balance_Man4A.scx/_root" : "Balance_Man2A.scx/_root")!;
    
    getDescendants(this.bot1).forEach(n => n.animates = false);
  
    vec3.set(this.bar.transform.trans, 0, 0, this.isTech ? 120 : 161);
    reparent(this.bot1, this.bar);
    const bot1Offset: [number, number, number] = this.isTech ? [100, 0, 0] : [-100, 0, 0];
    vec3.set(this.bot1.transform.trans, ...bot1Offset);
    reparent(this.bot2, this.bar);
    const bot2Offset: [number, number, number] = this.isTech ? [-100, 0, 0] : [100, 0, 0];
    vec3.set(this.bot2.transform.trans, ...bot2Offset);
    
    this.bot1.transformChanged = true;
    this.bot2.transformChanged = true;
    this.bar.transformChanged = true;
  }

  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>, device: GfxDevice): void {
    const angle = Math.PI * ((this.isTech ? 0 : -0.5) + (input?.time ?? 0) / 1000);
    if (this.isTech) {
      vec3.set(this.bar.transform.rot, 0, angle, 0);
      vec3.set(this.bot1.transform.rot, 0, angle, 0);
      vec3.set(this.bot2.transform.rot, 0, angle, 0);
    } else {
      vec3.set(this.bar.transform.rot, 0, angle, 0);
      vec3.set(this.bot1.transform.rot, 0, angle, Math.PI);
      vec3.set(this.bot2.transform.rot, 0, -angle, 0);
    }

    this.bot1.transformChanged = true;
    this.bot2.transformChanged = true;
    this.bar.transformChanged = true;
  }
}