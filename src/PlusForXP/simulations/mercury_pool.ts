import { vec2, vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode } from "../types";
import { getDescendants } from "../util";

enum MercuryDropState {
  "waiting",
  "falling",
  "splashing"
};

type MercuryDrop = {
  initialized: boolean,
  startTime: number,
  position: [number, number],
  dropModel: SceneNode,
  splashModel: SceneNode,
  splashAnimatedNodes: SceneNode[],
  state: MercuryDropState
};

export default class MercuryPool implements ISimulation {
  
  private isInitialized: boolean;
  private isIndustrial: boolean;
  private drops: MercuryDrop[];
  private dropRange: [number, number];
  private pool: SceneNode;
  private fallDuration: number;
  private splashDuration: number;
  private rippleDuration: number;
  
  setup(sceneNodesByName: Map<string, SceneNode>): void {
    const dropTemplate = {
      initialized: false,
      startTime: 0,
      position: [0, 0] as [number, number],
      state: MercuryDropState.waiting
    };
    this.isIndustrial = sceneNodesByName.has("Mercury_Pool_Tech_Scene.scx/_root");
    this.dropRange = this.isIndustrial ? [28, 28] : [16, 16];
    this.fallDuration = 1000;
    this.splashDuration = 1333;
    this.rippleDuration = 5000;
    this.pool = sceneNodesByName.get("pool/pool")!;
    this.drops = [1, 2, 3].map(i => {
      const dropModel = sceneNodesByName.get(`Mercury_Pool_Drop.scx_${i}/_root`)!;
      const splashModel = sceneNodesByName.get(`Mercury_Pool_Splash.scx_${i}/_root`)!;
      dropModel.visible = false;
      dropModel.transformChanged = true;
      splashModel.visible = false;
      splashModel.transformChanged = true;
      const splashAnimatedNodes = getDescendants(splashModel).filter(n => n.animates);
      splashAnimatedNodes.forEach(n => n.loops = false);
      return { ...dropTemplate, dropModel, splashModel, splashAnimatedNodes };
    });
  }

  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>): void {
    const {time} = input;

    if (!this.isInitialized) {
      this.isInitialized = true;
      const totalDuration = this.fallDuration + this.splashDuration + this.rippleDuration;
      for (const drop of this.drops) {
        drop.startTime = time - Math.random() * (totalDuration + 3000);
      }
    }
    
    for (const drop of this.drops) {
      const {dropModel, splashModel, splashAnimatedNodes} = drop;
      
      switch (drop.state) {
        case MercuryDropState.waiting: {
          if (time > drop.startTime) {
            drop.state = MercuryDropState.falling;
            drop.position = MercuryPool.createDropPosition(this.dropRange);
            
            vec3.set(dropModel.transform.trans, ...drop.position, -64);
            dropModel.visible = true;
            dropModel.transformChanged = true;
          }
          break;
        }
        case MercuryDropState.falling: {
          if (time > drop.startTime + this.fallDuration) {
            drop.state = MercuryDropState.splashing;
            
            dropModel.visible = false;
            dropModel.transformChanged = true;
            
            vec3.set(splashModel.transform.trans, ...drop.position, 0);
            splashModel.visible = true;
            splashModel.transformChanged = true;
            splashAnimatedNodes.forEach(n => n.animations.forEach(anim => anim.reset()))
          } else {
            dropModel.transform.trans[2] = ((time - drop.startTime) / 1000 - 1) * -64;
            dropModel.transformChanged = true;
          }
          break;
        }
        case MercuryDropState.splashing: {
          if (time > drop.startTime + this.fallDuration + this.splashDuration) {
            drop.state = MercuryDropState.waiting;
            splashModel.visible = false;
            splashModel.transformChanged = true;
            drop.startTime = time + Math.random() * 3000 + 1000;
          }
          break;
        }
      }
    }

    // Update pool vertex positions and normals
  }

  static createDropPosition(range: [number, number]) : [number, number] {
    return [
      (Math.random() * 2 - 1) * range[0],
      (Math.random() * 2 - 1) * range[1],
    ];
  }
}