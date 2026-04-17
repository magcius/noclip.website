/*
 * A pretty slow algorithm for finding what the mouse is clicking.
 *
 * petton-svn, 2026.
 */

import { SceneNode } from "../SceneTree.js";
import { RenderLists } from "./RenderListCollector.js";
import * as Viewer from "../../viewer.js";
import { vec2, vec3, vec4, mat4 } from "gl-matrix";

const clipScratch = vec4.create();

/** Project a world-space point to screen-space pixel coordinates. Returns vec3(sx, sy, clipW). */
function worldToScreen(
  out: vec3,
  clipFromWorld: mat4,
  worldPos: vec3,
  bufferWidth: number,
  bufferHeight: number,
): vec3 {
  vec4.set(clipScratch, worldPos[0], worldPos[1], worldPos[2], 1);
  vec4.transformMat4(clipScratch, clipScratch, clipFromWorld);
  const cw = clipScratch[3];
  out[0] = ((clipScratch[0] / cw) * 0.5 + 0.5) * bufferWidth;
  out[1] = ((-clipScratch[1] / cw) * 0.5 + 0.5) * bufferHeight;
  out[2] = cw;
  return out;
}

/** Shortest distance from point p to segment a-b in pixels. */
function distToSegment(p: vec2, a: vec2, b: vec2): number {
  const bax = b[0] - a[0], bay = b[1] - a[1];
  const pax = p[0] - a[0], pay = p[1] - a[1];
  const dot = bax * bax + bay * bay;
  const t = dot > 0 ? Math.max(0, Math.min(1, (pax * bax + pay * bay) / dot)) : 0;
  const closestX = a[0] + t * bax, closestY = a[1] + t * bay;
  return Math.sqrt((p[0] - closestX) ** 2 + (p[1] - closestY) ** 2);
}

// Hit radius for path lines and cross markers (screen pixels).
const LINE_HIT_RADIUS_PX = 15;
// Z padding added to flat AABBs so the slab test doesn't degenerate.
const FLAT_AABB_Z_PADDING = 1.0;
// Minimum ray direction component before we treat it as parallel.
const RAY_PARALLEL_EPSILON = 0.0001;

/**
 * Perform a hit test at the given screen coordinates.
 * Returns the node that should be selected, or null to deselect.
 */
