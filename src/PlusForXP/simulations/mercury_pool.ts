import { vec2, vec3 } from "gl-matrix";
import { ViewerRenderInput } from "../../viewer";
import { ISimulation, SceneNode, VertexAttribute } from "../types";
import { getDescendants } from "../util";
import { GfxBuffer, GfxDevice } from "../../gfx/platform/GfxPlatform";
import { numVertexRows } from "../pool";

enum MercuryDropState {
  "waiting",
  "falling",
  "splashing"
};

type MercuryDrop = {
  initialized: boolean,
  startTime: number,
  lastStartTime: number,
  position: [number, number],
  dropModel: SceneNode,
  splashModel: SceneNode,
  splashAnimatedNodes: SceneNode[],
  state: MercuryDropState
};

type DynamicAttribute = {
  buffer: GfxBuffer,
  data: Float32Array,
  uint8Array: Uint8Array
};

export default class MercuryPool implements ISimulation {
  
  private isInitialized: boolean;
  private isIndustrial: boolean;
  private drops: MercuryDrop[];
  private dropRange: [number, number];
  private fallDuration: number;
  private splashDuration: number;
  private rippleDuration: number;
  private poolPositions: DynamicAttribute;
  private poolNormals: DynamicAttribute;
  private poolScale: number;
  
  setup(sceneNodesByName: Map<string, SceneNode>): void {
    const dropTemplate = {
      initialized: false,
      startTime: 0,
      lastStartTime: 0,
      position: [0, 0] as [number, number],
      state: MercuryDropState.waiting
    };
    this.isIndustrial = sceneNodesByName.has("Mercury_Pool_Tech_Scene.scx/_root");
    this.dropRange = this.isIndustrial ? [28, 28] : [16, 16];
    this.fallDuration = 1000;
    this.splashDuration = 1333;
    this.rippleDuration = 5000;
    this.poolScale = this.isIndustrial ? 64 : 72;
    const pool = sceneNodesByName.get("pool/pool")!;
    pool.transform.scale = [this.poolScale, this.poolScale, 1];
    pool.transformChanged = true;
    const poolAttributes = pool.meshes[0].vertexAttributes;
    
    const poolPositions = poolAttributes.find(buffer => buffer.name === "position")!;
    this.poolPositions = {
      buffer: poolPositions.buffer,
      data: poolPositions.data!,
      uint8Array: new Uint8Array(poolPositions.data!.buffer)
    };

    const poolNormals = poolAttributes.find(buffer => buffer.name === "normal")!;
    this.poolNormals = {
      buffer: poolNormals.buffer,
      data: poolNormals.data!,
      uint8Array: new Uint8Array(poolNormals.data!.buffer)
    };

    this.drops = [];
    for (let i = 1; i < 10; i++) {
      const dropModel = sceneNodesByName.get(`Mercury_Pool_Drop.scx_${i}/_root`);
      const splashModel = sceneNodesByName.get(`Mercury_Pool_Splash.scx_${i}/_root`);
      if (dropModel == null || splashModel == null) {
        break;
      }
      dropModel.visible = false;
      dropModel.transformChanged = true;
      splashModel.visible = false;
      splashModel.transformChanged = true;
      const splashAnimatedNodes = getDescendants(splashModel).filter(n => n.animates);
      splashAnimatedNodes.forEach(n => n.loops = false);
      this.drops.push({ ...dropTemplate, dropModel, splashModel, splashAnimatedNodes });
    }
  }

  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>, device: GfxDevice): void {
    const {time} = input;

    if (!this.isInitialized) {
      this.isInitialized = true;
      for (const drop of this.drops) {
        drop.startTime = time - Math.random() * this.rippleDuration;
        drop.lastStartTime = drop.startTime;
      }
    }
    
    for (const drop of this.drops) {
      const {dropModel, splashModel, splashAnimatedNodes} = drop;
      
      switch (drop.state) {
        case MercuryDropState.waiting: {
          if (time > drop.startTime) {
            drop.state = MercuryDropState.falling;
            drop.position = MercuryPool.createDropPosition(this.dropRange);
            drop.lastStartTime = drop.startTime;
            vec3.set(dropModel.transform.trans, ...drop.position, -100);
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
            dropModel.transform.trans[2] = ((time - drop.startTime) / 1000 - 1) * -100;
            dropModel.transformChanged = true;
          }
          break;
        }
        case MercuryDropState.splashing: {
          if (time > drop.startTime + this.fallDuration + this.splashDuration) {
            drop.state = MercuryDropState.waiting;
            splashModel.visible = false;
            splashModel.transformChanged = true;
            drop.startTime = time + this.rippleDuration - Math.random() * this.fallDuration;
          }
          break;
        }
      }
    }

    // Update pool vertex positions and normals

    const positionData = this.poolPositions.data;
    const normalData = this.poolNormals.data;

    const vertPosition = vec2.create();
    for (let i = 0; i < numVertexRows; i++) {
      for (let j = 0; j < numVertexRows; j++) {
        const index = (i * numVertexRows + j) * 3;
        vec2.set(
          vertPosition, 
          positionData[index + 0] * this.poolScale, 
          positionData[index + 1] * this.poolScale
        );
        let sum = 0;
        for (const drop of this.drops) {
          const t = Math.max(0, time - drop.lastStartTime - this.fallDuration);
          const dist = vec2.distance(vertPosition, drop.position);
          let x = Math.max(0, 12 * t / 1000 - dist);
          sum += (-Math.cos(x * 0.6) * 0.5 + 0.5) * Math.max(0, 1 - t / this.rippleDuration) * (300 / this.poolScale) / (1 + dist * 0.1);
        }
        positionData[index + 2] = sum;
      }
    }

    const vertNormal = vec3.create();
    for (let i = 0; i < numVertexRows; i++) {
      for (let j = 0; j < numVertexRows; j++) {
        const index = (i * numVertexRows + j) * 3;
        const height = positionData[index + 2];
        const heightN = positionData[(i - 1 * numVertexRows + j    ) * 3 + 2] ?? height;
        const heightS = positionData[(i + 1 * numVertexRows + j    ) * 3 + 2] ?? height;
        const heightE = positionData[(i     * numVertexRows + j - 1) * 3 + 2] ?? height;
        const heightW = positionData[(i     * numVertexRows + j + 1) * 3 + 2] ?? height;
        vec3.set(
          vertNormal, 
          2 * this.poolScale,
          heightN - heightS, 
          heightE - heightW, 
        );
        vec3.normalize(vertNormal, vertNormal);
        normalData.set(vertNormal, index);
      }
    }

    device.uploadBufferData(this.poolPositions.buffer, 0, this.poolPositions.uint8Array);
    device.uploadBufferData(this.poolNormals.buffer, 0, this.poolNormals.uint8Array);
  }

  static createDropPosition(range: [number, number]) : [number, number] {
    return [
      (Math.random() * 2 - 1) * range[0],
      (Math.random() * 2 - 1) * range[1],
    ];
  }
}