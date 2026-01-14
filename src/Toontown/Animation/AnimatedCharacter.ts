import type { AnimBundle } from "../nodes/AnimBundle";
import type { Character } from "../nodes/Character";
import type { PartBundle } from "../nodes/PartBundle";
import { AnimControl } from "./AnimControl";
import { bindAnimation } from "./Binding";
import { JointChain } from "./JointChain";

/**
 * Manages animation playback and skinning for a character.
 *
 * This class ties together:
 * - Character: The scene graph node containing the skeleton
 * - JointChain: Computes joint matrices each frame
 * - AnimControl[]: Playback controllers for each animation
 * - Skinning: Fills the bone matrix uniform buffer for rendering
 */
export class AnimatedCharacter {
  /** The character node from the scene graph */
  public readonly character: Character;

  /** The part bundle (skeleton) */
  public readonly partBundle: PartBundle;

  /** Joint chain for matrix computation */
  public readonly jointChain: JointChain;

  /** Animation playback controllers */
  private readonly controls: AnimControl[] = [];

  /** Currently active animation control */
  private activeControl: AnimControl | null = null;

  constructor(character: Character) {
    this.character = character;

    // Find the PartBundle in the character's partBundles
    const partBundle = character.partBundles[0];
    if (!partBundle) {
      throw new Error("Character has no PartBundle");
    }
    this.partBundle = partBundle;

    // Create joint chain for matrix computation
    this.jointChain = new JointChain(partBundle);
  }

  /**
   * Add an animation to this character.
   * @param animBundle The animation data
   * @returns An AnimControl for playback
   */
  addAnimation(animBundle: AnimBundle): AnimControl {
    const control = new AnimControl(animBundle);
    this.controls.push(control);
    return control;
  }

  /**
   * Play an animation.
   * @param control The animation control to play
   * @param loop Whether to loop the animation
   */
  playAnimation(control: AnimControl, loop = true): void {
    // Bind the animation to the skeleton
    const binding = bindAnimation(control.anim, this.partBundle);
    this.jointChain.setBinding(binding);
    this.activeControl = control;

    if (loop) {
      control.loop();
    } else {
      control.play();
    }
  }

  /**
   * Stop the currently playing animation.
   */
  stopAnimation(): void {
    if (this.activeControl) {
      this.activeControl.stop();
    }
    this.jointChain.setBinding(null);
    this.jointChain.resetToBindPose();
    this.activeControl = null;
  }

  /**
   * Update the animation state.
   * @param deltaTimeMs Time elapsed since last update in milliseconds
   */
  update(deltaTimeMs: number): void {
    if (this.activeControl) {
      // Update animation playback
      this.activeControl.update(deltaTimeMs);

      // Update joint matrices from animation
      this.jointChain.updateFromAnimation(this.activeControl.getFrame());
    }
  }
}
