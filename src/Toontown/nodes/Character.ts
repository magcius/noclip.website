import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgArray, dbgRef, dbgRefs, dbgVec3 } from "./debug";
import { LegacyGeom } from "./LegacyGeom";
import { PandaNode } from "./PandaNode";

/**
 * Character - BAM animated character
 *
 * This extends PartBundleNode (which extends PandaNode).
 *
 * Pre-5.0 format:
 *   Character contains DynamicVertices inline (not as a separate object)
 *   which stores PTAs that are shared with LegacyGeom objects.
 *   Also has a pointer to ComputedVertices.
 *
 * 5.0+ format:
 *   No DynamicVertices or ComputedVertices. Just PartBundleNode + parts pointers.
 *
 * The inheritance chain is:
 *   Character -> PartBundleNode -> PandaNode
 */
export class Character extends PandaNode {
  // PartBundleNode fields
  public bundleRef: number = 0;

  // DynamicVertices inline data (pre-5.0 only) - these PTAs are shared with Geoms
  public dynamicCoords: Array<[number, number, number]> = [];
  public dynamicNorms: Array<[number, number, number]> = [];
  public dynamicColors: Array<[number, number, number, number]> = [];
  public dynamicTexcoords: Array<[number, number]> = [];

  // Character fields
  public computedVerticesRef: number = 0;
  public partRefs: number[] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    // Read PandaNode fields
    super(objectId, file, data);

    // PartBundleNode::fillin - read pointer(s) to bundle(s)
    // In BAM 6.5+, there can be multiple bundles
    let numBundles = 1;
    if (file.header.version.compare(new AssetVersion(6, 5)) >= 0) {
      numBundles = data.readUint16();
    }
    this.bundleRef = data.readObjectId();
    // Skip additional bundle pointers (we only store the first one)
    for (let i = 1; i < numBundles; i++) {
      data.readObjectId();
    }

    // Pre-5.0 format has DynamicVertices and ComputedVertices
    if (file.header.version.compare(new AssetVersion(5, 0)) < 0) {
      // DynamicVertices::fillin - read 4 PTAs
      // These use the global PTA cache so they can be shared with LegacyGeom
      this.dynamicCoords = LegacyGeom.readPtaVec3Global(data);
      this.dynamicNorms = LegacyGeom.readPtaVec3Global(data);
      this.dynamicColors = LegacyGeom.readPtaVec4Global(data);
      this.dynamicTexcoords = LegacyGeom.readPtaVec2Global(data);

      // Character::fillin - read pointer to ComputedVertices
      this.computedVerticesRef = data.readObjectId();
    }

    // Read parts array (both formats)
    const numParts = data.readUint16();
    this.partRefs = [];
    for (let i = 0; i < numParts; i++) {
      this.partRefs.push(data.readObjectId());
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("bundleRef", dbgRef(this.bundleRef));
    info.set("dynamicCoords", dbgArray(this.dynamicCoords.map(dbgVec3)));
    info.set("dynamicNorms", dbgArray(this.dynamicNorms.map(dbgVec3)));
    info.set("computedVerticesRef", dbgRef(this.computedVerticesRef));
    info.set("parts", dbgRefs(this.partRefs));
    return info;
  }
}

registerBAMObject("Character", Character);
