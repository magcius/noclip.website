import { mat4, type ReadonlyMat4, vec3 } from "gl-matrix";
import type { CameraController } from "../Camera";
import { AABB } from "../Geometry";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import {
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import {
  fillMatrix4x3,
  fillMatrix4x4,
  fillVec4v,
} from "../gfx/helpers/UniformBufferHelpers";
import {
  GfxBlendFactor,
  GfxBlendMode,
  GfxCompareMode,
  GfxCullMode,
  type GfxDevice,
  GfxFormat,
  GfxFrontFaceMode,
  type GfxProgram,
  type GfxSampler,
  type GfxTexture,
  makeTextureDescriptor2D,
} from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import {
  type GfxRenderInst,
  GfxRenderInstList,
  gfxRenderInstCompareNone,
} from "../gfx/render/GfxRenderInstManager";
import { HashMap, nullHashFunc } from "../HashMap";
import { CalcBillboardFlags, calcBillboardMatrix } from "../MathHelpers";
import { TextureMapping } from "../TextureHolder";
import * as UI from "../ui";
import type * as Viewer from "../viewer";
import { getVolume, setVolume, startPlayback, stopPlayback } from "./Audio";
import { addFrameTime, getFrameTime, resetFrameTime } from "./Common";
import { BinCollector } from "./CullBin";
import {
  type CachedGeometryData,
  composeDrawMask,
  createGeomData,
  extractMaterial,
  isNodeVisible,
  type MaterialData,
} from "./Geom";
import { intervalManager } from "./interval";
import type { ToontownLoader } from "./Loader";
import {
  BoundsType,
  Character,
  ColorWriteAttrib,
  ColorWriteChannels,
  CompassEffect,
  CompressionMode,
  CullFaceMode,
  DecalEffect,
  DepthWriteAttrib,
  DepthWriteMode,
  type Geom,
  type GeomEntry,
  GeomNode,
  MAX_PRIORITY,
  PandaCompareFunc,
  type PandaNode,
  type RenderState,
  type Texture,
  TextureAttrib,
  TransparencyMode,
  type VertexTransform,
} from "./nodes";
import { HierarchicalProfiler } from "./Profiler";
import {
  createProgramProps,
  MAX_BONES,
  programPropsEqual,
  ToontownProgram,
  type ToontownProgramProps,
} from "./Program";
import { SceneGraphViewer } from "./SceneGraphViewer";
import { expandToRGBA, getSamplerDescriptor } from "./Textures";

// Whether to open the scene graph viewer by default
// (Useful for debugging)
const DEFAULT_SCENE_GRAPH_OPEN = false;

// Scratch AABB for frustum culling
const scratchAABB = new AABB();
// Scratch vec3 for sphere center transform
const scratchSphereCenter = vec3.create();

// Panda3D: +X right, +Y forward, +Z up
// noclip:  +X right, +Y up, -Z forward
export const pandaToNoclip = mat4.fromValues(
  1,
  0,
  0,
  0,
  0,
  0,
  -1,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
);

let musicEnabled = false;

export class ToontownRenderer implements Viewer.SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstListMain = new GfxRenderInstList(gfxRenderInstCompareNone);
  private geomCache: Map<Geom, CachedGeometryData> = new Map();
  private programCache: HashMap<ToontownProgramProps, GfxProgram> = new HashMap(
    programPropsEqual,
    nullHashFunc,
  );
  private textureCache: Map<
    string,
    { texture: GfxTexture; sampler: GfxSampler }
  > = new Map();
  private profiler = new HierarchicalProfiler({
    enabled: false,
    historySize: 60,
    printIntervalMs: 3000,
  });
  private debugPanel: UI.Panel | null = null;
  private debugSceneGraphCheckbox: UI.Checkbox | null = null;
  private sceneGraphViewer: SceneGraphViewer | null = null;

  private constructor(
    private device: GfxDevice,
    private scene: PandaNode,
    private loader: ToontownLoader,
    private musicFile: string | undefined,
  ) {
    this.renderHelper = new GfxRenderHelper(device);
    if (DEFAULT_SCENE_GRAPH_OPEN) {
      this.toggleSceneGraphViewer();
    }
    if (this.musicFile && musicEnabled) {
      startPlayback(this.loader, this.musicFile);
    }
  }

  public adjustCameraController(c: CameraController) {
    c.setSceneMoveSpeedMult(0.02);
  }

  createPanels(): UI.Panel[] {
    this.debugPanel = new UI.Panel();
    this.debugPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
    this.debugPanel.setTitle(UI.RENDER_HACKS_ICON, "Debug");

    this.debugSceneGraphCheckbox = new UI.Checkbox(
      "Show Scene Graph",
      this.sceneGraphViewer !== null,
    );
    this.debugSceneGraphCheckbox.onchanged = () => {
      this.toggleSceneGraphViewer();
    };
    this.debugPanel.contents.appendChild(this.debugSceneGraphCheckbox.elem);

    if (this.musicFile) {
      const playButton = new UI.Checkbox("Play Music", musicEnabled);
      playButton.onchanged = async () => {
        if (playButton.checked && this.musicFile) {
          musicEnabled = true;
          startPlayback(this.loader, this.musicFile);
        } else {
          stopPlayback();
        }
      };
      this.debugPanel.contents.appendChild(playButton.elem);

      const volumeSlider = new UI.Slider();
      volumeSlider.setLabel("Volume");
      volumeSlider.setRange(0, 1);
      volumeSlider.setValue(getVolume());
      volumeSlider.onvalue = async (value) => {
        setVolume(value);
      };
      this.debugPanel.contents.appendChild(volumeSlider.elem);
    }

    return [this.debugPanel];
  }

  /**
   * Toggle the scene graph viewer panel
   */
  public toggleSceneGraphViewer(): void {
    if (this.sceneGraphViewer === null) {
      this.sceneGraphViewer = new SceneGraphViewer();
      this.sceneGraphViewer.setScene(this.scene);
      this.sceneGraphViewer.show();
      this.sceneGraphViewer.onclose = () => {
        this.sceneGraphViewer = null;
        this.debugSceneGraphCheckbox?.setChecked(false);
      };
    } else {
      this.sceneGraphViewer.close();
      this.sceneGraphViewer = null;
    }
    if (this.debugSceneGraphCheckbox) {
      this.debugSceneGraphCheckbox.setChecked(this.sceneGraphViewer !== null);
    }
  }

  /**
   * Get the scene graph viewer (creates one if it doesn't exist)
   */
  public getSceneGraphViewer(): SceneGraphViewer {
    if (this.sceneGraphViewer === null) {
      this.sceneGraphViewer = new SceneGraphViewer();
      this.sceneGraphViewer.setScene(this.scene);
    }
    return this.sceneGraphViewer;
  }

  /**
   * Create a renderer from a scene
   */
  public static async create(
    device: GfxDevice,
    scene: PandaNode,
    loader: ToontownLoader,
    musicFile: string | undefined,
  ): Promise<ToontownRenderer> {
    const renderer = new ToontownRenderer(device, scene, loader, musicFile);
    // Load all textures used in the scene
    await renderer.ensureTexturesLoaded(loader);
    return renderer;
  }

  private async ensureTexturesLoaded(loader: ToontownLoader): Promise<void> {
    const allTextures = new Map<string, Texture>();
    function addTexture(node: PandaNode, texture: Texture) {
      // Resolve relative texture paths
      if (texture.filename.includes("..")) {
        let currNode: PandaNode | null = node;
        while (currNode) {
          const modelPath = currNode.tags.get("DNAModel");
          if (modelPath) {
            const baseUrl = new URL(modelPath, window.location.origin);
            const resolved = new URL(texture.filename, baseUrl).pathname;
            texture.filename = resolved.substring(1);
            break;
          }
          currNode = currNode.parent;
        }
      }
      if (texture.alphaFilename.includes("..")) {
        let currNode: PandaNode | null = node;
        while (currNode) {
          const modelPath = currNode.tags.get("DNAModel");
          if (modelPath) {
            const baseUrl = new URL(modelPath, window.location.origin);
            const resolved = new URL(texture.alphaFilename, baseUrl).pathname;
            texture.alphaFilename = resolved.substring(1);
            break;
          }
          currNode = currNode.parent;
        }
      }
      allTextures.set(texture.name, texture);
    }
    this.scene.traverse((node) => {
      if (!(node instanceof GeomNode)) return;
      for (const { state } of node.geoms) {
        const renderState = node.state.compose(state);
        const entry = renderState.attribs.find(
          ({ attrib }) => attrib.constructor === TextureAttrib,
        );
        if (!entry) continue;
        const attrib = entry.attrib as TextureAttrib;
        for (const stage of attrib.onStages) {
          addTexture(node, stage.texture);
        }
        if (attrib.texture) {
          addTexture(node, attrib.texture);
        }
      }
    });

    await Promise.all(
      Array.from(allTextures.values(), (texture) =>
        this.buildTexture(texture, loader),
      ),
    );
    console.debug(
      `Built texture cache with ${this.textureCache.size} textures`,
    );
  }

  private async buildTexture(texture: Texture, loader: ToontownLoader) {
    if (this.textureCache.has(texture.name)) return;

    // Try to load embedded raw data first
    if (texture.rawData && texture.rawData.ramImages.length > 0) {
      if (texture.rawData.ramImageCompression !== CompressionMode.Off) {
        throw new Error(
          `Failed to load texture ${texture.name}: compressed format not supported`,
        );
      }

      const rawData = texture.rawData;
      const [width, height] = rawData.size;
      const imageData = rawData.ramImages[0].data;
      const format = texture.pbufferFormat ?? texture.format;

      // Expand to RGBA
      const rgbaData = expandToRGBA(
        imageData,
        width,
        height,
        texture.numComponents,
        format,
      );

      // Create GPU texture
      const gfxTexture = this.device.createTexture(
        makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1),
      );
      this.device.uploadTextureData(gfxTexture, 0, [rgbaData]);
      this.device.setResourceName(gfxTexture, texture.name);

      const gfxSampler = this.renderHelper.renderCache.createSampler(
        getSamplerDescriptor(texture),
      );
      this.textureCache.set(texture.name, {
        texture: gfxTexture,
        sampler: gfxSampler,
      });
    } else if (texture.filename) {
      await this.loadExternalTexture(texture, loader);
    } else {
      throw new Error(
        `Failed to load texture ${texture.name}: no raw data or filename`,
      );
    }
  }

  private async loadExternalTexture(
    texture: Texture,
    loader: ToontownLoader,
  ): Promise<void> {
    let filename = texture.filename;

    // FIXME: TTR font texture fixups
    if (
      filename === "phase_4/models/maps/ttr_t_gui_gen_mickeyFontClassic1.rgb"
    ) {
      filename = "phase_3/fonts/ttr_t_gui_gen_mickeyFontClassic1.rgb";
    } else if (
      filename === "phase_4/models/maps/ttr_t_gui_gen_mickeyFontStandard1.rgb"
    ) {
      filename = "phase_3/fonts/ttr_t_gui_gen_mickeyFontStandard1.rgb";
    } else if (filename.includes("ttr_t_gui_gen_mickeyFontMaximum1.rgb")) {
      filename = "phase_3/maps/ttr_t_gui_gen_mickeyFontMaximum1.rgb";
    } else if (filename.includes("ttr_t_gui_gen_mickeyFontMaximum2.rgb")) {
      filename = "phase_3/maps/ttr_t_gui_gen_mickeyFontMaximum2.rgb";
    }

    try {
      const decoded = await loader.loadTexture(
        filename,
        texture.alphaFilename,
        texture.format,
      );

      // Create GPU texture
      const gfxTexture = this.device.createTexture(
        makeTextureDescriptor2D(
          GfxFormat.U8_RGBA_NORM,
          decoded.width,
          decoded.height,
          1,
        ),
      );
      this.device.uploadTextureData(gfxTexture, 0, [decoded.data]);
      this.device.setResourceName(gfxTexture, texture.name);

      const gfxSampler = this.renderHelper.renderCache.createSampler(
        getSamplerDescriptor(texture),
      );
      this.textureCache.set(texture.name, {
        texture: gfxTexture,
        sampler: gfxSampler,
      });
      console.debug(
        `Loaded external texture ${texture.name} from ${filename} (${decoded.width}x${decoded.height})${texture.alphaFilename ? " with alpha" : ""}`,
      );
    } catch (e) {
      console.warn(`Failed to load external texture ${texture.name}:`, e);
    }
  }

  /**
   * Set up a render instance for a specific geom.
   */
  private setupRenderInst(
    geomNode: GeomNode,
    geomData: CachedGeometryData,
    renderState: RenderState,
    netTransform: ReadonlyMat4,
    viewMatrix: ReadonlyMat4,
  ): GfxRenderInst {
    const renderInstManager = this.renderHelper.renderInstManager;
    const renderInst = renderInstManager.newRenderInst();

    // Setup material properties
    const material = extractMaterial(geomNode, renderState);
    const depthWrite = material.depthWrite === DepthWriteMode.On;
    const depthCompare = translateDepthTestMode(material.depthTestMode);
    let frontFace = GfxFrontFaceMode.CW;
    let cullMode = material.cullReverse ? GfxCullMode.Back : GfxCullMode.Front;
    switch (material.cullFaceMode) {
      case CullFaceMode.CullClockwise:
        break;
      case CullFaceMode.CullCounterClockwise:
        frontFace = GfxFrontFaceMode.CCW;
        break;
      case CullFaceMode.CullNone:
        cullMode = GfxCullMode.None;
        break;
    }
    renderInst.setMegaStateFlags({
      depthWrite,
      depthCompare: reverseDepthForCompareMode(depthCompare),
      cullMode,
      frontFace,
    });
    if (material.colorWriteChannels !== ColorWriteChannels.All) {
      setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
        // This flagset happens to be the same
        channelWriteMask: material.colorWriteChannels,
      });
    }
    if (
      material.transparencyMode === TransparencyMode.Alpha ||
      material.transparencyMode === TransparencyMode.Dual
    ) {
      setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
      });
    }

    // Set vertex input
    const vertexBuffers = geomData.vertexBuffers.map((buffer) => ({
      buffer,
      byteOffset: 0,
    }));
    if (geomData.skinningBuffer !== null) {
      vertexBuffers.push({ buffer: geomData.skinningBuffer, byteOffset: 0 });
    }
    renderInst.setVertexInput(
      geomData.inputLayout,
      vertexBuffers,
      geomData.indexBuffer
        ? { buffer: geomData.indexBuffer, byteOffset: 0 }
        : null,
    );

    // Determine number of uniform buffers needed
    const numUniformBuffers = geomData.skinningBuffer !== null ? 3 : 2;

    // Set texture bindings
    const textureMapping = new TextureMapping();
    if (material.texture !== null) {
      const cached = this.textureCache.get(material.texture.name);
      if (!cached)
        throw new Error(`Texture ${material.texture.name} not found`);
      textureMapping.gfxTexture = cached.texture;
      textureMapping.gfxSampler = cached.sampler;
      renderInst.setBindingLayouts([{ numUniformBuffers, numSamplers: 1 }]);
      renderInst.setSamplerBindingsFromTextureMappings([textureMapping]);
    } else {
      renderInst.setBindingLayouts([{ numUniformBuffers, numSamplers: 0 }]);
    }

    // Setup skinning uniform buffer if needed
    if (geomData.skinningBuffer !== null) {
      setupSkinningUniform(renderInst, geomData.skinningTransforms);
    }

    const modelMatrix = mat4.clone(netTransform);

    // Apply billboard effect if present
    if (material.billboardEffect && !material.billboardEffect.off) {
      const modelViewMatrix = mat4.create();
      mat4.mul(modelViewMatrix, viewMatrix, modelMatrix);

      let flags: CalcBillboardFlags = CalcBillboardFlags.UseZSphere;
      if (!material.billboardEffect.eyeRelative) {
        flags |= CalcBillboardFlags.UseRollGlobal;
      }
      if (material.billboardEffect.axialRotate) {
        flags |= CalcBillboardFlags.PriorityY;
      }

      calcBillboardMatrix(modelMatrix, modelViewMatrix, flags);
      modelMatrix[8] = modelViewMatrix[8];
      modelMatrix[9] = modelViewMatrix[9];
      modelMatrix[10] = modelViewMatrix[10];

      const viewMatrixInv = mat4.create();
      mat4.invert(viewMatrixInv, viewMatrix);
      mat4.mul(modelMatrix, viewMatrixInv, modelMatrix);
    }

    renderInst.setDrawCount(geomData.indexCount);

    this.setupProgram(renderInst, geomData, material);
    setupDrawUniform(renderInst, material, modelMatrix);
    return renderInst;
  }

  private setupProgram(
    renderInst: GfxRenderInst,
    geomData: CachedGeometryData,
    material: MaterialData,
  ) {
    const programProps = createProgramProps(geomData, material);
    let program = this.programCache.get(programProps);
    if (program === null) {
      const programDesc = new ToontownProgram(programProps);
      program = this.renderHelper.renderCache.createProgram(programDesc);
      this.programCache.add(programProps, program);
    }
    renderInst.setGfxProgram(program);
    return program;
  }

  private prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
    this.profiler.beginFrame();
    addFrameTime(viewerInput.deltaTime / 1000);
    intervalManager.step();

    const renderInstManager = this.renderHelper.renderInstManager;
    const template = this.renderHelper.pushTemplateRenderInst();
    template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 0 }]);
    // template.setMegaStateFlags({
    //   wireframe: true,
    // });

    // Allocate scene params UBO
    let offs = template.allocateUniformBuffer(
      ToontownProgram.ub_SceneParams,
      16 + 16,
    );
    const sceneParams = template.mapUniformBufferF32(
      ToontownProgram.ub_SceneParams,
    );
    offs += fillMatrix4x4(
      sceneParams,
      offs,
      viewerInput.camera.projectionMatrix,
    );
    const viewMatrix = mat4.create();
    mat4.mul(viewMatrix, viewerInput.camera.viewMatrix, pandaToNoclip);
    offs += fillMatrix4x4(sceneParams, offs, viewMatrix);

    // Update camera node position
    const cameraNode = this.scene.find("**/camera");
    if (!cameraNode) throw new Error("Camera node not found");
    cameraNode.setPosHprScale(
      vec3.fromValues(
        viewerInput.camera.worldMatrix[12],
        -viewerInput.camera.worldMatrix[14],
        viewerInput.camera.worldMatrix[13],
      ),
      vec3.create(), // TODO
      vec3.fromValues(1, 1, 1),
    );

    // Rotate sky if present
    const skyNode = this.scene.find("**/=sky");
    if (skyNode) {
      const h = getFrameTime() * 0.00025;
      skyNode.find("**/cloud1")?.setH(h);
      skyNode.find("**/cloud2")?.setH(-h * 0.8);
    }

    // Rotate DG flower if present
    const flowerNode = this.scene.find("**/flower");
    if (flowerNode) {
      flowerNode.setH(
        flowerNode.h + 1.25 * (viewerInput.deltaTime / (1000 / 15)),
      );
    }

    const binCollector = new BinCollector(viewerInput.camera.viewMatrix);

    // Traverse scene graph and submit render instructions
    // decalCollector: When non-null, we're inside a decal group and should collect
    // render results here instead of submitting to binCollector directly.
    function traverse(
      this: ToontownRenderer,
      node: PandaNode,
      parentTransform: ReadonlyMat4,
      parentDrawMask: number,
      parentState: RenderState,
    ): void {
      // Compose draw mask for this node
      const runningDrawMask = composeDrawMask(
        parentDrawMask,
        node.drawControlMask,
        node.drawShowMask,
      );

      // Check if this node is visible (children may still be visible via showThrough)
      const thisNodeVisible = isNodeVisible(runningDrawMask);

      // CompassEffect handling (always - affects child transforms)
      const compassEffect = node.effects.effects.find(
        (effect) => effect instanceof CompassEffect,
      );
      if (compassEffect?.reference) {
        // TODO actually check CompassEffect properties
        node.pos = compassEffect.reference.pos;
      }

      // Accumulate transform
      let netTransform: ReadonlyMat4;
      if (node.transform.isIdentity) {
        netTransform = parentTransform;
      } else {
        const mtx = mat4.create();
        mat4.multiply(mtx, parentTransform, node.transform.getMatrix());
        netTransform = mtx;
      }

      // Combine render states
      const renderState = parentState.compose(node.state);

      if (node instanceof Character) {
        node.partBundles.forEach((bundle) => {
          bundle.update();
        });
      }

      // Only render geometry if this node is visible
      if (thisNodeVisible && node instanceof GeomNode) {
        // Check if this node is a decal base
        if (
          node.effects.effects.some((effect) => effect instanceof DecalEffect)
        ) {
          // Use AABB culling
          scratchAABB.transform(node.getBoundingBox(), netTransform);
          scratchAABB.transform(scratchAABB, pandaToNoclip);
          if (!viewerInput.camera.frustum.contains(scratchAABB)) {
            return;
          }

          binCollector.add({
            geomNode: node,
            geomData: null,
            renderState,
            modelMatrix: netTransform,
            drawMask: runningDrawMask,
          });
          return; // Skip traversing children (decal children rendered later)
        }

        for (const { geom, state } of node.geoms) {
          const geomData = createGeomData(
            geom,
            this.renderHelper.renderCache,
            this.geomCache,
          );

          // Frustum culling: skip geometry that's not visible
          let culled = false;
          if (geomData.boundsType === BoundsType.Box) {
            // Use AABB culling
            scratchAABB.transform(geomData.aabb, netTransform);
            scratchAABB.transform(scratchAABB, pandaToNoclip);
            culled = !viewerInput.camera.frustum.contains(scratchAABB);
          } else {
            // Use sphere culling (Sphere, Fastest, etc.)
            vec3.transformMat4(
              scratchSphereCenter,
              geomData.sphereCenter,
              netTransform,
            );
            vec3.transformMat4(
              scratchSphereCenter,
              scratchSphereCenter,
              pandaToNoclip,
            );

            // Scale radius by max scale factor from transform
            const scaleX = Math.hypot(
              netTransform[0],
              netTransform[1],
              netTransform[2],
            );
            const scaleY = Math.hypot(
              netTransform[4],
              netTransform[5],
              netTransform[6],
            );
            const scaleZ = Math.hypot(
              netTransform[8],
              netTransform[9],
              netTransform[10],
            );
            const maxScale = Math.max(scaleX, scaleY, scaleZ);
            const transformedRadius = geomData.sphereRadius * maxScale;

            culled = !viewerInput.camera.frustum.containsSphere(
              scratchSphereCenter,
              transformedRadius,
            );
          }
          if (culled) {
            continue;
          }

          binCollector.add({
            geomNode: node,
            geomData,
            renderState: renderState.compose(state),
            modelMatrix: netTransform,
            drawMask: runningDrawMask,
          });
        }
      }

      // Always traverse children even if this node is hidden
      // Children may use showThrough() to override parent visibility
      for (const [child, _sort] of node.children) {
        traverse.call(this, child, netTransform, runningDrawMask, renderState);
      }
    }

    // Start traversal from the found node with all bits on (default visibility)
    this.profiler.begin("traverse");
    traverse.call(
      this,
      this.scene,
      mat4.create(),
      0xffffffff,
      this.scene.state,
    );
    this.profiler.end("traverse");

    // Submit all collected render insts to the render list in correct bin order
    this.profiler.begin("submit");

    this.profiler.begin("binFinish");
    const sortedObjects = binCollector.finish();
    this.profiler.end("binFinish");

    this.profiler.begin("setupRenderInst");
    for (const obj of sortedObjects) {
      if (obj.geomData) {
        // Regular render
        this.renderInstListMain.submitRenderInst(
          this.setupRenderInst(
            obj.geomNode,
            obj.geomData,
            obj.renderState,
            obj.modelMatrix,
            viewMatrix,
          ),
        );
      } else {
        function doRender(
          this: ToontownRenderer,
          node: GeomNode,
          { geom, state }: GeomEntry,
          renderState: RenderState,
          modelMatrix: ReadonlyMat4,
        ) {
          this.renderInstListMain.submitRenderInst(
            this.setupRenderInst(
              node,
              createGeomData(
                geom,
                this.renderHelper.renderCache,
                this.geomCache,
              ),
              renderState.compose(state),
              modelMatrix,
              viewMatrix,
            ),
          );
        }
        // Decal render
        const baseState = obj.renderState.withAttrib(
          DepthWriteAttrib.create(DepthWriteMode.Off),
          MAX_PRIORITY,
        );
        // Draw base with depth write disabled
        for (const entry of obj.geomNode.geoms) {
          doRender.call(this, obj.geomNode, entry, baseState, obj.modelMatrix);
        }
        // Draw children with depth write disabled
        function doRenderChild(
          this: ToontownRenderer,
          base: PandaNode,
          renderState: RenderState,
          parentTransform: ReadonlyMat4,
          parentDrawMask: number,
        ) {
          for (const [child, _sort] of base.children) {
            // Compose draw mask for this child
            const runningDrawMask = composeDrawMask(
              parentDrawMask,
              child.drawControlMask,
              child.drawShowMask,
            );

            let netTransform: ReadonlyMat4;
            if (child.transform.isIdentity) {
              netTransform = parentTransform;
            } else {
              const mtx = mat4.create();
              mat4.multiply(mtx, parentTransform, child.transform.getMatrix());
              netTransform = mtx;
            }
            const childState = renderState.compose(child.state);

            // Only render if visible
            if (isNodeVisible(runningDrawMask) && child instanceof GeomNode) {
              for (const entry of child.geoms) {
                doRender.call(this, child, entry, childState, netTransform);
              }
            }

            // Continue traversing children (for showThrough support)
            doRenderChild.call(
              this,
              child,
              childState,
              netTransform,
              runningDrawMask,
            );
          }
        }
        doRenderChild.call(
          this,
          obj.geomNode,
          baseState,
          obj.modelMatrix,
          obj.drawMask,
        );
        // Draw base with color write disabled
        const finalState = obj.renderState.withAttrib(
          ColorWriteAttrib.create(ColorWriteChannels.Off),
          MAX_PRIORITY,
        );
        for (const entry of obj.geomNode.geoms) {
          doRender.call(this, obj.geomNode, entry, finalState, obj.modelMatrix);
        }
      }
    }
    this.profiler.end("setupRenderInst");
    this.profiler.end("submit");

    // Output profiler info to debug console
    viewerInput.debugConsole.addInfoLine(this.profiler.getInfoLine());
    this.profiler.endFrame();

    renderInstManager.popTemplate();
    this.renderHelper.prepareToRender();
  }

  public render(
    _device: GfxDevice,
    viewerInput: Viewer.ViewerRenderInput,
  ): void {
    const builder = this.renderHelper.renderGraph.newGraphBuilder();

    // Create render targets
    const mainColorDesc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.Color0,
      viewerInput,
      standardFullClearRenderPassDescriptor,
    );
    // mainColorDesc.clearColor = { r: 0.41, g: 0.41, b: 0.41, a: 1.0 }; // Panda3D default
    mainColorDesc.clearColor = { r: 0.3, g: 0.3, b: 0.3, a: 1.0 }; // Toontown
    const mainDepthDesc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.DepthStencil,
      viewerInput,
      standardFullClearRenderPassDescriptor,
    );

    const mainColorTargetID = builder.createRenderTargetID(
      mainColorDesc,
      "Main Color",
    );
    const mainDepthTargetID = builder.createRenderTargetID(
      mainDepthDesc,
      "Main Depth",
    );

    // Main render pass
    builder.pushPass((pass) => {
      pass.setDebugName("Main");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
      pass.attachRenderTargetID(
        GfxrAttachmentSlot.DepthStencil,
        mainDepthTargetID,
      );
      pass.exec((passRenderer) => {
        this.renderInstListMain.drawOnPassRenderer(
          this.renderHelper.renderCache,
          passRenderer,
        );
      });
    });

    // Resolve to screen
    builder.resolveRenderTargetToExternalTexture(
      mainColorTargetID,
      viewerInput.onscreenTexture,
    );

    // Prepare and execute
    this.prepareToRender(viewerInput);
    this.renderHelper.renderGraph.execute(builder);
    this.renderInstListMain.reset();

    // Draw scene graph viewer debug overlays
    if (this.sceneGraphViewer !== null) {
      this.sceneGraphViewer.drawHighlightedAABB(
        viewerInput.camera.clipFromWorldMatrix,
      );
    }
  }

  public destroy(device: GfxDevice): void {
    // Stop background music if playing
    stopPlayback();

    // Clear all active intervals without finishing them
    intervalManager.pauseAll();

    // Reset global frame time
    resetFrameTime();

    // Close scene graph viewer if open
    if (this.sceneGraphViewer !== null) {
      this.sceneGraphViewer.close();
      this.sceneGraphViewer = null;
    }

    for (const geomData of this.geomCache.values()) {
      for (const vertexBuffer of geomData.vertexBuffers) {
        device.destroyBuffer(vertexBuffer);
      }
      if (geomData.indexBuffer) {
        device.destroyBuffer(geomData.indexBuffer);
      }
    }
    for (const { texture } of this.textureCache.values()) {
      device.destroyTexture(texture);
    }
    this.renderHelper.destroy();
  }
}

