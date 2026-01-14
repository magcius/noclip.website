import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import type { MaterialData } from "../geom";
import { type CopyContext, readTypedRefs, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgBool,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgRefs,
} from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import { SamplerState } from "./SamplerState";
import { Texture } from "./Texture";
import { TextureStage } from "./TextureStage";

export interface StageNode {
  sampler: SamplerState | null;
  textureStage: TextureStage;
  texture: Texture;
  priority: number;
  implicitSort: number;
}

export class TextureAttrib extends RenderAttrib {
  public offAllStages = false;
  public offStageRefs: TextureStage[] = [];
  public onStages: StageNode[] = [];

  // Pre-5.0 format: single texture reference
  public texture: Texture | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    if (this._version.compare(new AssetVersion(4, 11)) < 0) {
      // Pre-4.11 format: just a single texture pointer
      this.texture = file.getTyped(data.readObjectId(), Texture);
      return;
    }

    // BAM 4.11+ multitexture format
    this.offAllStages = data.readBool();

    const numOffStages = data.readUint16();
    this.offStageRefs = readTypedRefs(file, data, numOffStages, TextureStage);

    const numOnStages = data.readUint16();
    let nextImplicitSort = 0;

    this.onStages = new Array(numOnStages);
    for (let n = 0; n < numOnStages; n++) {
      const textureStageRef = data.readObjectId();
      const textureStage = file.getTyped(textureStageRef, TextureStage);
      if (!textureStage)
        throw new Error(
          `TextureAttrib: TextureStage ref ${textureStageRef} not found`,
        );
      const textureRef = data.readObjectId();
      const texture = file.getTyped(textureRef, Texture);
      if (!texture)
        throw new Error(`TextureAttrib: Texture ref ${textureRef} not found`);

      let implicitSort = 0;
      if (this._version.compare(new AssetVersion(6, 15)) >= 0) {
        implicitSort = data.readUint16();
      } else {
        implicitSort = n;
      }

      let priority = 0;
      if (this._version.compare(new AssetVersion(6, 23)) >= 0) {
        priority = data.readInt32();
      }

      let sampler: SamplerState | null = null;
      if (this._version.compare(new AssetVersion(6, 36)) >= 0) {
        if (data.readBool()) {
          sampler = new SamplerState();
          sampler.load(file, data);
        }
      }

      // Calculate actual order
      nextImplicitSort = Math.max(nextImplicitSort, implicitSort + 1);
      const actualSort = nextImplicitSort;
      nextImplicitSort += 1;

      this.onStages[n] = {
        sampler,
        textureStage,
        texture,
        priority,
        implicitSort: actualSort,
      };
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.offAllStages = this.offAllStages;
    target.offStageRefs = ctx.cloneArray(this.offStageRefs);
    target.onStages = this.onStages.map((stage) => ({
      sampler: stage.sampler,
      textureStage: ctx.clone(stage.textureStage),
      texture: ctx.clone(stage.texture),
      priority: stage.priority,
      implicitSort: stage.implicitSort,
    }));
    target.texture = ctx.clone(this.texture);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();

    // Pre-5.0 format
    if (this.texture !== null) {
      info.set("texture", dbgRef(this.texture));
      return info;
    }

    // 5.0+ format
    if (this.offAllStages) {
      info.set("offAllStages", dbgBool(true));
    }

    if (this.offStageRefs.length > 0) {
      info.set("offStageRefs", dbgRefs(this.offStageRefs));
    }

    if (this.onStages.length > 0) {
      info.set(
        "onStages",
        dbgArray(
          this.onStages.map((stage) => {
            const stageInfo: DebugInfo = new Map();
            stageInfo.set("textureStage", dbgRef(stage.textureStage));
            stageInfo.set("texture", dbgRef(stage.texture));
            if (stage.priority !== 0) {
              stageInfo.set("priority", dbgNum(stage.priority));
            }
            if (stage.sampler !== null) {
              stageInfo.set(
                "sampler",
                dbgObject(stage.sampler.getDebugInfo(), true),
              );
            }
            return dbgObject(stageInfo);
          }),
        ),
      );
    }

    return info;
  }

  override applyToMaterial(material: MaterialData): void {
    if (this.texture !== null) {
      material.texture = this.texture;
    } else {
      if (this.offAllStages)
        console.warn("TextureAttrib offAllStages unimplemented");
      if (this.offStageRefs.length > 0)
        console.warn(`TextureAttrib offStageRefs unimplemented`);
      if (this.onStages.length > 0) {
        if (this.onStages.length !== 1)
          console.warn(
            `Multiple texture stages unimplemented (${this.onStages.length})`,
          );
        if (!this.onStages[0].textureStage.isDefault)
          console.warn(`Non-default TextureStage unimplemented`);
        material.texture = this.onStages[0].texture;
      }
    }
  }
}

registerBAMObject("TextureAttrib", TextureAttrib);
