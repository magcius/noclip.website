import { mat4 } from "gl-matrix";
import {
  CharacterJoint,
  type PartBundle,
  type PartGroup,
  TransformState,
} from "../nodes";
import {
  type AnimationBinding,
  buildParentMap,
  collectJoints,
  type JointBinding,
} from "./Binding";

/**
 * Manages the computation of joint matrices for a character.
 *
 * Computes the matrix chain:
 * 1. For each joint, compose local matrix from animation data
 * 2. Chain with parent: netTransform = localTransform * parent.netTransform
 *
 * Skinning matrices are computed on-demand by JointVertexTransform.getSkinningMatrix()
 * using the joint's netTransform that is updated here.
 */
export class JointChain {
  /** All joints in topological order (parents before children) */
  public readonly joints: CharacterJoint[];

  /** Parent map for the hierarchy */
  private readonly parentMap: Map<PartGroup, PartGroup>;

  /** Map from joint to its channel binding */
  private jointToChannel: Map<CharacterJoint, JointBinding> = new Map();

  /** Root transform from the PartBundle */
  private rootTransform: mat4 = mat4.create();

  constructor(partBundle: PartBundle) {
    this.joints = collectJoints(partBundle);
    this.parentMap = buildParentMap(partBundle);

    // Initialize root transform from PartBundle
    mat4.copy(this.rootTransform, partBundle.rootXform);

    // Initialize joints to bind pose
    this.resetToBindPose();
  }

  /**
   * Set the animation binding for this joint chain.
   */
  setBinding(binding: AnimationBinding | null): void {
    this.jointToChannel.clear();
    if (binding) {
      for (const jb of binding.jointBindings) {
        this.jointToChannel.set(jb.joint, jb);
      }
    }
  }

  /**
   * Reset all joints to their bind pose (initial values).
   */
  resetToBindPose(): void {
    for (const joint of this.joints) {
      // Copy initial value to current value
      mat4.copy(joint.value, joint.initialValue);
    }
    this.updateNetTransforms();
  }

  /**
   * Update joint matrices from animation data at the given frame.
   *
   * @param frame The animation frame to sample
   */
  updateFromAnimation(frame: number): void {
    // Update local transforms from animation channels
    let updated = 0;
    for (const joint of this.joints) {
      const jb = this.jointToChannel.get(joint);
      if (jb) {
        if (jb.channel.lastFrame !== frame) {
          // Get local transform from animation channel
          jb.channel.getValue(joint.value, frame);
          jb.channel.lastFrame = frame;
          updated++;
        }
      }
      // Joints without animation channels keep their current value
    }

    if (updated > 0) {
      // Update net transforms
      this.updateNetTransforms();
    }
  }

  /**
   * Compute net transforms for all joints.
   *
   * For each joint:
   * - netTransform = value * parent.netTransform (or rootTransform if no parent)
   *
   * Skinning matrices are computed on-demand by JointVertexTransform.getSkinningMatrix()
   */
  updateNetTransforms(): void {
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i];
      const parentPart = this.parentMap.get(joint);
      if (parentPart instanceof CharacterJoint) {
        mat4.multiply(joint.netTransform, parentPart.netTransform, joint.value);
      } else {
        mat4.multiply(joint.netTransform, this.rootTransform, joint.value);
      }
      for (const node of joint.netNodes) {
        node.transform = TransformState.fromMatrix(joint.netTransform);
      }
      for (const node of joint.localNodes) {
        node.transform = TransformState.fromMatrix(joint.value);
      }
    }
  }

  /**
   * Get the number of joints.
   */
  get numJoints(): number {
    return this.joints.length;
  }
}
