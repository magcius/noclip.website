import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgArray, dbgStr, dbgVec3 } from "./debug";
import { PandaNode } from "./PandaNode";

export interface LODSwitch {
  in: number; // Near distance
  out: number; // Far distance
}

/**
 * LODNode - Level of Detail node
 *
 * Switches between child nodes based on distance from camera.
 *
 * Version differences:
 * - BAM < 4.13: Stored squared distances
 * - BAM >= 4.13: Stores actual distances
 */
export class LODNode extends PandaNode {
  public center: [number, number, number] = [0, 0, 0];
  public switches: LODSwitch[] = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // CData::fillin
    this.center = data.readVec3();

    const numSwitches = data.readUint16();
    for (let i = 0; i < numSwitches; i++) {
      const inDist = data.readFloat32();
      const outDist = data.readFloat32();

      // BAM < 4.13 stored squared distances
      if (file.header.version.compare(new AssetVersion(4, 13)) < 0) {
        this.switches.push({
          in: Math.sqrt(inDist),
          out: Math.sqrt(outDist),
        });
      } else {
        this.switches.push({ in: inDist, out: outDist });
      }
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("center", dbgVec3(this.center));
    info.set(
      "switches",
      dbgArray(
        this.switches.map((s) =>
          dbgStr(`${s.in.toFixed(1)}-${s.out.toFixed(1)}`),
        ),
      ),
    );
    return info;
  }
}

registerBAMObject("LODNode", LODNode);
