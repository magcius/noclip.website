/*
 * Main renderer.
 *
 * petton-svn, 2026.
 */

import {
  readBlvBuffer,
  GameVersion,
} from "./lib/blv.js";
import { extractSignalGraph } from "./render/signalgraph/SignalGraph.js";
import { SignalGraphRenderer } from "./render/signalgraph/SignalGraphRenderer.js";
import { SelectionInfoElement } from "./render/SelectionInfoElement.js";
import { readGarc, Garc } from "./lib/garc.js";
import { readStpm, findLevelByName, stpmColorToRGBA } from "./lib/stpm.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import {
  makeBackbufferDescSimple,
  makeAttachmentClearDescriptor,
} from "../gfx/helpers/RenderGraphHelpers.js";
import { colorNewFromRGBA, Color } from "../Color.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import {
  GfxBuffer,
  GfxDevice,
  GfxFormat,
  GfxProgram,
  GfxSampler,
  GfxTexture,
  makeTextureDescriptor2D,
  GfxWrapMode,
  GfxTexFilterMode,
  GfxMipFilterMode,
} from "../gfx/platform/GfxPlatform.js";
import {
  GfxRenderInst,
  GfxRenderInstList,
  GfxRenderInstManager,
} from "../gfx/render/GfxRenderInstManager.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { TextureMapping } from "../TextureHolder.js";
import * as Viewer from "../viewer.js";
import {
  GfxrAttachmentClearDescriptor,
  GfxrAttachmentSlot,
  GfxrGraphBuilder,
  GfxrRenderTargetDescription,
  GfxrRenderTargetID,
  GfxrResolveTextureID,
} from "../gfx/render/GfxRenderGraph.js";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { CameraController, OrthoCameraController } from "../Camera.js";
import * as UI from "../ui.js";
import { mat4, vec3 } from "gl-matrix";
import { LocoRocoPanel } from "./render/LocoRocoPanel.js";

// Shaders
import { ObjectProgram } from "./render/program/ObjectProgram.js";
import { DebugOverlayProgram } from "./render/program/DebugOverlayProgram.js";
import { DebugOverlayLineProgram } from "./render/program/DebugOverlayLineProgram.js";
import { DebugOverlayCircleProgram } from "./render/program/DebugOverlayCircleProgram.js";
import { GlowProgram } from "./render/program/GlowProgram.js";
import { SelectionMaskProgram } from "./render/program/SelectionMaskProgram.js";
import { SelectionCompositeProgram } from "./render/program/SelectionCompositeProgram.js";
import {
  BlurDownProgram,
  BlurUpProgram,
  BlurBlitProgram,
} from "./render/program/BlurProgram.js";
import {
  SceneNode,
  SceneTree,
  GpuLineResources,
} from "./SceneTree.js";
import { buildSceneTree } from "./SceneBuilder.js";
import {
  CATEGORY_OBJECT_TYPES,
  CollectibleCategory,
  formatCollectibleStats,
} from "./render/CollectibleStats.js";
import { generateCollisionSegmentGroups } from "./render/CollisionVisualization.js";
import {
  buildLineQuadMeshFromSegments,
} from "./render/LineMeshBuilder.js";
import { update } from "./render/SceneUpdate.js";
import { RenderLists, collectRenderLists } from "./render/RenderListCollector.js";
import { performHitTest } from "./render/HitTesting.js";
import { ClickListener } from "./render/ClickListener.js";
import {
  AlphaBlendMegaState,
  OpaqueWriteAllMegaState,
  submitDebugOverlayMesh,
  submitGlowMarker,
  submitLineDraw,
  submitNormalMesh,
  submitSelectionMaskMesh,
} from "./render/MeshSubmitters.js";

/** Line data for collision visualization (world-space baked, not part of the scene tree). */
interface CollisionLineResources extends GpuLineResources {
  color: Color;
}

/** Scratch matrix reused across submit calls inside prepareToRender. */
const scratchClipFromLocal = mat4.create();
/** Black outline color for line draws. */
const BlackColor: Color = colorNewFromRGBA(0, 0, 0, 1);
/** Scratch TextureMappings reused inside pass exec callbacks. Each exec fully
 *  populates the fields before binding, so sharing across callbacks is safe. */
const scratchBlitMapping = new TextureMapping();
const scratchBlurMapping = new TextureMapping();
const scratchSelMainMapping = new TextureMapping();
const scratchSelYellowMapping = new TextureMapping();

