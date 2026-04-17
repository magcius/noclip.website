/*
 * Update all playing animations: advance time, sample tracks, apply to scene nodes.
 *
 * Walks the scene tree depth-first, building a list of active animations as they are
 * encountered on each node. For each node, all animations in the context are applied
 * one after another (property transforms, file/texture swaps, material color).
 * 
 * petton-svn, 2026.
 */

import { GfxTexture } from "../../gfx/platform/GfxPlatform.js";
import { Color, colorCopy, colorNewFromRGBA } from "../../Color.js";
import {
  AnimationTrack,
  AnimationTrackVec3,
  AnimationTrackAngle,
  AnimationTrackFloat,
  AnimationTrackBool,
  AnimationTrackFileType,
  AnimationTrackFileSwitch,
  AnimationTrackFileUVScroll,
  Buffer as BlvBuffer,
  LocoObject,
  Vec2,
} from "../lib/blv.js";
import { SceneNode, NodeAnimation } from "../SceneTree.js";
import { mat4 } from "gl-matrix";

export function getTrackSampleTime(
  anim: NodeAnimation,
  track: AnimationTrack,
): number {
  const cur =
    track.unk5 === 256 ? anim.currentTime : anim.trackTimes.get(track) || 0;
  return anim.namedPart.part.startTime + cur;
}

const WHITE = colorNewFromRGBA(1,1,1,1)

function advanceTime(node: SceneNode, deltaTimeFrames: number, visited = new Set<NodeAnimation>()): void {
  for (const anim of node.animations) {
    if (!anim.isActive || !anim.isPlaying || visited.has(anim))
      continue;
    visited.add(anim);

    // Advance animation-level time
    const part = anim.namedPart.part;
    if (part) {
      const animDur = part.endTime - part.startTime;
      anim.currentTime += deltaTimeFrames;
      if (animDur > 0 && anim.currentTime > animDur) {
        anim.currentTime = anim.currentTime % animDur;
      }
    }

    // Advance each track independently based on its own duration
    for (const track of anim.namedPart.part.collectTracks()) {
      const trackDur = track.endTime - track.startTime;
      const cur = anim.trackTimes.get(track) || 0;
      const next = cur + deltaTimeFrames;
      anim.trackTimes.set(
        track,
        trackDur > 0 && next > trackDur ? next % trackDur : next,
      );
    }
  }

  for (const child of node.children)
    advanceTime(child, deltaTimeFrames, visited);
}

