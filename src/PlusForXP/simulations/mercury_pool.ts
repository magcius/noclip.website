import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode } from "../types";

export default class MercuryPool implements ISimulation {
  
  private drops: SceneNode[];
  private splashes: SceneNode[];

  constructor() {
    
  }
  
  setup(sceneNodesByName: Map<string, SceneNode>): void {
    this.drops = [1, 2, 3].map(i => sceneNodesByName.get(`Mercury_Pool_Drop.scx_${i}/_root`)!);
    this.splashes = [1, 2, 3].map(i => sceneNodesByName.get(`Mercury_Pool_Splash.scx_${i}/_root`)!);
    this.drops.forEach(drop => {
      drop.visible = false;
      drop.transformChanged = true;
    })
    this.splashes.forEach(drop => {
      drop.visible = false;
      drop.transformChanged = true;
    })
  }

  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>): void {
  
  }
}