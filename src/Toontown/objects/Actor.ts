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
    for (const [name, path] of Object.entries(animPaths)) {
      const model = await loader.loadModel(path);
      const animBundleNode = model.findNodeByType(AnimBundleNode);
      if (!animBundleNode) {
        console.error(`Failed to load animation ${path} for ${this.name}`);
        continue;
      }
      const animBundle = animBundleNode.animBundle;
      if (!animBundle) {
        console.error(
          `Failed to load animation bundle for ${path} for ${this.name}`,
        );
        continue;
      }
      anims.set(name, { animBundle: animBundle.clone(), animControl: null });
    }
  }

  getAnimControls(animName: string | null = null): AnimControl[] {
    const controls: AnimControl[] = [];
    for (const [partName, animMap] of this._anims) {
      const partDef = this._parts.get(partName);
      if (!partDef) continue;

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

  pose(animName: string, frame: number): void {
    for (const control of this.getAnimControls(animName)) {
      control.pose(frame);
    }
  }

  loop(animName: string, restart = true): void {
    for (const control of this.getAnimControls(animName)) {
      control.loop(restart);
    }
  }

  stop(animName: string | null = null): void {
    for (const control of this.getAnimControls(animName)) {
      control.stop();
    }
  }

  cleanup(): void {
    // TODO
  }
}
