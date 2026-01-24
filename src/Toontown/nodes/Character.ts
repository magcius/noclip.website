import type { BAMFile } from "../BAMFile";
import { AssetVersion } from "../Common";
import type { DataStream } from "../util/DataStream";
import { ComputedVertices } from "./ComputedVertices";
import { type DebugInfo, dbgRef, dbgRefs, dbgTypedArray } from "./debug";
import { PartBundleNode } from "./PartBundleNode";
import {
  type CopyContext,
  registerTypedObject,
  type TypedObject,
} from "./TypedObject";

/**
 * Animated character.
 *
 * Pre-5.0 format:
 *   Character contains DynamicVertices inline (not as a separate object)
 *   which stores PTAs that are shared with LegacyGeom objects.
 *   Also has a pointer to ComputedVertices.
 *
 * 5.0+ format:
 *   No DynamicVertices or ComputedVertices. Just PartBundleNode + parts pointers.
 */
export class Character extends PartBundleNode {
  // DynamicVertices inline data (pre-5.0 only) - these PTAs are shared with Geoms
  public dynamicCoords: Float32Array = new Float32Array(); // vec3
  public dynamicNorms: Float32Array = new Float32Array(); // vec3
  public dynamicColors: Float32Array = new Float32Array(); // vec4
  public dynamicTexcoords: Float32Array = new Float32Array(); // vec2

  // Character fields
  public computedVertices: ComputedVertices | null = null;
  public parts: TypedObject[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // Pre-5.0 format has DynamicVertices and ComputedVertices
    if (this._version.compare(new AssetVersion(5, 0)) < 0) {
      // DynamicVertices::fillin - read 4 PTAs
      this.dynamicCoords = data.readPtaVec3();
      this.dynamicNorms = data.readPtaVec3();
      this.dynamicColors = data.readPtaVec4();
      this.dynamicTexcoords = data.readPtaVec2();

      // Character::fillin
      this.computedVertices = file.getTyped(
        data.readObjectId(),
        ComputedVertices,
      );
    }

    const numParts = data.readUint16();
    this.parts = [];
    for (let i = 0; i < numParts; i++) {
      const ref = data.readObjectId();
      const obj = file.getObject(ref);
      if (!obj) throw new Error(`Character: Invalid part ref @${ref}`);
      this.parts.push(obj);
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.dynamicCoords = this.dynamicCoords; // Shared
    target.dynamicNorms = this.dynamicNorms; // Shared
    target.dynamicColors = this.dynamicColors; // Shared
    target.dynamicTexcoords = this.dynamicTexcoords; // Shared
    target.computedVertices = ctx.clone(this.computedVertices);
    target.parts = ctx.cloneArray(this.parts);
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("dynamicCoords", dbgTypedArray(this.dynamicCoords, 3));
    info.set("dynamicNorms", dbgTypedArray(this.dynamicNorms, 3));
    info.set("computedVertices", dbgRef(this.computedVertices));
    info.set("parts", dbgRefs(this.parts));
    return info;
  }
}

registerTypedObject("Character", Character);