export function performHitTest(
  screenX: number,
  screenY: number,
  viewerInput: Viewer.ViewerRenderInput,
  scene: RenderLists,
  currentSelection: SceneNode | null,
): SceneNode | null {
  const dpr = window.devicePixelRatio;
  const sx = screenX * dpr;
  const sy = screenY * dpr;
  const meshes = scene.meshes;
  const pathLines = scene.pathLines;

  // Convert screen to NDC
  const ndcX = (sx / viewerInput.backbufferWidth) * 2 - 1;
  const ndcY = -((sy / viewerInput.backbufferHeight) * 2 - 1);

  // Get inverse of clip-from-world matrix to convert NDC to world
  const invClipFromWorld = mat4.create();
  mat4.invert(invClipFromWorld, viewerInput.camera.clipFromWorldMatrix);

  // Build a ray starting at the near plane and going into the scene. noclip
  // uses reverse depth, so the near plane is at NDC z = 1. We cannot use the
  // far plane (NDC z = -1 on WebGL, 0 on WebGPU) to derive the ray direction
  // because perspective cameras run with an infinite far plane, which would
  // inverse-project to a point at infinity. Instead we use an interior NDC z
  // of 0.5, which is always finite in both clip-space conventions.
  const rayOrigin = vec3.create();
  const rayInterior = vec3.create();
  vec3.transformMat4(rayOrigin, [ndcX, ndcY, 1], invClipFromWorld);
  vec3.transformMat4(rayInterior, [ndcX, ndcY, 0.5], invClipFromWorld);

  const rayDir = vec3.create();
  vec3.sub(rayDir, rayInterior, rayOrigin);

  const clipFromWorld = viewerInput.camera.clipFromWorldMatrix;
  const bw = viewerInput.backbufferWidth;
  const bh = viewerInput.backbufferHeight;

  const hitMeshes: {
    node: SceneNode;
    dist: number;
    aabbArea: number;
  }[] = [];

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];

    // Transform local AABB to world space for hit testing
    const localAABB = mesh.gpuResources.localAABB;
    const corners = [
      [localAABB.minX, localAABB.minY, localAABB.minZ],
      [localAABB.maxX, localAABB.minY, localAABB.minZ],
      [localAABB.minX, localAABB.maxY, localAABB.minZ],
      [localAABB.maxX, localAABB.maxY, localAABB.minZ],
      [localAABB.minX, localAABB.minY, localAABB.maxZ],
      [localAABB.maxX, localAABB.minY, localAABB.maxZ],
      [localAABB.minX, localAABB.maxY, localAABB.maxZ],
      [localAABB.maxX, localAABB.maxY, localAABB.maxZ],
    ];

    let worldMinX = Infinity,
      worldMinY = Infinity,
      worldMinZ = Infinity;
    let worldMaxX = -Infinity,
      worldMaxY = -Infinity,
      worldMaxZ = -Infinity;

    for (const corner of corners) {
      const worldCorner = vec3.create();
      vec3.transformMat4(worldCorner, corner as vec3, mesh.node.renderState.worldMatrix);
      worldMinX = Math.min(worldMinX, worldCorner[0]);
      worldMinY = Math.min(worldMinY, worldCorner[1]);
      worldMinZ = Math.min(worldMinZ, worldCorner[2]);
      worldMaxX = Math.max(worldMaxX, worldCorner[0]);
      worldMaxY = Math.max(worldMaxY, worldCorner[1]);
      worldMaxZ = Math.max(worldMaxZ, worldCorner[2]);
    }

    // Ray-AABB intersection (slab method)
    const zPadding = worldMinZ === worldMaxZ ? FLAT_AABB_Z_PADDING : 0;
    const boxMin = [worldMinX, worldMinY, worldMinZ - zPadding];
    const boxMax = [worldMaxX, worldMaxY, worldMaxZ + zPadding];

    let tMin = 0;
    let tMax = Infinity;

    let hit = true;
    for (let axis = 0; axis < 3; axis++) {
      const origin = rayOrigin[axis];
      const dir = rayDir[axis];
      const bMin = boxMin[axis];
      const bMax = boxMax[axis];

      if (Math.abs(dir) < RAY_PARALLEL_EPSILON) {
        if (origin < bMin || origin > bMax) {
          hit = false;
          break;
        }
      } else {
        const invDir = 1.0 / dir;
        let t1 = (bMin - origin) * invDir;
        let t2 = (bMax - origin) * invDir;

        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }

        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);

        if (tMin > tMax) {
          hit = false;
          break;
        }
      }
    }

    if (hit && tMin >= 0) {
      // For circles, inscribe an ellipse in the screen-space AABB and test containment
      if (mesh.debugIsCircle) {
        const worldCenter: vec3 = [(worldMinX + worldMaxX) / 2, (worldMinY + worldMaxY) / 2, (worldMinZ + worldMaxZ) / 2];
        const screenCenter = worldToScreen(vec3.create(), clipFromWorld, worldCenter, bw, bh);
        const screenCornerMin = worldToScreen(vec3.create(), clipFromWorld, [worldMinX, worldMinY, worldCenter[2]], bw, bh);
        const screenCornerMax = worldToScreen(vec3.create(), clipFromWorld, [worldMaxX, worldMaxY, worldCenter[2]], bw, bh);

        const rx = Math.abs(screenCornerMax[0] - screenCornerMin[0]) / 2;
        const ry = Math.abs(screenCornerMax[1] - screenCornerMin[1]) / 2;

        if (rx > 0 && ry > 0) {
          const dx = (sx - screenCenter[0]) / rx;
          const dy = (sy - screenCenter[1]) / ry;
          if (dx * dx + dy * dy > 1) continue;
        }
      }

      const aabbArea = (worldMaxX - worldMinX) * (worldMaxY - worldMinY);
      hitMeshes.push({
        node: mesh.node,
        dist: tMin,
        aabbArea: mesh.debugIsCircle ? aabbArea * (Math.PI / 4) : aabbArea,
      });
    }
  }

  // Hit test path lines from the flat collected array
  const hitNodes = new Set<SceneNode>();
  for (const pl of pathLines) {
    if (hitNodes.has(pl.node)) continue;
    let hit = false;
    for (const strip of pl.strips) {
      for (let pi = 0; pi < strip.length - 1; pi++) {
        const p1 = strip[pi];
        const p2 = strip[pi + 1];

        const w1 = vec3.transformMat4(vec3.create(), [p1.x, p1.y, 0], pl.renderState.worldMatrix);
        const w2 = vec3.transformMat4(vec3.create(), [p2.x, p2.y, 0], pl.renderState.worldMatrix);

        const s1 = worldToScreen(vec3.create(), clipFromWorld, w1, bw, bh);
        const s2 = worldToScreen(vec3.create(), clipFromWorld, w2, bw, bh);

        if (
          distToSegment([sx, sy], s1 as vec2, s2 as vec2) <=
          LINE_HIT_RADIUS_PX
        ) {
          hitNodes.add(pl.node);
          hitMeshes.push({ node: pl.node, dist: 0, aabbArea: 0 });
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
  }

  if (hitMeshes.length === 0) {
    return null;
  }

  // Sort by AABB area ascending (smallest first), then by distance as tiebreaker
  hitMeshes.sort((a, b) => {
    const areaDiff = a.aabbArea - b.aabbArea;
    if (Math.abs(areaDiff) > 0.001) return areaDiff;
    return a.dist - b.dist;
  });

  // Deduplicate by node
  const seenNodes = new Set<SceneNode>();
  const uniqueHits: typeof hitMeshes = [];
  for (const hit of hitMeshes) {
    if (!seenNodes.has(hit.node)) {
      seenNodes.add(hit.node);
      uniqueHits.push(hit);
    }
  }

  // If clicking on already selected node, cycle to next one behind it
  if (currentSelection !== null) {
    const currentIdx = uniqueHits.findIndex(
      (h) => h.node === currentSelection,
    );
    if (currentIdx !== -1 && currentIdx < uniqueHits.length - 1) {
      return uniqueHits[currentIdx + 1].node;
    } else {
      return uniqueHits[0].node;
    }
  } else {
    return uniqueHits[0].node;
  }
}
