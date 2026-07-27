import {
  ActorData,
  ActorTransforms,
  ExcludeInfo,
  ObfData,
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
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
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
import { DrawBatch, MergedGeometry, O3DGeometry } from "./Geometry";
import { TrackProgram } from "./TrackProgram";

const pathBase = `RumbleRacing`;

const GLOBAL_SCALE = 300.0; // this feels the best

const megaStateScratch: Partial<GfxMegaStateDescriptor> = {};

const SOLID_PASS_ALPHA_REF = 0.99;

const TOGGLEABLE_TRACK_OBFS: { name: string; label: string }[] = [
  { name: "TRACK", label: "Track" },
  { name: "TRACKPAN", label: "Track Panorama" },
];

function resourceBaseName(name: string): string {
  const upper = name.trim().toUpperCase();
  const base = upper.slice(upper.lastIndexOf(":") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

interface TrackGeometryGroup {
  geometry: MergedGeometry;
  visible: boolean;
  label: string | null;
}

class RumbleRacingScene implements SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstList = new GfxRenderInstList(null);
  private blendedRenderInstList = new GfxRenderInstList(null);
  private trackGroups: TrackGeometryGroup[] = [];
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

    this.buildTrackGroups(cache);

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
    this.resolveBatchTextures();
  }

  private buildTrackGroups(cache: GfxRenderCache): void {
    const remaining = this.trackFile.obfs.slice();

    for (const toggle of TOGGLEABLE_TRACK_OBFS) {
      const obfs: ObfData[] = [];
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (resourceBaseName(remaining[i].name) !== toggle.name) continue;
        obfs.unshift(remaining[i]);
        remaining.splice(i, 1);
      }

      if (obfs.length === 0) continue;

      this.trackGroups.push({
        geometry: new MergedGeometry(cache, obfs, this.exclude),
        visible: true,
        label: toggle.label,
      });
    }

    if (remaining.length > 0) {
      this.trackGroups.push({
        geometry: new MergedGeometry(cache, remaining, this.exclude),
        visible: true,
        label: null,
      });
    }
  }

  private resolveBatchTextures(): void {
    const resolve = (geometry: MergedGeometry) => {
      geometry.batches = geometry.batches.filter((batch) => {
        const gfxTexture = this.textureMap.get(batch.textureId);
        if (gfxTexture === undefined) return false;
        batch.samplerBindings = [
          { gfxTexture, gfxSampler: this.linearSampler },
        ];
        return true;
      });
    };

    for (const group of this.trackGroups) resolve(group.geometry);
    for (const o3dGeom of this.o3dGeometries.values())
      for (const frame of o3dGeom.frames) resolve(frame);
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

  private getProgram(hasVertexColors: boolean, alphaTest: boolean): GfxProgram {
    const ignoreVertexColors = hasVertexColors && !this.showVertexColors;
    const ignoreTextures = !this.showTextures;

    const key =
      (hasVertexColors ? 1 : 0) |
      (ignoreVertexColors ? 2 : 0) |
      (ignoreTextures ? 4 : 0) |
      (alphaTest ? 8 : 0);

    let program = this.programCache.get(key);
    if (program === undefined) {
      program = this.renderHelper.renderCache.createProgram(
        new TrackProgram(
          hasVertexColors,
          alphaTest,
          ignoreVertexColors,
          ignoreTextures,
        ),
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

  private newBatchInst(
    geometry: MergedGeometry,
    batch: DrawBatch,
    modelMatrix: mat4,
    alphaTestRef: number,
  ): GfxRenderInst {
    const renderInst = this.renderHelper.renderInstManager.newRenderInst();
    renderInst.setGfxProgram(
      this.getProgram(batch.hasVertexColors, alphaTestRef > 0.0),
    );
    renderInst.setSamplerBindings(0, batch.samplerBindings!);
    renderInst.setVertexInput(
      geometry.inputLayout,
      batch.vertexBufferDescriptors,
      batch.indexBufferDescriptor,
    );
    renderInst.setDrawCount(batch.indexCount);

    const meshParams = renderInst.allocateUniformBufferF32(
      TrackProgram.ub_MeshParams,
      16,
    );
    const offs = fillMatrix4x3(meshParams, 0, modelMatrix);
    fillVec4(meshParams, offs, alphaTestRef, 0, 0, 0);

    return renderInst;
  }

  private submitBatches(geometry: MergedGeometry, modelMatrix: mat4): void {
    for (const batch of geometry.batches) {
      if (batch.blendMode === BlendMode.None) {
        this.renderInstList.submitRenderInst(
          this.newBatchInst(geometry, batch, modelMatrix, 0.0),
        );
        continue;
      }

      this.renderInstList.submitRenderInst(
        this.newBatchInst(geometry, batch, modelMatrix, SOLID_PASS_ALPHA_REF),
      );

      const soft = this.newBatchInst(geometry, batch, modelMatrix, 0.0);
      soft.setMegaStateFlags({
        depthWrite: false,
        depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
      });
      setAttachmentStateSimple(megaStateScratch, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor:
          batch.blendMode === BlendMode.Additive
            ? GfxBlendFactor.One
            : GfxBlendFactor.OneMinusSrcAlpha,
      });
      soft.setMegaStateFlags(megaStateScratch);
      this.blendedRenderInstList.submitRenderInst(soft);
    }
  }

  private renderMap(): void {
    const template = this.renderHelper.renderInstManager.pushTemplate();
    template.setMegaStateFlags({ cullMode: GfxCullMode.None });

    const trackMatrix = mat4.create();
    mat4.scale(trackMatrix, trackMatrix, [
      GLOBAL_SCALE,
      GLOBAL_SCALE,
      GLOBAL_SCALE,
    ]);

    for (const group of this.trackGroups) {
      if (!group.visible) continue;
      this.submitBatches(group.geometry, trackMatrix);
    }

    if (this.showActors) {
      for (const actor of this.trackFile.actors) {
        const o3dGeom = this.o3dGeometries.get(actor.o3dResourceIndex);
        if (!o3dGeom) continue;

        const frame = o3dGeom.frames[o3dGeom.animationFrame];
        if (frame === undefined) continue;

        this.submitBatches(frame, this.actorMatrices.get(actor.resourceIndex)!);
      }
    }

    this.renderHelper.renderInstManager.popTemplate();
  }

  private updateAnimations(viewerInput: ViewerRenderInput): void {
    const halfSecondIndex = Math.floor(viewerInput.time / 100);
    for (const [, o3dGeom] of this.o3dGeometries) {
      if (o3dGeom.isAnimated && o3dGeom.frames.length > 0) {
        o3dGeom.animationFrame = halfSecondIndex % o3dGeom.frames.length;
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
    const trackGeometryPanel = new UI.Panel();
    trackGeometryPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
    trackGeometryPanel.setTitle(UI.LAYER_ICON, "Track Geometry");

    const showActorsCheckbox = new UI.Checkbox("Actors", this.showActors);
    showActorsCheckbox.onchanged = () => {
      this.showActors = showActorsCheckbox.checked;
    };

    trackGeometryPanel.contents.appendChild(showActorsCheckbox.elem);

    for (const group of this.trackGroups) {
      if (group.label === null) continue;
      const checkbox = new UI.Checkbox(group.label, group.visible);
      checkbox.onchanged = () => {
        group.visible = checkbox.checked;
      };
      trackGeometryPanel.contents.appendChild(checkbox.elem);
    }

    const renderSettingsPanel = new UI.Panel();
    renderSettingsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
    renderSettingsPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Settings");

    const showVertexColorsCheckbox = new UI.Checkbox(
      "Vertex Colors",
      this.showVertexColors,
    );
    showVertexColorsCheckbox.onchanged = () => {
      this.showVertexColors = showVertexColorsCheckbox.checked;
    };

    renderSettingsPanel.contents.appendChild(showVertexColorsCheckbox.elem);

    const showTexturesCheckbox = new UI.Checkbox("Textures", this.showTextures);
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

    return [trackGeometryPanel, renderSettingsPanel];
  }

  public destroy(device: GfxDevice): void {
    this.renderHelper.destroy();

    for (const group of this.trackGroups) group.geometry.destroy(device);

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
