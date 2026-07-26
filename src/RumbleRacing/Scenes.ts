import {
  ActorData,
  ActorTransforms,
  DrawCall,
  ExcludeInfo,
  processTrackFile,
  RumbleRacingTrackFile,
} from "./rumbleRacing";
import { mat4 } from "gl-matrix";
import { IS_DEVELOPMENT } from "../BuildVersion";
import {
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers";
import {
  fillMatrix4x3,
  fillMatrix4x4,
  fillVec4,
} from "../gfx/helpers/UniformBufferHelpers";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import {
  GfxCullMode,
  GfxDevice,
  GfxMipFilterMode,
  GfxProgram,
  GfxSampler,
  GfxTexFilterMode,
  GfxTexture,
  GfxWrapMode,
  GfxBlendMode,
  GfxBlendFactor,
  GfxChannelWriteMask,
  GfxCompareMode,
  makeTextureDescriptor2D,
  GfxFormat,
} from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import {
  GfxRenderInst,
  GfxRenderInstList,
} from "../gfx/render/GfxRenderInstManager";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxMegaStateDescriptor } from "../gfx/platform/GfxPlatform";
import { BlendMode } from "./asset/o3d/geometry";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { FakeTextureHolder } from "../TextureHolder";
import { O3DGeometry, ObfGeometry } from "./Geometry";
import { TrackProgram } from "./TrackProgram";

const pathBase = `RumbleRacing`;

const GLOBAL_SCALE = 300.0; // this feels the best

const megaStateScratch: Partial<GfxMegaStateDescriptor> = {};

// Alpha at or above this counts as solid enough to own the depth buffer. Same
// threshold RatchetAndClank's tfrags use for the equivalent split.
const SOLID_PASS_ALPHA_REF = 0.99;

