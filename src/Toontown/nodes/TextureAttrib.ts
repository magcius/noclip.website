import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgBool,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgRefs,
} from "./debug";
import { SamplerState } from "./SamplerState";

export interface StageNode {
  sampler: SamplerState | null;
  textureStageRef: number;
  textureRef: number;
  priority: number;
  implicitSort: number;
}

export class TextureAttrib extends BAMObject {
  public offAllStages: boolean = false;
  public offStageRefs: number[] = [];
  public onStages: StageNode[] = [];

  // Pre-5.0 format: single texture reference
  public textureRef: number | null = null;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    const version = file.header.version;

    if (version.compare(new AssetVersion(4, 11)) < 0) {
      // Pre-4.11 format: just a single texture pointer
      this.textureRef = data.readObjectId();
      return;
    }

    // BAM 4.11+ multitexture format
    this.offAllStages = data.readBool();

    const numOffStages = data.readUint16();
    for (let i = 0; i < numOffStages; i++) {
      this.offStageRefs.push(data.readObjectId());
    }

    const numOnStages = data.readUint16();
    let nextImplicitSort = 0;

    for (let n = 0; n < numOnStages; n++) {
      const textureStageRef = data.readObjectId();
      const textureRef = data.readObjectId();

      let implicitSort = 0;
      if (version.compare(new AssetVersion(6, 15)) >= 0) {
        implicitSort = data.readUint16();
      } else {
        implicitSort = n;
      }

      let priority = 0;
      if (version.compare(new AssetVersion(6, 23)) >= 0) {
        priority = data.readInt32();
      }

      let sampler: SamplerState | null = null;
      if (version.compare(new AssetVersion(6, 36)) >= 0) {
        if (data.readBool()) {
          sampler = new SamplerState(file, data);
        }
      }

      // Calculate actual order
      nextImplicitSort = Math.max(nextImplicitSort, implicitSort + 1);
      const actualSort = nextImplicitSort;
      nextImplicitSort += 1;

      this.onStages.push({
        sampler,
        textureStageRef,
        textureRef,
        priority,
        implicitSort: actualSort,
      });
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();

    // Pre-5.0 format
    if (this.textureRef !== null) {
      info.set("textureRef", dbgRef(this.textureRef));
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
            stageInfo.set("textureStageRef", dbgRef(stage.textureStageRef));
            stageInfo.set("textureRef", dbgRef(stage.textureRef));
            if (stage.priority !== 0) {
              stageInfo.set("priority", dbgNum(stage.priority));
            }
            if (stage.sampler !== null) {
              stageInfo.set("sampler", dbgObject(stage.sampler.getDebugInfo(), true));
            }
            return dbgObject(stageInfo);
          }),
        ),
      );
    }

    return info;
  }
}

registerBAMObject("TextureAttrib", TextureAttrib);