/** Shared state for both selection composite orderings (before/after debug). */
interface SelectionCompositeState {
  readonly selCompositeID: GfxrRenderTargetID;
  readonly selInst: GfxRenderInst;
  readonly yellowResolveID: GfxrResolveTextureID;
}

interface AABB2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Compute the world-space 2D AABB of a node's entire subtree. Returns null if the subtree has no geometry. */
function computeNodeAABB(node: SceneNode): AABB2D | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scratch = vec3.create();

  const expandLocalPoint = (sn: SceneNode, lx: number, ly: number): void => {
    vec3.set(scratch, lx, ly, 0);
    vec3.transformMat4(scratch, scratch, sn.renderState.worldMatrix);
    if (scratch[0] < minX) minX = scratch[0];
    if (scratch[0] > maxX) maxX = scratch[0];
    if (scratch[1] < minY) minY = scratch[1];
    if (scratch[1] > maxY) maxY = scratch[1];
  };

  const collectSubtreeBounds = (sn: SceneNode): void => {
    for (const mi of sn.meshInstances) {
      const aabb = mi.gpuResources.localAABB;
      expandLocalPoint(sn, aabb.minX, aabb.minY);
      expandLocalPoint(sn, aabb.maxX, aabb.minY);
      expandLocalPoint(sn, aabb.minX, aabb.maxY);
      expandLocalPoint(sn, aabb.maxX, aabb.maxY);
    }
    for (const pl of sn.pathLines) {
      for (const strip of pl.strips) {
        for (const pt of strip) expandLocalPoint(sn, pt.x, pt.y);
      }
    }
    for (const child of sn.children) collectSubtreeBounds(child);
  };

  collectSubtreeBounds(node);
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function findLevelBgColor(levelName: string, systemArc: Garc): Color {
  // Load stage_conf.bin to get background color for this level
  let r = 230;
  let g = 242;
  let b = 250;
  try {
    const stageConfFile = systemArc.getFile("stage_conf.bin");
    const stpm = readStpm(stageConfFile.data);
    if (levelName.endsWith("_en")) {
      levelName = levelName.slice(0, -3);
    }
    const levelData = findLevelByName(stpm, levelName);
    if (levelData) {
      const col = stpmColorToRGBA(levelData.backgroundColor);
      r = col[0];
      g = col[1];
      b = col[2];
    }
  } catch (e) {
    console.warn(`LocoRocoRenderer: Could not load stage_conf.bin:`, e);
  }

  return colorNewFromRGBA(r, g, b, 1);
}

export class LocoRocoRenderer implements Viewer.SceneGfx {
  // Logic
  private readonly sceneTree: SceneTree;
  private readonly signalGraphRenderer: SignalGraphRenderer;
  private readonly panel: LocoRocoPanel;
  private readonly selectionInfo: SelectionInfoElement;
  private readonly clickListener = new ClickListener();
  private selectedNode: SceneNode | null = null;

  // LineMeshes to draw Collision
  private lineMeshes: CollisionLineResources[] = [];

  // Most recent camera controller passed to adjustCameraController. Used by zoomToNode.
  private cameraController: CameraController | null = null;

  // Gfx
  private readonly renderHelper: GfxRenderHelper;
  private readonly renderInstListMain = new GfxRenderInstList();
  private readonly renderInstListFocused = new GfxRenderInstList();
  // List for selected-object mask draws (rendered to its own RT).
  private readonly renderInstListSelectionYellow = new GfxRenderInstList();
  // List for debug overlay draws (rendered after the selection composite).
  private readonly renderInstListDebugOverlay = new GfxRenderInstList();
  private readonly blurDownProgram: GfxProgram;
  private readonly blurUpProgram: GfxProgram;
  private readonly blurSampler: GfxSampler;
  private readonly blurBlitProgram: GfxProgram;
  private readonly gfxProgram: GfxProgram;
  private readonly debugOverlayProgram: GfxProgram;
  private readonly debugOverlayCircleProgram: GfxProgram;
  private readonly debugOverlayLineProgram: GfxProgram;
  private readonly glowProgram: GfxProgram;
  private readonly selectionMaskProgram: GfxProgram;
  private readonly selectionCompositeProgram: GfxProgram;
  private readonly clearRenderPassDescriptor: GfxrAttachmentClearDescriptor;
  private readonly clearGreyRenderPassDescriptor: GfxrAttachmentClearDescriptor;
  private readonly whiteFallbackTexture: GfxTexture;