export function update(
  root: SceneNode,
  deltaTimeSeconds: number,
  textures: ReadonlyMap<BlvBuffer, GfxTexture>,
): void {
  // Advance time for all unique animations
  if (deltaTimeSeconds > 0) {
    const deltaTimeFrames = deltaTimeSeconds * 30;
    advanceTime(root, deltaTimeFrames);
  }

  // Depth-first walk: discover animations, build context, apply, recurse, remove
  const animContext: NodeAnimation[] = [];

  const traverse = (
    node: SceneNode,
    parentWorldMatrix: mat4,
    parentVisible: boolean,
  ) => {
    // Push this node's active animations onto the context
    let pushed = 0;
    for (const anim of node.animations) {
      if (!anim.isActive || !anim.namedPart.part) continue;
      animContext.push(anim);
      pushed++;
    }

    // Apply property animations from context to this node's transform
    let visible = node.baseVisibility;
    let posX = node.baseTransform.posX;
    let posY = node.baseTransform.posY;
    let posZ = node.baseTransform.posZ;
    let rotZ = node.baseTransform.rotZ;
    let scaleX = node.baseTransform.scaleX;
    let scaleY = node.baseTransform.scaleY;
    let scaleZ = node.baseTransform.scaleZ;

    if (node.owner instanceof LocoObject) {
      for (const anim of animContext) {
        const propList = anim.namedPart.part.objectToAnimatedProperties.get(
          node.owner,
        );
        if (!propList) continue;

        for (const prop of propList.properties) {
          if (!prop.data) continue;
          const t = getTrackSampleTime(anim, prop.data);

          if (
            prop.propertyName === "pos" &&
            prop.data instanceof AnimationTrackVec3
          ) {
            const v = prop.data.sample(t);
            posX = v.x;
            posY = v.y;
            posZ = v.z;
          } else if (
            prop.propertyName === "scale" &&
            prop.data instanceof AnimationTrackVec3
          ) {
            const v = prop.data.sample(t);
            scaleX = v.x;
            scaleY = v.y;
            scaleZ = v.z;
          } else if (
            prop.propertyName === "rotZ" &&
            prop.data instanceof AnimationTrackAngle
          ) {
            rotZ = prop.data.sample(t);
          } else if (
            prop.propertyName === "rotZ" &&
            prop.data instanceof AnimationTrackFloat
          ) {
            rotZ = prop.data.sample(t);
          } else if (
            prop.propertyName === "visibility" &&
            prop.data instanceof AnimationTrackBool
          ) {
            visible = prop.data.sample(t);
          }
        }
      }
    }
    visible = parentVisible && visible;

    // Set the render state.
    let localMatrix = node.renderState.localMatrix;
    mat4.identity(localMatrix);
    mat4.translate(localMatrix, localMatrix, [posX, posY, posZ]);
    mat4.rotateZ(localMatrix, localMatrix, rotZ);
    mat4.scale(localMatrix, localMatrix, [scaleX, scaleY, scaleZ]);
    let worldMatrix = node.renderState.worldMatrix;
    mat4.multiply(worldMatrix, parentWorldMatrix, localMatrix);
    node.renderState.visible = visible;

    if (node.meshInstances.length > 0) {
      // Reset the render state
      for (const meshInst of node.meshInstances) {
        const color = meshInst.material?.color ?? WHITE;
        colorCopy(meshInst.renderState.color, color);
        meshInst.renderState.uvOffset[0] = 0;
        meshInst.renderState.uvOffset[1] = 0;
        meshInst.renderState.texture = meshInst.gpuResources.textureMapping.gfxTexture;
        meshInst.renderState.z =
          worldMatrix[2] * 0 +
          worldMatrix[6] * 0 +
          worldMatrix[10] * meshInst.gpuResources.localZ +
          worldMatrix[14] * 1;
      }

      // Apply file and color animations from context to this node's mesh instances
      for (const anim of animContext) {
        const part = anim.namedPart.part;

        // File animations (texture swap, UV scroll)
        for (const fileTrackPtr of part.fileAnimationTracks) {
          const track = fileTrackPtr.track;
          const t = getTrackSampleTime(anim, track);

          if (track instanceof AnimationTrackFileSwitch) {
            const bufPtr = track.sample(t);
            if (bufPtr && bufPtr.buffer) {
              const texture = textures.get(bufPtr.buffer);
              if (texture) {
                for (const meshInst of node.meshInstances) {
                  if (meshInst.file === track.file) {
                    meshInst.renderState.texture = texture;
                  }
                }
              }
            }
          } else if (track instanceof AnimationTrackFileUVScroll) {
            const value = track.sample(t);
            for (const meshInst of node.meshInstances) {
              if (meshInst.file === track.file) {
                if (fileTrackPtr.fileType === AnimationTrackFileType.UScroll) {
                  meshInst.renderState.uvOffset[0] = value;
                } else if (fileTrackPtr.fileType === AnimationTrackFileType.VScroll) {
                  meshInst.renderState.uvOffset[1] = value;
                } else {
                  throw Error("Unknown AnimationTrackFileType")
                }
              }
            }
          }
        }

        // Color animations (material color override)
        for (const colorTrackPtr of part.colorAnimationTracks) {
          const track = colorTrackPtr.track;
          let sampled = null;
          for (const meshInst of node.meshInstances) {
            if (meshInst.material === track.material) {
              if (sampled) {
                colorCopy(meshInst.renderState.color, sampled);
              } else {
                sampled = meshInst.renderState.color;
                track.sampleInto(sampled, getTrackSampleTime(anim, track));
              }
            }
          }
        }
      }
    }

    // Compute path line world matrices
    for (const pl of node.pathLines) {
      const plWorldMatrix = pl.renderState.worldMatrix;
      mat4.copy(plWorldMatrix, worldMatrix);
      if (pl.dontScale) {
        // Strip scale from world matrix: normalize basis columns to keep only translate+rotate
        const col0Len = Math.sqrt(worldMatrix[0] ** 2 + worldMatrix[1] ** 2 + worldMatrix[2] ** 2);
        const col1Len = Math.sqrt(worldMatrix[4] ** 2 + worldMatrix[5] ** 2 + worldMatrix[6] ** 2);
        plWorldMatrix[0] = worldMatrix[0] / col0Len;
        plWorldMatrix[1] = worldMatrix[1] / col0Len;
        plWorldMatrix[4] = worldMatrix[4] / col1Len;
        plWorldMatrix[5] = worldMatrix[5] / col1Len;
        plWorldMatrix[12] = worldMatrix[12];
        plWorldMatrix[13] = worldMatrix[13];
        plWorldMatrix[14] = worldMatrix[14];
      }
    }

    // Recurse into children
    for (const child of node.children) {
      traverse(child, worldMatrix, visible);
    }

    // Pop this node's animations off the context
    animContext.length -= pushed;
  };

  traverse(root, mat4.create(), true);
}

