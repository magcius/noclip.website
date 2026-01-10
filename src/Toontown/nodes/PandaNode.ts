import type { vec3, vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { ColorAttrib } from "./ColorAttrib";
import {
  type DebugInfo,
  dbgArray,
  dbgEnum,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgStr,
} from "./debug";
import { BoundsType } from "./geomEnums";
import { type RenderEffect, RenderEffects } from "./RenderEffects";
import { type RenderAttrib, RenderState } from "./RenderState";
import { TransformState } from "./TransformState";

export class PandaNode extends BAMObject {
  public name: string = "";
  public state = new RenderState();
  public transform = new TransformState();
  public effects = new RenderEffects();
  public drawControlMask = 0;
  public drawShowMask = 0xffffffff;
  public intoCollideMask = 0;
  public boundsType = BoundsType.Default;
  public tags = new Map<string, string>();
  public parents: PandaNode[] = [];
  public children: [PandaNode, number][] = [];
  public stashed: [PandaNode, number][] = [];

  addChild(child: PandaNode, sort: number = 0): void {
    child.parents.push(this);
    this.children.push([child, sort]);
  }

  removeChild(child: PandaNode): void {
    const index = this.children.findIndex(([c, _]) => c === child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
    const parentIndex = child.parents.indexOf(this);
    if (parentIndex !== -1) {
      child.parents.splice(parentIndex, 1);
    }
  }

  moveTo(target: PandaNode): void {
    for (const parent of this.parents.slice()) {
      parent.removeChild(this);
    }
    target.addChild(this);
  }

  findNode(name: string): PandaNode | null {
    if (this.name === name) return this;
    for (const [child, _] of this.children) {
      const found = child.findNode(name);
      if (found) return found;
    }
    return null;
  }

  // TODO replace with actual PandaNode queries
  findNodeBySuffix(suffix: string): PandaNode | null {
    if (this.name.endsWith(suffix)) return this;
    for (const [child, _] of this.children) {
      const found = child.findNodeBySuffix(suffix);
      if (found) return found;
    }
    return null;
  }

  traverse(visitor: (node: PandaNode) => void): void {
    visitor(this);
    for (const [child, _] of this.children) {
      child.traverse(visitor);
    }
  }

  attachNewNode(name: string): PandaNode {
    const node = PandaNode.create(name);
    this.addChild(node);
    return node;
  }

  setAttrib(attrib: RenderAttrib, priority = 0) {
    this.state = this.state.withAttrib(attrib, priority);
  }

  setColor(color: vec4) {
    this.setAttrib(ColorAttrib.flat(color));
  }

  setPosHprScale(pos: vec3, hpr: vec3, scale: vec3) {
    this.transform = TransformState.fromPosHprScale(pos, hpr, scale);
  }

  setEffect(effect: RenderEffect) {
    this.effects = this.effects.withEffect(effect);
  }

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.name = data.readString();

    const state = file.getTyped(data.readObjectId(), RenderState);
    if (state) this.state = state;
    const transform = file.getTyped(data.readObjectId(), TransformState);
    if (transform) this.transform = transform;
    const effects = file.getTyped(data.readObjectId(), RenderEffects);
    if (effects) this.effects = effects;

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
      this.boundsType = data.readUint8() as BoundsType;
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

    // Parents will be registered later; read the IDs for now
    const numParents = data.readUint16();
    for (let i = 0; i < numParents; i++) {
      data.readObjectId();
    }

    // Children
    const numChildren = data.readUint16();
    this.children = new Array(numChildren);
    for (let i = 0; i < numChildren; i++) {
      const ref = file.getTyped(data.readObjectId(), PandaNode);
      if (!ref) throw new Error(`Child reference @${ref} not found in file`);
      ref.parents.push(this);
      const sort = data.readUint32();
      this.children[i] = [ref, sort];
    }

    // Stashed
    const numStashed = data.readUint16();
    this.stashed = new Array(numStashed);
    for (let i = 0; i < numStashed; i++) {
      const ref = file.getTyped(data.readObjectId(), PandaNode);
      if (!ref) throw new Error(`Stashed reference @${ref} not found in file`);
      // if (ref instanceof PandaNode) ref.parents.push(this); ?
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

  override copyTo(target: this) {
    super.copyTo(target);
    target.name = this.name;
    target.state = this.state?.clone() ?? null;
    target.transform = this.transform?.clone() ?? null;
    target.effects = this.effects?.clone() ?? null;
    target.drawControlMask = this.drawControlMask;
    target.drawShowMask = this.drawShowMask;
    target.intoCollideMask = this.intoCollideMask;
    target.boundsType = this.boundsType;
    target.tags = new Map(this.tags);
  }

  cloneSubgraph(): PandaNode {
    const target = this.clone();
    for (const [child, sort] of this.children) {
      target.addChild(child.cloneSubgraph(), sort);
    }
    return target;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("state", dbgRef(this.state));
    info.set("transform", dbgRef(this.transform));
    info.set("effects", dbgRef(this.effects));

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
          this.children.map(([ref, sort]) =>
            dbgObject(
              dbgFields([
                ["sort", dbgNum(sort)],
                ["ref", dbgRef(ref)],
              ]),
            ),
          ),
        ),
      );
    }

    if (this.stashed.length > 0) {
      info.set(
        "stashed",
        dbgArray(
          this.stashed.map(([ref, sort]) =>
            dbgObject(
              dbgFields([
                ["sort", dbgNum(sort)],
                ["ref", dbgRef(ref)],
              ]),
            ),
          ),
        ),
      );
    }

    return info;
  }

  static create(name: string): PandaNode {
    const node = new PandaNode();
    node.name = name;
    return node;
  }
}

registerBAMObject("PandaNode", PandaNode);
