import { Sequence, Wait } from "../interval";
import { Actor } from "./Actor";
import { AnimatedProp, animatedPropMap } from "./AnimatedProp";

export class HQTelescopeAnimatedProp extends AnimatedProp {
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
      anim: "phase_3.5/models/props/HQ_telescope-chan",
    });
    actor.pose("anim", 0);
    this._actor = actor;

    this._track = new Sequence(
      [
        Wait(5.0),
        // Pop up
        actor.actorInterval("anim", {
          startFrame: 0,
          endFrame: 32,
        }),
        Wait(0.5),
        // Move right
        actor.actorInterval("anim", {
          startFrame: 32,
          endFrame: 78,
        }),
        Wait(0.5),
        // Move left
        actor.actorInterval("anim", {
          startFrame: 79,
          endFrame: 112,
        }),
        Wait(0.5),
        // Move left (reverse)
        actor.actorInterval("anim", {
          startFrame: 112,
          endFrame: 79,
        }),
        Wait(0.5),
        // Move right (reverse)
        actor.actorInterval("anim", {
          startFrame: 78,
          endFrame: 32,
        }),
        Wait(0.5),
        // Move right
        actor.actorInterval("anim", {
          startFrame: 32,
          endFrame: 78,
        }),
        Wait(0.5),
        // Move left
        actor.actorInterval("anim", {
          startFrame: 79,
          endFrame: 112,
        }),
        Wait(0.5),
        // End
        actor.actorInterval("anim", {
          startFrame: 112,
          endFrame: 148,
        }),
        Wait(4.0),
      ],
      "HQTelescope",
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

animatedPropMap.set("HQTelescopeAnimatedProp", HQTelescopeAnimatedProp);