class RumbleRacingScene implements SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstList = new GfxRenderInstList();
  private blendedRenderInstList = new GfxRenderInstList();
  private trackGeometries: ObfGeometry[] = [];
  private o3dGeometries: Map<number, O3DGeometry> = new Map();
  private programCache = new Map<number, GfxProgram>();
  private linearSampler: GfxSampler;
  private textureMap = new Map<number, GfxTexture>();
  private showActors: boolean = true;
  private wireframe: boolean = false;
  private showVertexColors: boolean = true;
  private showTextures: boolean = true;

  public textureHolder = new FakeTextureHolder([]);
  private actorMatrices = new Map<number, mat4>();

  constructor(
    private sceneContext: SceneContext,
    private trackFile: RumbleRacingTrackFile,
    private actorTrans: ActorTransforms,
    private exclude: ExcludeInfo,
  ) {
    this.renderHelper = new GfxRenderHelper(sceneContext.device, sceneContext);
    const cache = this.renderHelper.renderCache;

    // we don't want to show these in any map
    this.exclude.textureIds?.add(3120); // semi-transparent cloud texture, not RE'd properly

    this.setActorTransforms();

    for (const actor of this.trackFile.actors) {
      this.actorMatrices.set(
        actor.resourceIndex,
        buildActorMatrix(actor, GLOBAL_SCALE),
      );
    }

    for (const obf of this.trackFile.obfs) {
      this.trackGeometries.push(new ObfGeometry(cache, obf, this.exclude));
    }

    for (let i = 0; i < this.trackFile.o3ds.length; i++) {
      const o3d = this.trackFile.o3ds[i];
      this.o3dGeometries.set(
        o3d.resourceIndex,
        new O3DGeometry(cache, o3d, this.exclude),
      );
    }

    this.linearSampler = cache.createSampler({
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Linear,
      wrapS: GfxWrapMode.Repeat,
      wrapT: GfxWrapMode.Repeat,
    });

    this.handleTextures();
  }

  private setActorTransforms() {
    for (const actor of this.trackFile.actors) {
      if (this.actorTrans && this.actorTrans[actor.resourceIndex]) {
        actor.transform = this.actorTrans[actor.resourceIndex];
        // console.log("Set trans for", actor.Name, actor.transform);
      }
      // else {
      // console.log("no trans data for ", actor.Name, actor.ResourceIndex);
      // }
    }
  }

  private handleTextures() {
    const device = this.renderHelper.device;

    for (const texture of this.trackFile.textures.sort(
      (a, b) => a.textureId - b.textureId,
    )) {
      const tex = device.createTexture(
        makeTextureDescriptor2D(
          GfxFormat.U8_RGBA_NORM,
          texture.width,
          texture.height,
          texture.levels.length,
        ),
      );

      device.uploadTextureData(tex, 0, texture.levels);
      device.setResourceName(tex, `texture_${texture.textureId}`);

      this.textureMap.set(texture.textureId, tex);
      this.textureHolder.viewerTextures.push({ gfxTexture: tex });
    }

    this.textureHolder.onnewtextures();
  }

  private getProgram(hasVertexColors: boolean): GfxProgram {
    const ignoreVertexColors = hasVertexColors && !this.showVertexColors;
    const ignoreTextures = !this.showTextures;

    const key =
      (hasVertexColors ? 1 : 0) |
      (ignoreVertexColors ? 2 : 0) |
      (ignoreTextures ? 4 : 0);

    let program = this.programCache.get(key);
    if (program === undefined) {
      program = this.renderHelper.renderCache.createProgram(
        new TrackProgram(hasVertexColors, ignoreVertexColors, ignoreTextures),
      );
      this.programCache.set(key, program);
    }
    return program;
  }

  private fillSceneParams(
    template: GfxRenderInst,
    viewerInput: ViewerRenderInput,
  ): void {
    const data = template.allocateUniformBufferF32(
      TrackProgram.ub_SceneParams,
      16,
    );
    fillMatrix4x4(data, 0, viewerInput.camera.clipFromWorldMatrix);
  }

  private newDrawCallInst(
    geometry: ObfGeometry,
    dc: DrawCall,
    tex: GfxTexture,
    modelMatrix: mat4,
    alphaTestRef: number,
  ): GfxRenderInst {
    const renderInst = this.renderHelper.renderInstManager.newRenderInst();
    renderInst.setGfxProgram(this.getProgram(dc.hasVertexColors));
    renderInst.setSamplerBindings(0, [
      { gfxTexture: tex, gfxSampler: this.linearSampler },
    ]);
    renderInst.setVertexInput(
      geometry.inputLayout,
      [{ buffer: dc.vertexBuffer, byteOffset: 0 }],
      { buffer: dc.indexBuffer, byteOffset: 0 },
    );
    renderInst.setDrawCount(dc.indexCount);

    const meshParams = renderInst.allocateUniformBufferF32(
      TrackProgram.ub_MeshParams,
      16,
    );
    const offs = fillMatrix4x3(meshParams, 0, modelMatrix);
    fillVec4(meshParams, offs, alphaTestRef, 0, 0, 0);

    return renderInst;
  }

  private submitGeometryDrawCalls(
    geometry: ObfGeometry,
    modelMatrix: mat4,
  ): void {
    for (const dc of geometry.drawCalls) {
      const tex = this.textureMap.get(dc.textureId);
      if (!tex) continue;

      if (dc.blendMode === BlendMode.None) {
        this.renderInstList.submitRenderInst(
          this.newDrawCallInst(geometry, dc, tex, modelMatrix, 0.0),
        );
        continue;
      }

      // Blended geometry is drawn twice, the way RatchetAndClank's tfrags are.
      // First the near-opaque texels, with depth writes left on, so the surface
      // still occludes whatever sits behind it -- a surface that owns no depth at
      // all gets painted over by anything submitted after it, however far away
      // that is.
      this.renderInstList.submitRenderInst(
        this.newDrawCallInst(
          geometry,
          dc,
          tex,
          modelMatrix,
          SOLID_PASS_ALPHA_REF,
        ),
      );

      // Then the soft remainder. A strict depth compare makes this the exact
      // complement of the pass above: fragments the solid pass already claimed
      // sit at equal depth and get rejected, so nothing blends over itself.
      const soft = this.newDrawCallInst(geometry, dc, tex, modelMatrix, 0.0);
      soft.setMegaStateFlags({
        depthWrite: false,
        depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
      });
      setAttachmentStateSimple(megaStateScratch, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor:
          dc.blendMode === BlendMode.Additive
            ? GfxBlendFactor.One // ALPHA 0x48: Cs * As + Cd
            : GfxBlendFactor.OneMinusSrcAlpha, // ALPHA 0x44: (Cs - Cd) * As + Cd
      });
      soft.setMegaStateFlags(megaStateScratch);
      this.blendedRenderInstList.submitRenderInst(soft);
    }
  }

  private renderMap(): void {
    // Blending is opted into per draw call from PRMODE's ABE bit, so the
    // default here has to be fully opaque.
    const template = this.renderHelper.renderInstManager.pushTemplate();
    template.setMegaStateFlags({ cullMode: GfxCullMode.None });

    const trackMatrix = mat4.create();
    mat4.scale(trackMatrix, trackMatrix, [
      GLOBAL_SCALE,
      GLOBAL_SCALE,
      GLOBAL_SCALE,
    ]);

    for (const geometry of this.trackGeometries) {
      this.submitGeometryDrawCalls(geometry, trackMatrix);
    }

    if (this.showActors) {
      for (const actor of this.trackFile.actors) {
        const o3dGeom = this.o3dGeometries.get(actor.o3dResourceIndex);
        if (!o3dGeom) continue;

        const actorMatrix = this.actorMatrices.get(actor.resourceIndex)!;

        if (o3dGeom.isAnimated) {
          const frame = o3dGeom.obfGeometries[o3dGeom.animationFrame];
          this.submitGeometryDrawCalls(frame, actorMatrix);
        } else {
          for (const obfGeom of o3dGeom.obfGeometries) {
            this.submitGeometryDrawCalls(obfGeom, actorMatrix);
          }
        }
      }
    }

    this.renderHelper.renderInstManager.popTemplate();
  }

  private updateAnimations(viewerInput: ViewerRenderInput): void {
    const halfSecondIndex = Math.floor(viewerInput.time / 100);
    for (const [, o3dGeom] of this.o3dGeometries) {
      if (o3dGeom.isAnimated && o3dGeom.obfGeometries.length > 0) {
        o3dGeom.animationFrame = halfSecondIndex % o3dGeom.obfGeometries.length;
      }
    }
  }

  public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
    this.updateAnimations(viewerInput);

    this.renderHelper.debugDraw.beginFrame(
      viewerInput.camera.projectionMatrix,
      viewerInput.camera.viewMatrix,
      viewerInput.backbufferWidth,
      viewerInput.backbufferHeight,
    );

    const template = this.renderHelper.pushTemplateRenderInst();
    template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 2 }]);

    if (this.wireframe) template.setMegaStateFlags({ wireframe: true });

    this.fillSceneParams(template, viewerInput);

    this.renderMap();

    const builder = this.renderHelper.renderGraph.newGraphBuilder();

    const mainColorDesc = makeBackbufferDescSimple(
      GfxrAttachmentSlot.Color0,
      viewerInput,
      standardFullClearRenderPassDescriptor,
    );
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

    builder.pushPass((pass) => {
      pass.setDebugName("Opaque Objects");
      pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
      pass.attachRenderTargetID(
        GfxrAttachmentSlot.DepthStencil,
        mainDepthTargetID,
      );
      pass.exec((passRenderer) => {
        this.renderInstList.drawOnPassRenderer(
          this.renderHelper.renderCache,
          passRenderer,
        );
        this.blendedRenderInstList.drawOnPassRenderer(
          this.renderHelper.renderCache,
          passRenderer,
        );
      });
    });

    this.renderHelper.renderInstManager.popTemplate();
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

    this.renderHelper.prepareToRender();
    builder.execute();
  }

  public createPanels(): UI.Panel[] {
    const renderSettingsPanel = new UI.Panel();
    renderSettingsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
    renderSettingsPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Settings");

    const showActorsCheckbox = new UI.Checkbox("Show Actors", this.showActors);
    showActorsCheckbox.onchanged = () => {
      this.showActors = showActorsCheckbox.checked;
    };

    renderSettingsPanel.contents.appendChild(showActorsCheckbox.elem);

    const showVertexColorsCheckbox = new UI.Checkbox(
      "Show Vertex Colors",
      this.showVertexColors,
    );
    showVertexColorsCheckbox.onchanged = () => {
      this.showVertexColors = showVertexColorsCheckbox.checked;
    };

    renderSettingsPanel.contents.appendChild(showVertexColorsCheckbox.elem);

    const showTexturesCheckbox = new UI.Checkbox(
      "Show Textures",
      this.showTextures,
    );
    showTexturesCheckbox.onchanged = () => {
      this.showTextures = showTexturesCheckbox.checked;
    };

    renderSettingsPanel.contents.appendChild(showTexturesCheckbox.elem);

    if (this.renderHelper.device.queryLimits().wireframeSupported) {
      const wireframe = new UI.Checkbox("Wireframe", false);
      wireframe.onchanged = () => {
        const v = wireframe.checked;
        this.wireframe = v;
      };
      renderSettingsPanel.contents.appendChild(wireframe.elem);
    }

    return [renderSettingsPanel];
  }

  public destroy(device: GfxDevice): void {
    this.renderHelper.destroy();

    for (const geometry of this.trackGeometries) {
      geometry.destroy(device);
    }

    for (const [, o3dGeom] of this.o3dGeometries) {
      o3dGeom.destroy(device);
    }

    for (const vt of this.textureHolder.viewerTextures) {
      if (vt.gfxTexture !== null) device.destroyTexture(vt.gfxTexture);
    }
  }
}

