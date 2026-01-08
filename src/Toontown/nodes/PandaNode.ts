import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgEnum,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgStr,
} from "./debug";
import { BoundsType } from "./geomEnums";

export class PandaNode extends BAMObject {
  public name: string;
  public stateRef: number;
  public transformRef: number;
  public effectsRef: number;
  public drawControlMask: number;
  public drawShowMask: number;
  public intoCollideMask = 0;
  public boundsType = 0;
  public tags = new Map<string, string>();
  public parents: number[];
  public children: [number, number][];
  public stashed: [number, number][];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);
    this.name = data.readString();
    this.stateRef = data.readObjectId();
    this.transformRef = data.readObjectId();
    this.effectsRef = data.readObjectId();

    // Draw mask handling
    if (this._version.compare(new AssetVersion(6, 2)) >= 0) {
      this.drawControlMask = data.readUint32();
      this.drawShowMask = data.readUint32();
    } else {
      let drawMask = data.readUint32();
      if (drawMask === 0) {
        this.drawControlMask = 1 << 31;
        this.drawShowMask = 0x7fffffff;
      } else if (drawMask === 0xfffffff) {
        this.drawControlMask = 0;
        this.drawShowMask = 0xffffffff;
      } else {
        drawMask &= 0x7fffffff;
        this.drawControlMask = ~drawMask & 0xffffffff;
        this.drawShowMask = drawMask;
      }
    }

    // into_collide_mask was added in BAM 6.0 (unconditional),
    // but earlier versions may have had it conditionally
    if (this._version.compare(new AssetVersion(6, 0)) >= 0) {
      this.intoCollideMask = data.readUint32();
    }

    // bounds_type added in BAM 6.19
    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      this.boundsType = data.readUint8();
    }

    // In BAM 6.0+, tags come BEFORE parents/children/stashed
    // In BAM < 6.0, tags come AFTER parents/children/stashed
    const isNewFormat = this._version.compare(new AssetVersion(6, 0)) >= 0;

    if (isNewFormat) {
      // New format: tags first
      const numTags = data.readUint32();
      for (let i = 0; i < numTags; i++) {
        const tag = data.readString();
        const value = data.readString();
        this.tags.set(tag, value);
      }
    }

    // Parents
    const numParents = data.readUint16();
    this.parents = new Array<number>(numParents);
    for (let i = 0; i < numParents; i++) {
      this.parents[i] = data.readObjectId();
    }

    // Children
    const numChildren = data.readUint16();
    this.children = new Array<[number, number]>(numChildren);
    for (let i = 0; i < numChildren; i++) {
      const ref = data.readObjectId();
      const sort = data.readUint32();
      this.children[i] = [ref, sort];
    }

    // Stashed
    const numStashed = data.readUint16();
    this.stashed = new Array<[number, number]>(numStashed);
    for (let i = 0; i < numStashed; i++) {
      const ref = data.readObjectId();
      const sort = data.readUint32();
      this.stashed[i] = [ref, sort];
    }

    // Old format: tags come after parents/children/stashed
    if (!isNewFormat && this._version.compare(new AssetVersion(4, 4)) >= 0) {
      const numTags = data.readUint32();
      for (let i = 0; i < numTags; i++) {
        const tag = data.readString();
        const value = data.readString();
        this.tags.set(tag, value);
      }
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("stateRef", dbgRef(this.stateRef));
    info.set("transformRef", dbgRef(this.transformRef));
    info.set("effectsRef", dbgRef(this.effectsRef));

    if (this.drawControlMask !== 0 || this.drawShowMask !== 0xffffffff) {
      info.set("drawControlMask", dbgNum(this.drawControlMask));
      info.set("drawShowMask", dbgNum(this.drawShowMask));
    }

    if (this.intoCollideMask !== 0) {
      info.set("intoCollideMask", dbgNum(this.intoCollideMask));
    }

    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      info.set("boundsType", dbgEnum(this.boundsType, BoundsType));
    }

    if (this.tags.size > 0) {
      const tagInfo: DebugInfo = new Map();
      for (const [key, value] of this.tags) {
        tagInfo.set(key, dbgStr(value));
      }
      info.set("tags", dbgObject(tagInfo));
    }

    if (this.children.length > 0) {
      info.set(
        "children",
        dbgArray(
          this.children.map(([ref, sort]) => {
            const childInfo: DebugInfo = new Map();
            childInfo.set("ref", dbgRef(ref));
            childInfo.set("sort", dbgNum(sort));
            return dbgObject(childInfo, true);
          }),
        ),
      );
    }

    if (this.stashed.length > 0) {
      info.set(
        "stashed",
        dbgArray(
          this.stashed.map(([ref, sort]) => {
            const stashInfo: DebugInfo = new Map();
            stashInfo.set("ref", dbgRef(ref));
            stashInfo.set("sort", dbgNum(sort));
            return dbgObject(stashInfo, true);
          }),
        ),
      );
    }

    return info;
  }
}

registerBAMObject("PandaNode", PandaNode);