  constructor(
    private readonly device: GfxDevice,
    system_arc: ArrayBufferSlice,
    level: ArrayBufferSlice,
    levelName: string = "",
  ) {
    this.renderHelper = new GfxRenderHelper(device);
    this.panel = new LocoRocoPanel(this);

    const systemArc = readGarc(system_arc);
    const levelBackground = findLevelBgColor(levelName, systemArc);
    this.clearRenderPassDescriptor = makeAttachmentClearDescriptor(levelBackground);
    const gray = 0.299 * levelBackground.r + 0.587 * levelBackground.g + 0.114 * levelBackground.b;
    this.clearGreyRenderPassDescriptor = makeAttachmentClearDescriptor(colorNewFromRGBA(gray, gray, gray, 1))

    const blvFile = readBlvBuffer(GameVersion.Gold, level.copyToBuffer());
    this.signalGraphRenderer = new SignalGraphRenderer(
      extractSignalGraph(blvFile),
      {
        onNodeSelected: (owner) => {
          if (owner === null) {
            this.onNodeSelected(null);
            return;
          }
          const search = (sn: SceneNode): SceneNode | null => {
            if (sn.owner === owner) return sn;
            for (const child of sn.children) {
              const f = search(child);
              if (f) return f;
            }
            return null;
          };
          this.onNodeSelected(search(this.sceneTree.root));
        },
      },
    );

    // Create shader programs
    const cache = this.renderHelper.renderCache;
    this.gfxProgram = cache.createProgram(new ObjectProgram());
    this.debugOverlayProgram = cache.createProgram(new DebugOverlayProgram());
    this.debugOverlayCircleProgram = cache.createProgram(new DebugOverlayCircleProgram());
    this.debugOverlayLineProgram = cache.createProgram(new DebugOverlayLineProgram());
    this.glowProgram = cache.createProgram(new GlowProgram());
    this.selectionMaskProgram = cache.createProgram(new SelectionMaskProgram());
    this.selectionCompositeProgram = cache.createProgram(new SelectionCompositeProgram());

    // Create blur programs for focus collectibles mode
    this.blurDownProgram = cache.createProgram(new BlurDownProgram());
    this.blurUpProgram = cache.createProgram(new BlurUpProgram());
    this.blurBlitProgram = cache.createProgram(new BlurBlitProgram());
    this.blurSampler = cache.createSampler({
      wrapS: GfxWrapMode.Clamp,
      wrapT: GfxWrapMode.Clamp,
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Nearest,
    });

    // Create white fallback texture (1x1 white pixel)
    this.whiteFallbackTexture = device.createTexture(
      makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1),
    );
    device.uploadTextureData(this.whiteFallbackTexture, 0, [
      new Uint8Array([255, 255, 255, 255]),
    ]);

    // Build the scene tree (all textures, including animation frame textures, are pre-uploaded)
    this.sceneTree = buildSceneTree(
      device,
      cache,
      this.whiteFallbackTexture,
      systemArc,
      blvFile,
    );

    this.selectionInfo = new SelectionInfoElement(this.sceneTree, {
      hasSignals: (locoObj) => this.signalGraphRenderer.hasNodeFor(locoObj),
      onNodeSelected: (node) => this.onNodeSelected(node),
      onShowSignals: (locoObj) => this.signalGraphRenderer.open(locoObj),
      onZoomTo: (target) => this.zoomToNode(target),
    });