function buildActorMatrix(actor: ActorData, globalScale: number): mat4 {
  const m = mat4.create();

  if (actor.transform) {
    const t = actor.transform;

    m[0] = t[0][0];
    m[1] = t[0][1];
    m[2] = t[0][2];
    m[3] = 0.0;

    m[4] = t[1][0];
    m[5] = t[1][1];
    m[6] = t[1][2];
    m[7] = 0.0;

    m[8] = t[2][0];
    m[9] = t[2][1];
    m[10] = t[2][2];
    m[11] = 0.0;

    m[12] = t[3][0] * globalScale;
    m[13] = t[3][1] * globalScale;
    m[14] = t[3][2] * globalScale;
    m[15] = 1.0;

    mat4.scale(m, m, [globalScale, globalScale, globalScale]);

    return m;
  }

  // Fallback if no transform exists
  mat4.scale(m, m, [globalScale, globalScale, globalScale]);
  return m;
}

class RumbleRacingSceneDesc implements SceneDesc {
  constructor(
    public internalName: string,
    public id: string,
    public name: string,
    public exclude: ExcludeInfo,
  ) {}

  public async createScene(
    device: GfxDevice,
    sceneContext: SceneContext,
  ): Promise<SceneGfx> {
    const folder = this.internalName.slice(0, 2);

    const [trackBlob, actorBlob] = await Promise.all([
      sceneContext.dataFetcher.fetchData(
        `${pathBase}/DATA/LOC${folder}/${this.internalName}.TRK`,
      ),
      sceneContext.dataFetcher.fetchData(
        `${pathBase}/json/${this.internalName}.json`,
      ),
    ]);

    const decoder = new TextDecoder("utf-8");
    const actorTrans = JSON.parse(
      decoder.decode(actorBlob.arrayBuffer),
    ) as unknown as ActorTransforms;

    const trackData: RumbleRacingTrackFile = processTrackFile(
      new Uint8Array(trackBlob.arrayBuffer),
      false,
    );

    const shared =
      await sceneContext.dataShare.ensureObject<RumbleRacingShared>(
        `${pathBase}/shared`,
        async () => {
          const data = await sceneContext.dataFetcher.fetchData(
            `${pathBase}/DATA/GLBLDATA.TRK`,
          );

          const globalData: RumbleRacingTrackFile = processTrackFile(
            new Uint8Array(data.arrayBuffer),
            true,
          );
          return {
            globalTrackFile: globalData,
            destroy(_device) {},
          };
        },
      );

    const existingTexIds = new Set(trackData.textures.map((x) => x.textureId));
    trackData.textures.push(
      ...shared.globalTrackFile.textures.filter(
        (t) => !existingTexIds.has(t.textureId),
      ),
    );

    return new RumbleRacingScene(
      sceneContext,
      trackData,
      actorTrans,
      this.exclude,
    );
  }
}

