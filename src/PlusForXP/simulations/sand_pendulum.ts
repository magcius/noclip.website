import { vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode } from "../types";
import { reparent } from "../util";

export default class SandPendulum implements ISimulation {
  private isGrotto: boolean;
  private pendulum: SceneNode;
  private sandParticles: SceneNode;
  private sparkle: SceneNode;
  
  setup(sceneNodesByName: Map<string, SceneNode>): void {
    this.isGrotto = sceneNodesByName.has("Pendulum_SW_Pendulum.scx/Pendulum Arrowhead");
    this.pendulum = sceneNodesByName.get(this.isGrotto ? "Pendulum_SW_Pendulum.scx/Pendulum Arrowhead" : "Pendulum_Pendulum.scx/Pendulum")!;
    this.sandParticles = sceneNodesByName.get("Pendulum_Sand_Particles.scx/_root")!;
    this.sparkle = sceneNodesByName.get("Sparkle.scx/Plane01")!;

    reparent(this.sandParticles, this.pendulum);
    reparent(this.sparkle, this.pendulum);
    const pendulumOffset: [number, number, number] = this.isGrotto ? [0, 0, 70] : [0, 0, 69];
    vec3.set(this.pendulum.transform.trans, ...pendulumOffset);
    
    const sandTranslate: [number, number, number] = this.isGrotto ? [0, 0, -82] : [0, -81, 0];
    const sandRotate: [number, number, number] = this.isGrotto ? [-Math.PI * 0.5, 0, 0] : [-Math.PI * 0.5, 0, 0];
    vec3.set(this.sandParticles.transform.trans, ...sandTranslate);
    vec3.set(this.sandParticles.transform.scale, 1.5, 1.5, 1.5);
    vec3.set(this.sandParticles.transform.rot, ...sandRotate);
    
    const sparkleTranslate: [number, number, number] = this.isGrotto ? [0, 0, -82] : [0, -81, 0];
    const sparkleRotate: [number, number, number] = this.isGrotto ? [-Math.PI * 0.5, 0, 0] : [Math.PI, 0, 0];
    vec3.set(this.sparkle.transform.trans, ...sparkleTranslate);
    vec3.set(this.sparkle.transform.rot, ...sparkleRotate);

    this.pendulum.transformChanged = true;
    this.sandParticles.transformChanged = true;
    this.sparkle.transformChanged = true;
  }
  
  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>): void {
    // TODO: lissajous with randomized initial velocity
    const maxAngle = Math.PI * 0.1;
    const angleX = Math.sin((input?.time ?? 0) * 3 / 1000) * maxAngle;
    const angleY = 0;
    vec3.set(this.pendulum.transform.rot, angleX + (this.isGrotto ? 0 : Math.PI * 0.5), 0, angleY);

    this.pendulum.transformChanged = true;
    this.sandParticles.transformChanged = true;
    this.sparkle.transformChanged = true;
  }
}
