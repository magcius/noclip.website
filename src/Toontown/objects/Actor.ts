import { AnimControl } from "../anim/AnimControl";
import { getLoader } from "../Common";
import { ActorInterval, type ActorIntervalOptions } from "../interval";
import {
  type AnimBundle,
  AnimBundleNode,
  Character,
  PandaNode,
  type PartBundle,
} from "../nodes";

interface PartDef {
  character: Character;
  partBundle: PartBundle;
}

interface AnimDef {
  animBundle: AnimBundle;
  animControl: AnimControl | null;
}

export class Actor extends PandaNode {
  // Part name -> PartDef
  protected _parts = new Map<string, PartDef>();
  // Part name -> Anim name -> AnimDef
  protected _anims = new Map<string, Map<string, AnimDef>>();

  addModel(model: PandaNode, partName = "modelRoot"): void {
    // Find the Character node
    const character = model.findNodeByType(Character);
    if (!character)
      throw new Error(`Character not found in model ${model.name}`);
    if (character.partBundles.length !== 1)
      throw new Error(
        `Expected exactly one part bundle in model ${model.name}, got ${character.partBundles.length}`,
      );

    // Move the model to the actor
    model.reparentTo(this);

    // Add the character's part bundle to the actor
    this._parts.set(partName, {
      character,
      partBundle: character.partBundles[0],
    });

    // Copy the name to the Actor and rename the Character node
    if (this.name.length === 0) this.name = character.name;
    character.name = `__Actor_${partName}`;
  }

  async loadModel(modelPath: string, partName = "modelRoot"): Promise<void> {
    // Load model from cache
    const model = await getLoader().loadModel(modelPath);
    const modelChar = model.findNodeByType(Character);
    if (!modelChar)
      throw new Error(`Character not found in model ${modelPath}`);
    if (modelChar.partBundles.length !== 1)
      throw new Error(
        `Expected exactly one part bundle in model ${modelPath}, got ${modelChar.partBundles.length}`,
      );

    // Check for any AnimBundleNodes
    const animBundleNodes = model.findAllNodesByType(AnimBundleNode);
    if (animBundleNodes.length > 0) {
      console.warn("TODO: Auto-bind animation bundles", animBundleNodes);
    }

    // Clone the character to the actor
    const character = modelChar.cloneTo(this);

    // Add the character's part bundle to the actor
    this._parts.set(partName, {
      character,
      partBundle: character.partBundles[0],
    });

    // Copy the name to the Actor and rename the Character node
    if (this.name.length === 0) this.name = character.name;
    character.name = `__Actor_${partName}`;
  }

  async loadAnims(
    animPaths: Record<string, string>,
    partName = "modelRoot",
  ): Promise<void> {
    const partDef = this._parts.get(partName);
    if (!partDef) throw new Error(`Part not found: ${partName}`);

    let anims = this._anims.get(partName);
    if (!anims) {
      anims = new Map();
      this._anims.set(partName, anims);
    }

    const loader = getLoader();
    const promises: Promise<void>[] = [];
    for (const [name, path] of Object.entries(animPaths)) {
      promises.push(
        loader.loadModel(path).then(
          (model) => {
            const animBundleNode = model.findNodeByType(AnimBundleNode);
            if (!animBundleNode) {
              console.warn(
                `Failed to load animation node ${path} for ${this.name}`,
              );
              return;
            }
            const animBundle = animBundleNode.animBundle;
            if (!animBundle) {
              console.warn(
                `Failed to load animation bundle for ${path} for ${this.name}`,
              );
              return;
            }
            anims.set(name, {
              animBundle: animBundle.clone(),
              animControl: null,
            });
          },
          () => {
            console.warn(`Failed to load animation ${path} for ${this.name}`);
          },
        ),
      );
    }
    await Promise.all(promises);
  }

  getAnimControls(
    animName: string | null = null,
    partName: string | null = null,
  ): AnimControl[] {
    const parts: [PartDef, Map<string, AnimDef>][] = [];
    if (partName) {
      const partDef = this._parts.get(partName);
      if (!partDef) return [];
      const animMap = this._anims.get(partName);
      if (!animMap) return [];
      parts.push([partDef, animMap]);
    } else {
      for (const [partName, animMap] of this._anims) {
        const partDef = this._parts.get(partName);
        if (!partDef) continue;
        parts.push([partDef, animMap]);
      }
    }

    const controls: AnimControl[] = [];
    for (const [partDef, animMap] of parts) {
      let anims = [];
      if (animName !== null) {
        const anim = animMap.get(animName);
        if (!anim) continue;
        anims = [anim];
      } else {
        anims = Array.from(animMap.values());
      }

      for (const anim of anims) {
        let control = anim.animControl;
        if (!control) {
          control = new AnimControl(partDef.partBundle);
          partDef.partBundle.bindAnim(control, anim.animBundle);
          anim.animControl = control;
        }
        controls.push(control);
      }
    }
    return controls;
  }

  actorInterval(
    animName: string,
    options?: ActorIntervalOptions,
  ): ActorInterval {
    return new ActorInterval(this.getAnimControls(animName), options);
  }

  pose(animName: string, frame: number, partName: string | null = null): void {
    for (const control of this.getAnimControls(animName, partName)) {
      control.pose(frame);
    }
  }

  loop(animName: string, restart = true, partName: string | null = null): void {
    for (const control of this.getAnimControls(animName, partName)) {
      control.loop(restart);
    }
  }

  stop(animName: string | null = null, partName: string | null = null): void {
    for (const control of this.getAnimControls(animName, partName)) {
      control.stop();
    }
  }

  setPlayRate(
    rate: number,
    animName: string,
    partName: string | null = null,
  ): void {
    for (const control of this.getAnimControls(animName, partName)) {
      control.setRate(undefined, rate);
    }
  }

  cleanup(): void {
    // TODO
  }

  attach(sourcePart: string, targetPart: string, jointName: string) {
    const source = this._parts.get(sourcePart);
    const target = this._parts.get(targetPart);
    if (!source || !target) return;

    const joint = target.character.find(`**/${jointName}`);
    if (!joint) return;

    source.character.reparentTo(joint);
  }

  getPart(partName: string): Character | null {
    return this._parts.get(partName)?.character ?? null;
  }

  getPartBundle(partName: string): PartBundle | null {
    return this._parts.get(partName)?.partBundle ?? null;
  }

  getAllAnimations(): Set<string> {
    const animations = new Set<string>();
    for (const [_, animMap] of this._anims) {
      for (const [name, _] of animMap) {
        animations.add(name);
      }
    }
    return animations;
  }
}