    // Setup collision polygon
    this.regenerateCollisionLines();
  }
  
  private onNodeSelected(node: SceneNode | null): void {
    this.selectedNode = node;
    this.selectionInfo.setNode(this.selectedNode);
  }

  /** Close the signal graph overlay (if open) and lerp the camera to frame the given node's subtree. */
  private zoomToNode(target: SceneNode): void {
    this.signalGraphRenderer.close();
    const ctrl = this.cameraController;
    if (!(ctrl instanceof OrthoCameraController)) return;
    const aabb = computeNodeAABB(target);
    if (aabb === null) return;

    const cx = (aabb.minX + aabb.maxX) / 2;
    const cy = (aabb.minY + aabb.maxY) / 2;
    const w = Math.max(aabb.maxX - aabb.minX, 1);
    const h = Math.max(aabb.maxY - aabb.minY, 1);
    const z = -Math.max(w, h * ctrl.camera.aspect) / 10;

    // Only set the *Target fields so the controller lerps from its current state.
    ctrl.xTarget = -Math.PI / 2;
    ctrl.yTarget = Math.PI / 2;
    ctrl.zTarget = z;
    vec3.set(ctrl.translationTarget, cx, cy, 100);
    ctrl.forceUpdate = true;
  }

  /** Open the signal graph overlay. Called by the panel. */
  public openSignalGraph(): void {
    this.signalGraphRenderer.open();
  }

  /** Reset all animations to t=0 and refresh the selection info element. Called by the panel. */
  public restartAnimations(): void {
    const reset = (node: SceneNode) => {
      for (const anim of node.animations) {
        anim.currentTime = 0;
        anim.trackTimes.clear();
      }
      for (const child of node.children) reset(child);
    };
    reset(this.sceneTree.root);
  }

  /** Format collectible stats for the current scene, for display in the panel. */
  public formatCollectibleStats(category: CollectibleCategory): string {
    return formatCollectibleStats(this.sceneTree.root, category);
  }

  public regenerateCollisionLines(): void {
    if (!this.sceneTree.collisionPolygon) return;

    // Clear existing collision line meshes
    for (const lineMesh of this.lineMeshes) {
      this.device.destroyBuffer(lineMesh.vertexBuffer);
      this.device.destroyBuffer(lineMesh.indexBuffer);
    }
    this.lineMeshes = [];

    const groups = generateCollisionSegmentGroups(
      this.sceneTree.collisionPolygon,
      this.panel.collisionVisualizationMode,
    );
    for (const group of groups) {
      const gpuRes = buildLineQuadMeshFromSegments(
        this.renderHelper.renderCache,
        group.segments,
      );
      if (gpuRes) this.lineMeshes.push({ ...gpuRes, color: group.color });
    }
  }

  public createCameraController(): CameraController {
    const controller = new OrthoCameraController();
    LocoRocoRenderer.configureOrthoController(controller);
    controller.z = controller.zTarget = -200;
    return controller;
  }

  public adjustCameraController(c: CameraController): void {
    this.cameraController = c;
    if (c instanceof OrthoCameraController) {
      LocoRocoRenderer.configureOrthoController(c);
    }
  }

  /** Configure an OrthoCameraController to look down the Z axis with LocoRoco defaults. */
  public static configureOrthoController(c: OrthoCameraController): void {
    c.x = c.xTarget = -Math.PI / 2;
    c.y = c.yTarget = Math.PI / 2;
    c.exponentialZoomFactor = 1.05;
    c.realignmentSettings = {
      xTarget: c.x, yTarget: c.y
    };
  }

  public createPanels(): UI.Panel[] {
    return this.panel.build();
  }

  private prepareToRender(
    viewerInput: Viewer.ViewerRenderInput,
    scene: RenderLists
  ): void {
    const renderInstManager = this.renderHelper.renderInstManager;

    // Reset lists.
    this.renderInstListMain.reset();
    this.renderInstListFocused.reset();
    this.renderInstListSelectionYellow.reset();
    this.renderInstListDebugOverlay.reset();
    this.renderHelper.pushTemplateRenderInst();

    // Calculate pixels per world unit for debug shader
    // clipFromWorldMatrix[0] gives us the scale factor from world to clip space
    // Multiply by half the screen width to get pixels per world unit
    const screenWidth = viewerInput.backbufferWidth;
    const clipScaleX = viewerInput.camera.clipFromWorldMatrix[0];
    const pixelsPerWorldUnit = (screenWidth / 2) * clipScaleX;

    // Pass 1: Render normal meshes
    const normalGrayscale = this.panel.focusCollectibles ? 1.0 : 0.0;
    renderInstManager.setCurrentList(this.renderInstListMain);
    for (const mesh of scene.normalMeshes) {
      submitNormalMesh(renderInstManager, this.gfxProgram, viewerInput, mesh, normalGrayscale);
    }

    // When focus is active, switch to focused list for focused meshes + glow markers.
    if (this.panel.focusCollectibles) {
      renderInstManager.setCurrentList(this.renderInstListFocused);

      // Glow color follows the selected collectible category.
      const glowColor: readonly [number, number, number, number] =
        this.panel.focusedCollectibleCategory === CollectibleCategory.Picories ||
        this.panel.focusedCollectibleCategory === CollectibleCategory.Fruit
          ? [1.0, 0.2, 0.1, 0.6] // red
          : [0.1, 0.3, 1.0, 0.6]; // blue

      for (const mesh of scene.focusedMeshes) {
        submitGlowMarker(
          renderInstManager,
          this.glowProgram,
          viewerInput,
          mesh.node.renderState.worldMatrix,
          20.0,
          glowColor,
        );
      }
      for (const mesh of scene.focusedMeshes) {
        submitNormalMesh(renderInstManager, this.gfxProgram, viewerInput, mesh, 0.0);
      }
    }

    // Pass 2: Render collision lines (if visible). In focus mode the current list is
    // renderInstListFocused so lines appear above the blur; otherwise they go into
    // renderInstListMain alongside the rest of the scene.
    if (this.panel.showCollision) {
      for (const lineMesh of this.lineMeshes) {
        submitLineDraw(
          renderInstManager, this.debugOverlayLineProgram, lineMesh,
          viewerInput.camera.clipFromWorldMatrix,
          BlackColor, 10.0, viewerInput, null, false,
        );
      }
      for (const lineMesh of this.lineMeshes) {
        submitLineDraw(
          renderInstManager, this.debugOverlayLineProgram, lineMesh,
          viewerInput.camera.clipFromWorldMatrix,
          lineMesh.color, 6.0, viewerInput, null, false,
        );
      }
    }

    // Pass 3: Render debug overlays (if visible) - drawn after the selection composite.
    if (this.panel.showDebugOverlays) {
      renderInstManager.setCurrentList(this.renderInstListDebugOverlay);
      for (const mesh of scene.debugMeshes) {
        submitDebugOverlayMesh(
          renderInstManager,
          this.debugOverlayCircleProgram,
          this.debugOverlayProgram,
          viewerInput,
          mesh,
          pixelsPerWorldUnit,
          false,
        );
      }

      // Render path lines and cross markers: black outlines first, then colored lines on top.
      for (const pl of scene.pathLines) {
        mat4.multiply(scratchClipFromLocal, viewerInput.camera.clipFromWorldMatrix, pl.renderState.worldMatrix);
        submitLineDraw(
          renderInstManager, this.debugOverlayLineProgram, pl.gpuResources,
          scratchClipFromLocal, BlackColor, 10.0, viewerInput, null, false,
        );

        mat4.multiply(scratchClipFromLocal, viewerInput.camera.clipFromWorldMatrix, pl.renderState.worldMatrix);
        submitLineDraw(
          renderInstManager, this.debugOverlayLineProgram, pl.gpuResources,
          scratchClipFromLocal, pl.color, 6.0, viewerInput, AlphaBlendMegaState, false,
        );
      }
    }

    // Emit selection-mask draws for the selected node's meshes (normal or debug overlay).
    // These go into renderInstListSelectionYellow and are consumed by the
    // screen-space selection composite pass in render().
    if (this.selectedNode !== null) {
      renderInstManager.setCurrentList(this.renderInstListSelectionYellow);

      for (const mesh of scene.normalMeshes) {
        if (mesh.node !== this.selectedNode) continue;
        submitSelectionMaskMesh(renderInstManager, this.selectionMaskProgram, viewerInput, mesh);
      }

      // Debug overlay meshes: reuse their draw shaders in mask mode so the silhouette
      // matches the actual shape (circle clip, procedural fill, arrow indicator, etc.).
      for (const mesh of scene.debugMeshes) {
        if (mesh.node !== this.selectedNode) continue;
        submitDebugOverlayMesh(
          renderInstManager,
          this.debugOverlayCircleProgram,
          this.debugOverlayProgram,
          viewerInput,
          mesh,
          pixelsPerWorldUnit,
          true,
        );
      }

      for (const pl of scene.pathLines) {
        if (pl.node !== this.selectedNode) continue;
        mat4.multiply(scratchClipFromLocal, viewerInput.camera.clipFromWorldMatrix, pl.renderState.worldMatrix);
        submitLineDraw(
          renderInstManager, this.debugOverlayLineProgram, pl.gpuResources,
          scratchClipFromLocal, BlackColor, 10.0, viewerInput, OpaqueWriteAllMegaState, true,
        );
      }
    }

    renderInstManager.popTemplate();

    this.renderHelper.prepareToRender();
  }

  public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
    // Run animation tick
    update(this.sceneTree.root, viewerInput.deltaTime / 1000, this.sceneTree.textures);

    // Collect everything that we're actually going to render.
    const scene = collectRenderLists(this.sceneTree.root, {
      showWorld: this.panel.showWorld,
      showObjects: this.panel.showObjects,
      showDebugOverlays: this.panel.showDebugOverlays,
      hiddenObjectTypes: this.panel.getHiddenObjectTypes(),
      focusedTypes: this.panel.focusCollectibles ? CATEGORY_OBJECT_TYPES[this.panel.focusedCollectibleCategory] : null,
      cameraZ: viewerInput.camera.worldMatrix[14],
    });

    // Handle any pending click now that we've decided what's actually visible.
    const click = this.clickListener.takePendingClick();
    if (click !== null) {
      this.onNodeSelected(performHitTest(
        click.x,
        click.y,
        viewerInput,
        scene,
        this.selectedNode,
      ));
    }

    // Update the selection info.
    this.selectionInfo.update();
    
    // Generate render lists.
    this.prepareToRender(viewerInput, scene);

    // In focus collectibles mode, desaturate the background clear color to grayscale
    const desc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.Color0,
      viewerInput,
      this.panel.focusCollectibles ? this.clearGreyRenderPassDescriptor : this.clearRenderPassDescriptor,
    );

    const builder = this.renderHelper.renderGraph.newGraphBuilder();
    const w = viewerInput.backbufferWidth;
    const h = viewerInput.backbufferHeight;
    const renderInstManager = this.renderHelper.renderInstManager;

    // finalID is the last RT produced by the scene rendering pipeline.
    // It may then be fed into the selection composite pass as "main scene".
    let finalID: GfxrRenderTargetID;

    if (this.panel.focusCollectibles) {
      // Multi-pass: draw unfocused meshes (grayscale), blur them to produce a
      // bokeh-like background, then composite focused meshes sharply on top.
      const unfocusedID = builder.createRenderTargetID(desc, "Unfocused");
      this.pushListPass(builder, "Unfocused", unfocusedID, this.renderInstListMain);

      const blurOutputID = this.pushBlurChain(builder, renderInstManager, desc, unfocusedID, w, h);

      finalID = this.pushFocusCompositePass(builder, renderInstManager, blurOutputID, w, h);
    } else {
      // Standard single-pass rendering (no focus active)
      const mainColorID = builder.createRenderTargetID(desc, "Main Color");
      this.pushListPass(builder, "Main", mainColorID, this.renderInstListMain);
      finalID = mainColorID;
    }

    // Selection composite: screen-space pulsing outline + yellow interior glow.
    // - Normal object selected  → composite runs BEFORE debug overlays (highlight below them).
    // - Debug overlay selected  → composite runs AFTER  debug overlays (highlight above them).
    const selectedNodeIsOverlay =
      this.selectedNode !== null &&
      (this.selectedNode.pathLines.length > 0 ||
        this.selectedNode.meshInstances.some((x) => x.isDebug));

    let selState: SelectionCompositeState | null = null;
    if (this.selectedNode !== null) {
      selState = this.buildSelectionCompositeState(builder, renderInstManager, viewerInput, w, h);
      if (!selectedNodeIsOverlay) {
        finalID = this.pushSelectionCompositePass(builder, selState, finalID);
      }
    }

    // Debug overlay pass: drawn after scene (and after normal-object selection composite).
    if (this.panel.showDebugOverlays) {
      this.pushListPass(builder, "Debug Overlays", finalID, this.renderInstListDebugOverlay);
    }

    // Overlay selection: composite after debug overlays (highlight sits above them).
    if (selState !== null && selectedNodeIsOverlay) {
      finalID = this.pushSelectionCompositePass(builder, selState, finalID);
    }

    builder.resolveRenderTargetToExternalTexture(
      finalID,
      viewerInput.onscreenTexture,
    );

    builder.execute();
  }

  /** Push a pass that just draws the given render-inst list into `targetID`. */
  private pushListPass(
    builder: GfxrGraphBuilder,
    debugName: string,
    targetID: GfxrRenderTargetID,
    list: GfxRenderInstList,
  ): void {
    builder.pushPass((pass) => {
      pass.setDebugName(debugName);
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, targetID);
      pass.exec((passRenderer) => {
        list.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
      });
    });
  }

  /** Push a single blur downsample/upsample pass into the render graph. */
  private pushBlurPass(
    builder: GfxrGraphBuilder,
    renderInstManager: GfxRenderInstManager,
    name: string,
    program: GfxProgram,
    inputDesc: GfxrRenderTargetDescription,
    inputID: GfxrRenderTargetID,
    outputID: GfxrRenderTargetID,
  ): void {
    const renderInst = renderInstManager.newRenderInst();
    renderInst.setUniformBuffer(this.renderHelper.uniformBuffer);
    renderInst.setAllowSkippingIfPipelineNotReady(false);
    renderInst.setMegaStateFlags(fullscreenMegaState);
    renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
    renderInst.setGfxProgram(program);
    renderInst.setDrawCount(3);

    let offs = renderInst.allocateUniformBuffer(0, 4);
    const d = renderInst.mapUniformBufferF32(0);
    offs += fillVec4(d, offs, 0.5 / inputDesc.width, 0.5 / inputDesc.height);

    builder.pushPass((pass) => {
      pass.setDebugName(name);
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, outputID);

      const resolveID = builder.resolveRenderTarget(inputID);
      pass.attachResolveTexture(resolveID);

      pass.exec((passRenderer, scope) => {
        scratchBlurMapping.gfxTexture = scope.getResolveTextureForID(resolveID);
        scratchBlurMapping.gfxSampler = this.blurSampler;
        renderInst.setSamplerBindingsFromTextureMappings([scratchBlurMapping]);
        renderInst.drawOnPass(this.renderHelper.renderCache, passRenderer);
      });
    });
  }

  /**
   * Downsample `inputID` three times (1/2 → 1/4 → 1/8) then upsample back to
   * full resolution using the dual-filter blur programs. Returns the ID of the
   * full-resolution blurred output.
   */
  private pushBlurChain(
    builder: GfxrGraphBuilder,
    renderInstManager: GfxRenderInstManager,
    inputDesc: GfxrRenderTargetDescription,
    inputID: GfxrRenderTargetID,
    w: number,
    h: number,
  ): GfxrRenderTargetID {
    const desc2 = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    desc2.setDimensions(w >>> 1, h >>> 1, 1);
    const desc4 = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    desc4.setDimensions(desc2.width >>> 1, desc2.height >>> 1, 1);
    const desc8 = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    desc8.setDimensions(desc4.width >>> 1, desc4.height >>> 1, 1);

    const blur2ID = builder.createRenderTargetID(desc2, "Blur 1/2");
    const blur4ID = builder.createRenderTargetID(desc4, "Blur 1/4");
    const blur8ID = builder.createRenderTargetID(desc8, "Blur 1/8");

    const fullDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    fullDesc.setDimensions(w, h, 1);
    const blurOutputID = builder.createRenderTargetID(fullDesc, "Blur Output");

    this.pushBlurPass(builder, renderInstManager, "Blur Down 1/2", this.blurDownProgram, inputDesc, inputID, blur2ID);
    this.pushBlurPass(builder, renderInstManager, "Blur Down 1/4", this.blurDownProgram, desc2, blur2ID, blur4ID);
    this.pushBlurPass(builder, renderInstManager, "Blur Down 1/8", this.blurDownProgram, desc4, blur4ID, blur8ID);
    this.pushBlurPass(builder, renderInstManager, "Blur Up 1/4",   this.blurUpProgram,   desc8, blur8ID, blur4ID);
    this.pushBlurPass(builder, renderInstManager, "Blur Up 1/2",   this.blurUpProgram,   desc4, blur4ID, blur2ID);
    this.pushBlurPass(builder, renderInstManager, "Blur Up Full",  this.blurUpProgram,   desc2, blur2ID, blurOutputID);

    return blurOutputID;
  }

  /**
   * Push the focus-mode composite pass: blit the blurred background, then draw
   * focused meshes + overlays sharply on top. Returns the output RT ID.
   */
  private pushFocusCompositePass(
    builder: GfxrGraphBuilder,
    renderInstManager: GfxRenderInstManager,
    blurOutputID: GfxrRenderTargetID,
    w: number,
    h: number,
  ): GfxrRenderTargetID {
    const compositeDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    compositeDesc.setDimensions(w, h, 1);
    const compositeID = builder.createRenderTargetID(compositeDesc, "Composite");

    const blitInst = renderInstManager.newRenderInst();
    blitInst.setUniformBuffer(this.renderHelper.uniformBuffer);
    blitInst.setAllowSkippingIfPipelineNotReady(false);
    blitInst.setMegaStateFlags(fullscreenMegaState);
    blitInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
    blitInst.setDrawCount(3);
    blitInst.setGfxProgram(this.blurBlitProgram);

    const blurResolveID = builder.resolveRenderTarget(blurOutputID);

    builder.pushPass((pass) => {
      pass.setDebugName("Composite");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, compositeID);
      pass.attachResolveTexture(blurResolveID);
      pass.exec((passRenderer, scope) => {
        scratchBlitMapping.gfxTexture = scope.getResolveTextureForID(blurResolveID);
        scratchBlitMapping.gfxSampler = this.blurSampler;
        blitInst.setSamplerBindingsFromTextureMappings([scratchBlitMapping]);
        blitInst.drawOnPass(this.renderHelper.renderCache, passRenderer);

        this.renderInstListFocused.drawOnPassRenderer(
          this.renderHelper.renderCache,
          passRenderer,
        );
      });
    });

    return compositeID;
  }

  /**
   * Render the selected node's mask into a yellow buffer and prepare the
   * composite render inst. Returns the shared state used by subsequent
   * pushSelectionCompositePass() calls.
   */
  private buildSelectionCompositeState(
    builder: GfxrGraphBuilder,
    renderInstManager: GfxRenderInstManager,
    viewerInput: Viewer.ViewerRenderInput,
    w: number,
    h: number,
  ): SelectionCompositeState {
    // Yellow buffer pass: render selected object as a white mask.
    // Cleared to transparent; no depth buffer → full silhouette, even if occluded.
    const yellowDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    yellowDesc.setDimensions(w, h, 1);
    yellowDesc.clearColor = colorNewFromRGBA(0, 0, 0, 0);
    const selectionYellowID = builder.createRenderTargetID(yellowDesc, "Selection Yellow");
    this.pushListPass(builder, "Selection Yellow", selectionYellowID, this.renderInstListSelectionYellow);

    const selCompositeDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    selCompositeDesc.setDimensions(w, h, 1);
    const selCompositeID = builder.createRenderTargetID(selCompositeDesc, "Selection Composite");

    const selInst = renderInstManager.newRenderInst();
    selInst.setUniformBuffer(this.renderHelper.uniformBuffer);
    selInst.setAllowSkippingIfPipelineNotReady(false);
    selInst.setMegaStateFlags(fullscreenMegaState);
    selInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 2 }]);
    selInst.setDrawCount(3);
    selInst.setGfxProgram(this.selectionCompositeProgram);

    const sOffs = selInst.allocateUniformBuffer(0, 4);
    const sd = selInst.mapUniformBufferF32(0);
    fillVec4(sd, sOffs, viewerInput.time / 1000.0, 1.0 / w, 1.0 / h);

    return {
      selCompositeID,
      selInst,
      yellowResolveID: builder.resolveRenderTarget(selectionYellowID),
    };
  }

  /**
   * Push a single selection composite pass: reads `inputID` + the yellow mask,
   * writes into the shared selection composite RT. Returns the output RT ID.
   */
  private pushSelectionCompositePass(
    builder: GfxrGraphBuilder,
    state: SelectionCompositeState,
    inputID: GfxrRenderTargetID,
  ): GfxrRenderTargetID {
    const { selCompositeID, selInst, yellowResolveID } = state;
    const preSelResolveID = builder.resolveRenderTarget(inputID);
    builder.pushPass((pass) => {
      pass.setDebugName("Selection Composite");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, selCompositeID);
      pass.attachResolveTexture(preSelResolveID);
      pass.attachResolveTexture(yellowResolveID);
      pass.exec((passRenderer, scope) => {
        scratchSelMainMapping.gfxTexture = scope.getResolveTextureForID(preSelResolveID);
        scratchSelMainMapping.gfxSampler = this.blurSampler;
        scratchSelYellowMapping.gfxTexture = scope.getResolveTextureForID(yellowResolveID);
        scratchSelYellowMapping.gfxSampler = this.blurSampler;
        selInst.setSamplerBindingsFromTextureMappings([scratchSelMainMapping, scratchSelYellowMapping]);
        selInst.drawOnPass(this.renderHelper.renderCache, passRenderer);
      });
    });
    return selCompositeID;
  }

  public destroy(device: GfxDevice): void {
    this.renderHelper.destroy();

    // Destroy scene tree GPU resources
    const destroyedBuffers = new Set<GfxBuffer>();
    const destroyNodeResources = (node: SceneNode) => {
      for (const meshInst of node.meshInstances) {
        const res = meshInst.gpuResources;
        if (!destroyedBuffers.has(res.vertexBuffer)) {
          device.destroyBuffer(res.vertexBuffer);
          destroyedBuffers.add(res.vertexBuffer);
        }
        if (!destroyedBuffers.has(res.indexBuffer)) {
          device.destroyBuffer(res.indexBuffer);
          destroyedBuffers.add(res.indexBuffer);
        }
      }
      for (const pl of node.pathLines) {
        if (pl.gpuResources) {
          device.destroyBuffer(pl.gpuResources.vertexBuffer);
          device.destroyBuffer(pl.gpuResources.indexBuffer);
        }
      }
      for (const child of node.children) {
        destroyNodeResources(child);
      }
    };
    destroyNodeResources(this.sceneTree.root);

    // Destroy collision line mesh resources
    for (const lineMesh of this.lineMeshes) {
      device.destroyBuffer(lineMesh.vertexBuffer);
      device.destroyBuffer(lineMesh.indexBuffer);
    }
    for (const texture of Array.from(this.sceneTree.textures.values())) {
      device.destroyTexture(texture);
    }
    device.destroyTexture(this.whiteFallbackTexture);

    this.selectionInfo.destroy();
  }
}
