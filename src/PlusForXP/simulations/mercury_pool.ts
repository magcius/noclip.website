import { vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode } from "../types";
import { getDescendants } from "../util";

type MercuryDrop = {
  startTime: number,
  duration: number,
  position: [number, number],
  dropModel: SceneNode,
  splashModel: SceneNode,
  splashAnimatedNodes: SceneNode[],
  state: "waiting" | "falling" | "splashing" | "rippling"
};

export default class MercuryPool implements ISimulation {
  
  private drops: MercuryDrop[];
  private pool: SceneNode;
  
  setup(sceneNodesByName: Map<string, SceneNode>): void {
    this.pool = sceneNodesByName.get("pool/pool")!;
    this.drops = [1, 2, 3].map(i => {
      const dropModel = sceneNodesByName.get(`Mercury_Pool_Drop.scx_${i}/_root`)!;
      const splashModel = sceneNodesByName.get(`Mercury_Pool_Splash.scx_${i}/_root`)!;
      dropModel.visible = false;
      dropModel.transformChanged = true;
      splashModel.visible = false;
      const splashAnimatedNodes = getDescendants(splashModel).filter(n => n.animates);
      splashAnimatedNodes.forEach(n => n.animates = false);
      splashModel.transformChanged = true;
      return {
        startTime: 0,
        duration: 0,
        position: [0, 0],
        dropModel,
        splashModel,
        splashAnimatedNodes,
        state: "waiting"
      };
    });
  }

  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>): void {
    const {time} = input;
    // Update models
    for (const drop of this.drops) {
      // drop.splashAnimatedNodes.forEach(n => n.animates = (time / 1000) % 2 < 1);
      if (time > drop.startTime) {
        
      }
    }
    // Update pool vertex positions and normals
  }
}