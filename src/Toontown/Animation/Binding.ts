import type { AnimBundle } from "../nodes/AnimBundle";
import { AnimChannelMatrixXfmTable } from "../nodes/AnimChannelMatrixXfmTable";
import type { AnimGroup } from "../nodes/AnimGroup";
import { CharacterJoint } from "../nodes/CharacterJoint";
import type { PartBundle } from "../nodes/PartBundle";
import type { PartGroup } from "../nodes/PartGroup";

/**
 * Binding between a joint (MovingPartMatrix) and its animation channel.
 */
export interface JointBinding {
  joint: CharacterJoint;
  channel: AnimChannelMatrixXfmTable;
}

/**
 * Result of binding an animation to a character.
 */
export interface AnimationBinding {
  animBundle: AnimBundle;
  partBundle: PartBundle;
  jointBindings: JointBinding[];
}

/**
 * Bind an animation bundle to a part bundle by matching names.
 *
 * Traverses both hierarchies in parallel, matching nodes by name.
 * Creates bindings between MovingPartMatrix joints and AnimChannelMatrixXfmTable channels.
 *
 * @param animBundle The animation data
 * @param partBundle The character skeleton
 * @returns The binding result with matched joints and channels
 */
export function bindAnimation(
  animBundle: AnimBundle,
  partBundle: PartBundle,
): AnimationBinding {
  const jointBindings: JointBinding[] = [];

  // Build a name->channel map from the animation hierarchy
  const channelMap = new Map<string, AnimChannelMatrixXfmTable>();
  collectChannels(animBundle, channelMap);

  // Traverse the part hierarchy and match to channels
  collectJointBindings(partBundle, channelMap, jointBindings);

  return {
    animBundle,
    partBundle,
    jointBindings,
  };
}

/**
 * Recursively collect all animation channels into a name map.
 */
function collectChannels(
  group: AnimGroup,
  channelMap: Map<string, AnimChannelMatrixXfmTable>,
): void {
  if (group instanceof AnimChannelMatrixXfmTable) {
    channelMap.set(group.name, group);
  }
  for (const child of group.children) {
    collectChannels(child, channelMap);
  }
}

/**
 * Recursively collect joint bindings by matching part names to channel names.
 */
function collectJointBindings(
  part: PartGroup,
  channelMap: Map<string, AnimChannelMatrixXfmTable>,
  bindings: JointBinding[],
): void {
  // Check if this is a CharacterJoint
  if (part instanceof CharacterJoint) {
    const channel = channelMap.get(part.name);
    if (channel) {
      bindings.push({
        joint: part,
        channel,
      });
    }
  }

  // Recurse into children
  for (const child of part.children) {
    collectJointBindings(child, channelMap, bindings);
  }
}

/**
 * Find all CharacterJoints in a part hierarchy.
 * Returns them in topological order (parents before children).
 */
export function collectJoints(part: PartGroup): CharacterJoint[] {
  const joints: CharacterJoint[] = [];
  collectJointsRecursive(part, joints);
  return joints;
}

function collectJointsRecursive(
  part: PartGroup,
  joints: CharacterJoint[],
): void {
  if (part instanceof CharacterJoint) {
    joints.push(part);
  }
  for (const child of part.children) {
    collectJointsRecursive(child, joints);
  }
}

/**
 * Build a parent map for the part hierarchy.
 * Maps each PartGroup to its parent PartGroup.
 */
export function buildParentMap(root: PartGroup): Map<PartGroup, PartGroup> {
  const parentMap = new Map<PartGroup, PartGroup>();
  buildParentMapRecursive(root, null, parentMap);
  return parentMap;
}

function buildParentMapRecursive(
  part: PartGroup,
  parent: PartGroup | null,
  parentMap: Map<PartGroup, PartGroup>,
): void {
  if (parent) {
    parentMap.set(part, parent);
  }
  for (const child of part.children) {
    buildParentMapRecursive(child, part, parentMap);
  }
}