export const sceneGroup: SceneGroup = {
  id: "RumbleRacing",
  name: "Rumble Racing",
  sceneDescs: [
    "Beach Blast",
    new RumbleRacingSceneDesc("BB1", "SunBurn", "Sun Burn", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("BB2", "SurfAndTurf", "Surf And Turf", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    "Bad Lands",
    new RumbleRacingSceneDesc("BL1", "SoRefined", "So Refined", {
      textureIds: new Set([1584]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("BL2", "CoalCuts", "Coal Cuts", {
      // seems like there are no tornado clouds in this level for some reason?
    }),
    "Daytona",
    new RumbleRacingSceneDesc("DA1", "FlipOut", "Flip Out", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("DA2", "TheGauntlet", "The Gauntlet", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("DA3", "WildKingdom", "Wild Kingdom", {
      // no clouds in wild kingdom
    }),
    "Joke Tracks",
    new RumbleRacingSceneDesc("JT1", "CircusMinimus", "Circus Minimus", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("JT2", "OuterLimits", "Outer Limits", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    "Mountain Air",
    new RumbleRacingSceneDesc("MA1", "PassingThrough", "Passing Through", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("MA2", "FallsDown", "Falls Down", {
      textureIds: new Set([1584]), // tornado clouds
    }),
    "Metropolis",
    new RumbleRacingSceneDesc("MP1", "TouchAndGo", "Touch And Go", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("MP2", "CarGo", "Car Go", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    "Southern Exposure",
    new RumbleRacingSceneDesc("SE1", "TrueGrits", "True Grits", {
      textureIds: new Set([3120]), // tornado clouds
    }),
    new RumbleRacingSceneDesc("SE2", "OverEasy", "Over Easy", {
      textureIds: new Set([3120]), // tornado clouds
    }),
  ],
  hidden: !IS_DEVELOPMENT,
};

interface RumbleRacingShared {
  globalTrackFile: RumbleRacingTrackFile;
  destroy(device: GfxDevice): void;
}
