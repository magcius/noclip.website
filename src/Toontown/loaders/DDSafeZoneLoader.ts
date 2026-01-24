import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { HOOD_ID_DONALDS_DOCK } from "../Globals";
import type { ToontownLoader } from "../Loader";
import {
  NurbsCurve,
  type PandaNode,
  TransparencyAttrib,
  TransparencyMode,
} from "../nodes";
import { Char } from "../objects";
import { SafeZoneLoader } from "./SafeZoneLoader";

export class DDSafeZoneLoader extends SafeZoneLoader {
  private _char: Char;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader, HOOD_ID_DONALDS_DOCK);
    this.storageDNAFiles.push(
      "phase_6/dna/storage_DD",
      "phase_6/dna/storage_DD_town",
      "phase_6/dna/storage_DD_sz",
    );
    this.dnaFile = "phase_6/dna/donalds_dock_sz";
    this.skyFile = "phase_3.5/models/props/BR_sky";
    this.musicFile = "phase_6/audio/bgm/DD_nbrhood.mid";
  }

  override async load(): Promise<void> {
    await super.load();

    // Make water transparent
    const water = this.scene.find("**/water");
    if (water) {
      water.setAttrib(TransparencyAttrib.create(TransparencyMode.Alpha));
      water.setColor(vec4.fromValues(1, 1, 1, 0.8));
    }

    // Place boat at pier
    const boat = this.scene.find("**/donalds_boat");
    if (!boat) return;
    const ewPath = await this.loader.loadModel("phase_6/paths/dd-e-w");
    // const wePath = await loader.loadModel("phase_6/paths/dd-w-e");
    const ewXyz = ewPath.find("**/*_xyz");
    if (ewXyz instanceof NurbsCurve && boat) {
      console.log(ewXyz);
      boat.pos = ewXyz.cvs[3].point as vec3;
    }

    // Raise west pier
    const westPier = this.scene.find("**/west_pier");
    if (westPier) westPier.hpr = vec3.fromValues(-90, 0.25, 0);

    // Spawn Donald
    this._char = new Char();
    await this._char.generateChar("dw");
    await this._char.init();
    this._char.pos = vec3.fromValues(0, -1, 3.95);
    boat.addChild(this._char);
    boat.find("**/wheel")?.hide(); // Hide boat wheel since Donald has one
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return DROP_POINTS;
  }
}

const DROP_POINTS: readonly [ReadonlyVec3, number][] = [
  [vec3.fromValues(-28.0, -2.5, 5.8), 120.0],
  [vec3.fromValues(-22, 13, 5.8), 155.6],
  [vec3.fromValues(67, 47, 5.7), 134.7],
  [vec3.fromValues(62, 19, 5.7), 97.0],
  [vec3.fromValues(66, -27, 5.7), 80.5],
  [vec3.fromValues(-114, -7, 5.7), -97.0],
  [vec3.fromValues(-108, 36, 5.7), -153.8],
  [vec3.fromValues(-116, -46, 5.7), -70.1],
  [vec3.fromValues(-63, -79, 5.7), -41.2],
  [vec3.fromValues(-2, -79, 5.7), 57.4],
  [vec3.fromValues(-38, -78, 5.7), 9.1],
];