function setupDrawUniform(
  renderInst: GfxRenderInst,
  material: MaterialData,
  modelMatrix: mat4,
) {
  let offs = renderInst.allocateUniformBuffer(
    ToontownProgram.ub_DrawParams,
    16 + 4 + 4,
  );
  const drawParams = renderInst.mapUniformBufferF32(
    ToontownProgram.ub_DrawParams,
  );
  offs += fillMatrix4x4(drawParams, offs, modelMatrix);
  offs += fillVec4v(drawParams, offs, material.flatColor);
  offs += fillVec4v(drawParams, offs, material.colorScale);
}

function setupSkinningUniform(
  renderInst: GfxRenderInst,
  transforms: VertexTransform[],
): void {
  if (transforms.length > MAX_BONES) {
    console.warn(
      `Skinning transforms count ${transforms.length} exceeds maximum of ${MAX_BONES}`,
    );
  }
  const numBones = Math.min(transforms.length, MAX_BONES);

  // Allocate uniform buffer for skinning
  const offs = renderInst.allocateUniformBuffer(
    ToontownProgram.ub_SkinningParams,
    MAX_BONES * 12,
  );
  const data = renderInst.mapUniformBufferF32(
    ToontownProgram.ub_SkinningParams,
  );

  // Fill bone matrices
  const tempMat = mat4.create();
  for (let i = 0; i < numBones; i++) {
    transforms[i].getMatrix(tempMat);
    fillMatrix4x3(data, offs + i * 12, tempMat);
  }
}

/**
 * Convert PandaCompareFunc to GfxCompareMode
 */
function translateDepthTestMode(func: PandaCompareFunc): GfxCompareMode {
  switch (func) {
    case PandaCompareFunc.None:
    case PandaCompareFunc.Always:
      return GfxCompareMode.Always;
    case PandaCompareFunc.Never:
      return GfxCompareMode.Never;
    case PandaCompareFunc.Less:
      return GfxCompareMode.Less;
    case PandaCompareFunc.LessEqual:
      return GfxCompareMode.LessEqual;
    case PandaCompareFunc.Greater:
      return GfxCompareMode.Greater;
    case PandaCompareFunc.GreaterEqual:
      return GfxCompareMode.GreaterEqual;
    case PandaCompareFunc.Equal:
      return GfxCompareMode.Equal;
    case PandaCompareFunc.NotEqual:
      return GfxCompareMode.NotEqual;
  }
}
