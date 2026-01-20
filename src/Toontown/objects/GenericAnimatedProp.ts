import { Actor } from "./Actor";
import { AnimatedProp, animatedPropMap } from "./AnimatedProp";
import { getHoodId } from "./Globals";

export class GenericAnimatedProp extends AnimatedProp {
  protected _path: string;
  protected _actor: Actor;
  protected _zoneId: number;
  protected _hoodId: number;

  override async init(): Promise<void> {
    await super.init();

    this._zoneId = this.getZoneId();
    this._hoodId = getHoodId(this._zoneId);

    const parent = this.node.parent;
    if (!parent) throw new Error("Node without parent");

    const code = this.node.tags.get("DNACode");
    if (!code) throw new Error("DNACode not found");
    let extracted: string;
    if (code.startsWith("interactive_prop_")) {
      extracted = code.substring("interactive_prop_".length).split("__")[0];
    } else if (code.startsWith("animated_prop_generic_")) {
      extracted = code
        .substring("animated_prop_generic_".length)
        .split("__")[0];
    } else if (code.startsWith("animated_prop_")) {
      extracted = code.substring("animated_prop_".length).split("_")[0];
    } else if (code.startsWith("animated_building_")) {
      extracted = code.substring("animated_building_".length).split("__")[0];
    } else {
      throw new Error("Invalid DNACode");
    }

    const phaseDelimiter =
      "phase_".length + extracted.substring("phase_".length).indexOf("_");
    const phase = extracted.substring(0, phaseDelimiter);
    const pathTokens = extracted.substring(phaseDelimiter + 1).split("_");
    let path = phase;
    for (const token of pathTokens) {
      path += `/${token}`;
    }
    this._path = path;

    const anim = this.node.tags.get("DNAAnim");
    if (!anim) throw new Error("DNAAnim not found");

    const actor = new Actor();
    actor.addModel(this.node);
    actor.reparentTo(parent);
    // await actor.loadAnims({ anim: `${this._path}/${anim}` });
    // actor.pose("anim", 0);
    this._actor = actor;
  }

  override enter(): void {
    // It seems the generic props don't play automatically
    // this._actor.loop("anim");
  }

  override exit(): void {
    this._actor.stop();
  }

  override delete(): void {
    this._actor.cleanup();
  }

  private getZoneId(): number {
    let node = this.node.parent;
    while (node) {
      if (node.tags.get("DNAType") === "DNAVisGroup") {
        // 2000:safe_zone -> 2000
        const zoneIdStr = node.name.split(":")[0];
        const zoneId = parseInt(zoneIdStr, 10);
        if (!Number.isNaN(zoneId)) return zoneId;
      }
      node = node.parent;
    }
    return -1;
  }
}

animatedPropMap.set("GenericAnimatedProp", GenericAnimatedProp);
