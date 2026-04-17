/**
 * Collect visible meshes and path lines from the scene tree into flat render lists.
 *
 * petton-svn, 2026.
 */

import { SceneNode, NodeMeshInstance, PathLine } from "../SceneTree.js";

const UI_OBJECT_TYPES = new Set(["tutorialmuimui", "muising", "frontanim", "goalscore"]);

export interface CollectOptions {
  showWorld: boolean;
  showObjects: boolean;
  showDebugOverlays: boolean;
  hiddenObjectTypes: Set<string>;
  focusedTypes: Set<string> | null;
  cameraZ: number;
}

export interface RenderLists {
  /** All collected meshes (flat, for hit-testing). */
  meshes: NodeMeshInstance[];
  /** Non-debug, non-focused meshes, sorted by Z relative to camera. */
  normalMeshes: NodeMeshInstance[];
  /** Non-debug focused meshes, sorted by Z relative to camera. */
  focusedMeshes: NodeMeshInstance[];
  /** Debug overlay meshes, sorted by Z relative to camera. */
  debugMeshes: NodeMeshInstance[];
  pathLines: PathLine[];
}

function sortRelativeToCamera(meshes: NodeMeshInstance[], cameraZ: number): NodeMeshInstance[] {
  const behind: NodeMeshInstance[] = [];
  const inFront: NodeMeshInstance[] = [];
  for (const m of meshes) {
    if (m.renderState.z < cameraZ) behind.push(m);
    else inFront.push(m);
  }
  behind.sort((a, b) => a.renderState.z - b.renderState.z);
  inFront.sort((a, b) => b.renderState.z - a.renderState.z);
  return [...behind, ...inFront];
}

export function collectRenderLists(
  root: SceneNode,
  options: CollectOptions,
): RenderLists {
  const meshes: NodeMeshInstance[] = [];
  const pathLines: PathLine[] = [];
  const { showWorld, showObjects, showDebugOverlays, hiddenObjectTypes, focusedTypes, cameraZ } = options;

  const traverse = (
    node: SceneNode,
    ancestorHidden: boolean,
    ancestorIsUI: boolean,
    ancestorFocused: boolean,
  ) => {
    if (!node.renderState.visible) return;

    const ot = node.objectType;
    const isSignificantType = ot !== "" && ot !== "root" && ot !== "subRoot" && ot !== "levelGrid";
    const nodeHidden = ancestorHidden || (isSignificantType && hiddenObjectTypes.has(ot));
    const nodeIsUI = ancestorIsUI || UI_OBJECT_TYPES.has(ot);
    const nodeFocused = ancestorFocused || (focusedTypes !== null && focusedTypes.has(ot));

    // Collect visible meshes
    if (!nodeHidden) {
      for (const meshInst of node.meshInstances) {
        meshInst.renderState.isFocused = nodeFocused;
        if (meshInst.isDebug && !showDebugOverlays) continue;
        if (!showWorld && ot === "levelGrid") continue;
        if (!showObjects && !meshInst.isDebug && ot !== "levelGrid" && !nodeIsUI) continue;
        meshes.push(meshInst);
      }
    }

    // Collect path lines
    if (showDebugOverlays) {
      for (const pl of node.pathLines) {
        pathLines.push(pl);
      }
    }

    for (const child of node.children) {
      traverse(child, nodeHidden, nodeIsUI, nodeFocused);
    }
  };

  traverse(root, false, false, false);

  // Split and sort
  const normal: NodeMeshInstance[] = [];
  const focused: NodeMeshInstance[] = [];
  const debug: NodeMeshInstance[] = [];
  for (const m of meshes) {
    if (m.isDebug) debug.push(m);
    else if (m.renderState.isFocused) focused.push(m);
    else normal.push(m);
  }

  return {
    meshes,
    normalMeshes: sortRelativeToCamera(normal, cameraZ),
    focusedMeshes: sortRelativeToCamera(focused, cameraZ),
    debugMeshes: sortRelativeToCamera(debug, cameraZ),
    pathLines
  };
}
