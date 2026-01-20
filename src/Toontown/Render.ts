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
import { BinCollector, type CullableObject } from "./CullBin";
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
  GeomNode,
  MAX_PRIORITY,
  PandaCompareFunc,
  type PandaNode,
  RenderState,
  type Texture,
  TextureAttrib,
  TransparencyMode,
  type VertexTransform,
} from "./nodes";
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

const DEPTH_WRITE_OFF = RenderState.make(
  MAX_PRIORITY,
  DepthWriteAttrib.create(DepthWriteMode.Off),
);
const COLOR_WRITE_OFF = RenderState.make(
  MAX_PRIORITY,
  ColorWriteAttrib.create(ColorWriteChannels.Off),
);

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
   * Renders a cullable object to the main render instruction list.
   */
  private drawCullableObject(
    obj: CullableObject,
    extraRenderState: RenderState | null,
    viewMatrix: ReadonlyMat4,
  ): void {
    const renderInstManager = this.renderHelper.renderInstManager;
    const renderInst = renderInstManager.newRenderInst();
    const geomData = obj.geomData;

    // Setup material properties
    const renderState = obj.renderState.compose(extraRenderState);
    const material = extractMaterial(obj.geomNode, renderState);
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

    // Apply billboard effect if present
    let modelMatrix = obj.modelMatrix;
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

      const mtx = mat4.create();
      calcBillboardMatrix(mtx, modelViewMatrix, flags);
      mtx[8] = modelViewMatrix[8];
      mtx[9] = modelViewMatrix[9];
      mtx[10] = modelViewMatrix[10];

      const viewMatrixInv = mat4.create();
      mat4.invert(viewMatrixInv, viewMatrix);
      mat4.mul(mtx, viewMatrixInv, mtx);
      modelMatrix = mtx;
    }

    renderInst.setDrawCount(geomData.indexCount);

    this.setupProgram(renderInst, geomData, material);
    setupDrawUniform(renderInst, material, modelMatrix);
    this.renderInstListMain.submitRenderInst(renderInst);
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

    interface TraverserData {
      node: PandaNode;
      parentTransform: ReadonlyMat4;
      parentDrawMask: number;
      parentState: RenderState;
      collectorOverride: CullableObject[] | null;
    }

    // Traverse scene graph and submit render instructions
    function traverse(this: ToontownRenderer, data: TraverserData): void {
      // Compose draw mask for this node
      const runningDrawMask = composeDrawMask(
        data.parentDrawMask,
        data.node.drawControlMask,
        data.node.drawShowMask,
      );

      // Check if this node is visible (children may still be visible via showThrough)
      const thisNodeVisible = isNodeVisible(runningDrawMask);

      // CompassEffect handling (always - affects child transforms)
      const compassEffect = data.node.effects.get(CompassEffect);
      if (compassEffect?.reference) {
        // TODO actually check CompassEffect properties
        data.node.pos = compassEffect.reference.pos;
      }

      // Accumulate transform
      let netTransform: ReadonlyMat4;
      if (data.node.transform.isIdentity) {
        netTransform = data.parentTransform;
      } else {
        const mtx = mat4.create();
        mat4.multiply(
          mtx,
          data.parentTransform,
          data.node.transform.getMatrix(),
        );
        netTransform = mtx;
      }

      // Combine render states
      const renderState = data.parentState.compose(data.node.state);

      // Update animations
      if (data.node instanceof Character) {
        data.node.partBundles.forEach((bundle) => {
          bundle.update();
        });
      }

      // For decals: locally collect adjacent and child geometries
      let collectorOverride = data.collectorOverride;
      let childCollectorOverride = data.collectorOverride;

      // Only render geometry if this node is visible
      let isDecalNode = false;
      if (thisNodeVisible && data.node instanceof GeomNode) {
        // Check if this node is a decal base
        if (
          // Nested decal effects are ignored
          collectorOverride === null &&
          data.node.effects.get(DecalEffect) !== null
        ) {
          collectorOverride = [];
          childCollectorOverride = [];
          isDecalNode = true;
        }

        for (const { geom, state } of data.node.geoms) {
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
            const scale = vec3.create();
            mat4.getScaling(scale, netTransform);
            const maxScale = Math.max(scale[0], scale[1], scale[2]);
            const transformedRadius = geomData.sphereRadius * maxScale;

            culled = !viewerInput.camera.frustum.containsSphere(
              scratchSphereCenter,
              transformedRadius,
            );
          }
          if (culled) {
            continue;
          }

          const obj: CullableObject = {
            geomNode: data.node,
            geomData,
            renderState: renderState.compose(state),
            modelMatrix: netTransform,
            drawMask: runningDrawMask,
            isDecalBase: false,
            adjacent: [],
            children: [],
          };
          if (collectorOverride !== null) {
            collectorOverride.push(obj);
          } else {
            binCollector.add(obj);
          }
        }
      }

      // Always traverse children even if this node is hidden
      // Children may use showThrough() to override parent visibility
      for (const [child, _sort] of data.node.children) {
        traverse.call(this, {
          node: child,
          parentTransform: netTransform,
          parentDrawMask: runningDrawMask,
          parentState: renderState,
          collectorOverride: childCollectorOverride,
        });
      }

      if (isDecalNode && collectorOverride && childCollectorOverride) {
        // Use first geom as the root object
        const obj = collectorOverride.shift();
        if (!obj) return;
        obj.isDecalBase = true;
        obj.adjacent = collectorOverride;
        obj.children = childCollectorOverride;
        binCollector.add(obj);
      }
    }

    // Start traversal from the root node with all bits on (default visibility)
    traverse.call(this, {
      node: this.scene,
      parentTransform: mat4.create(),
      parentDrawMask: 0xffffffff,
      parentState: this.scene.state,
      collectorOverride: null,
    });

    for (const obj of binCollector.finish()) {
      if (!obj.isDecalBase) {
        // Regular render
        this.drawCullableObject(obj, null, viewMatrix);
      } else {
        // Decal render
        // Draw base geometry with depth write disabled
        this.drawCullableObject(obj, DEPTH_WRITE_OFF, viewMatrix);
        for (const base of obj.adjacent) {
          this.drawCullableObject(base, DEPTH_WRITE_OFF, viewMatrix);
        }
        // Draw children with depth write disabled
        for (const child of obj.children) {
          this.drawCullableObject(child, DEPTH_WRITE_OFF, viewMatrix);
        }
        // Draw base geometry with color write disabled (order reversed)
        for (let i = obj.adjacent.length - 1; i >= 0; i--) {
          this.drawCullableObject(obj.adjacent[i], COLOR_WRITE_OFF, viewMatrix);
        }
        this.drawCullableObject(obj, COLOR_WRITE_OFF, viewMatrix);
      }
    }

    renderInstManager.popTemplate();
    this.renderHelper.prepareToRender();
  }

  public render(
    _device: GfxDevice,
    viewerInput: Viewer.ViewerRenderInput,
  ): void {
    this.renderHelper.debugDraw.beginFrame(
      viewerInput.camera.projectionMatrix,
      viewerInput.camera.viewMatrix,
      viewerInput.backbufferWidth,
      viewerInput.backbufferHeight,
    );

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

    // Prepare scene for rendering (before debug draw so transforms are ready)
    this.prepareToRender(viewerInput);

    // Draw scene graph viewer debug graphics
    if (this.sceneGraphViewer !== null) {
      this.sceneGraphViewer.drawDebugGraphics(this.renderHelper.debugDraw);
    }

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

    this.renderHelper.debugDraw.pushPasses(
      builder,
      mainColorTargetID,
      mainDepthTargetID,
    );
    this.renderHelper.antialiasingSupport.pushPasses(
      builder,
      viewerInput,
      mainColorTargetID,
    );
    builder.resolveRenderTargetToExternalTexture(
      mainColorTargetID,
      viewerInput.onscreenTexture,
    );

    // Execute render graph
    this.renderHelper.renderGraph.execute(builder);
    this.renderInstListMain.reset();
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
      if (geomData.skinningBuffer) {
        device.destroyBuffer(geomData.skinningBuffer);
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
  modelMatrix: ReadonlyMat4,
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
