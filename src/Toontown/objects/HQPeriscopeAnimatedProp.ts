import { Sequence, Wait } from "../interval";
import { Actor } from "./Actor";
import { AnimatedProp, animatedPropMap } from "./AnimatedProp";

export class HQPeriscopeAnimatedProp extends AnimatedProp {
  private _actor: Actor;
  private _track: Sequence;

  override async init(): Promise<void> {
    await super.init();

    const parent = this.node.parent;
    if (!parent) throw new Error("Node without parent");

    const actor = new Actor();
    actor.addModel(this.node);
    actor.reparentTo(parent);
    await actor.loadAnims({
      anim: "phase_3.5/models/props/HQ_periscope-chan",
    });
    actor.pose("anim", 0);
    this._actor = actor;

    this._track = new Sequence(
      [
        Wait(2.0),
        // Pop up
        actor.actorInterval("anim", {
          startFrame: 0,
          endFrame: 40,
        }),
        Wait(0.7),
        // Move right
        actor.actorInterval("anim", {
          startFrame: 40,
          endFrame: 90,
        }),
        Wait(0.7),
        // Move left
        actor.actorInterval("anim", {
          startFrame: 90,
          endFrame: 121,
        }),
        Wait(0.7),
        // Move left (reverse)
        actor.actorInterval("anim", {
          startFrame: 121,
          endFrame: 91,
        }),
        Wait(0.7),
        // Move right (reverse)
        actor.actorInterval("anim", {
          startFrame: 90,
          endFrame: 40,
        }),
        Wait(0.7),
        // Move right
        actor.actorInterval("anim", {
          startFrame: 40,
          endFrame: 90,
        }),
        Wait(0.7),
        // Move left
        actor.actorInterval("anim", {
          startFrame: 91,
          endFrame: 121,
        }),
        Wait(0.5),
        // End
        actor.actorInterval("anim", {
          startFrame: 121,
          endFrame: 148,
        }),
        Wait(3.0),
      ],
      "HQPeriscope",
    );
  }

  override enter(): void {
    this._track.loop();
  }

  override exit(): void {
    this._track.pause();
  }

  override delete(): void {
    this._actor.cleanup();
  }
}

animatedPropMap.set("HQPeriscopeAnimatedProp", HQPeriscopeAnimatedProp);
