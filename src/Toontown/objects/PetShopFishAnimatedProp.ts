import { Actor } from "./Actor";
import { AnimatedProp, animatedPropMap } from "./AnimatedProp";

export class PetShopFishAnimatedProp extends AnimatedProp {
  private _actor: Actor;

  override async init(): Promise<void> {
    await super.init();

    const parent = this.node.parent;
    if (!parent) throw new Error("Node without parent");

    const actor = new Actor();
    actor.addModel(this.node);
    actor.reparentTo(parent);
    await actor.loadAnims({
      swim: "phase_4/models/props/exteriorfish-swim",
    });
    actor.pose("swim", 0);
    this._actor = actor;
  }

  override enter(): void {
    this._actor.loop("swim");
  }

  override exit(): void {
    this._actor.stop();
  }

  override delete(): void {
    this._actor.cleanup();
  }
}

animatedPropMap.set("PetShopFishAnimatedProp", PetShopFishAnimatedProp);
