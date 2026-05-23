import { mat4, quat, vec3 } from "gl-matrix";
import { IS_DEVELOPMENT } from "../BuildVersion";
import {
  makeBackbufferDescSimple,
  standardFullClearRenderPassDescriptor,
} from "../gfx/helpers/RenderGraphHelpers";
import {
  fillMatrix4x3,
  fillMatrix4x4,
} from "../gfx/helpers/UniformBufferHelpers";
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
} from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import {
  GfxRenderInst,
  GfxRenderInstList,
} from "../gfx/render/GfxRenderInstManager";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as UI from "../ui";
import { makeImageBitmapTexture2D } from "../gfx/helpers/TextureHelpers";
import { FakeTextureHolder } from "../TextureHolder";
import {
  RumbleRacingTrackFile,
  Actor,
  ActorTransforms,
  ExcludeInfo,
} from "./types";
import { TrackProgram } from "./TrackProgram";
import { ObfGeometry, O3DGeometry } from "./Geometry";

const GLOBAL_SCALE = 300.0; // this feels the best

class RumbleRacingScene implements SceneGfx {
  private renderHelper: GfxRenderHelper;
  private renderInstList = new GfxRenderInstList();
  private trackGeometries: ObfGeometry[] = [];
  private o3dGeometries: Map<number, O3DGeometry> = new Map();
  private trackProgram: GfxProgram;
  private linearSampler: GfxSampler;
  private textureMap = new Map<number, GfxTexture>();
  private showActors: boolean = true;

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

    for (const actor of this.trackFile.Actors) {
      this.actorMatrices.set(
        actor.ResourceIndex,
        buildActorMatrix(actor, GLOBAL_SCALE),
      );
    }

    // Track OBF geometry
    for (const obf of this.trackFile.Obfs) {
      this.trackGeometries.push(new ObfGeometry(cache, obf, this.exclude));
    }

    // O3D model geometry
    for (let i = 0; i < this.trackFile.O3Ds.length; i++) {
      const o3d = this.trackFile.O3Ds[i];
      this.o3dGeometries.set(
        o3d.ResourceIndex,
        new O3DGeometry(cache, o3d, this.exclude),
      );
    }

    this.trackProgram = cache.createProgram(new TrackProgram());

    this.linearSampler = cache.createSampler({
      minFilter: GfxTexFilterMode.Bilinear,
      magFilter: GfxTexFilterMode.Bilinear,
      mipFilter: GfxMipFilterMode.Nearest,
      wrapS: GfxWrapMode.Repeat,
      wrapT: GfxWrapMode.Repeat,
    });

    this.handleTextures();
  }

  private setActorTransforms() {
    for (const actor of this.trackFile.Actors) {
      if (this.actorTrans && this.actorTrans[actor.ResourceIndex]) {
        actor.transform = this.actorTrans[actor.ResourceIndex];
        // console.log("Set trans for", actor.Name, actor.transform);
      }
      // else {
      // console.log("no trans data for ", actor.Name, actor.ResourceIndex);
      // }
    }
  }

  private async handleTextures() {
    for (const texture of this.trackFile.Textures.sort(
      (a, b) => a.TextureId - b.TextureId,
    )) {
      const binary = atob(texture.PngBytes);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      const imageBitmap = await createImageBitmap(blob);

      const device = this.renderHelper.device;
      const tex = makeImageBitmapTexture2D(device, imageBitmap);
      device.setResourceName(tex, `texture_${texture.TextureId}`);

      this.textureMap.set(texture.TextureId, tex);
      this.textureHolder.viewerTextures.push({ gfxTexture: tex });
    }
    this.textureHolder.onnewtextures();
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

  private submitGeometryDrawCalls(
    geometry: ObfGeometry,
    modelMatrix: mat4,
  ): void {
    for (const dc of geometry.drawCalls) {
      const tex = this.textureMap.get(dc.textureId);
      if (!tex) continue;

      const renderInst = this.renderHelper.renderInstManager.newRenderInst();
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
        12,
      );
      fillMatrix4x3(meshParams, 0, modelMatrix);

      this.renderInstList.submitRenderInst(renderInst);
    }
  }

  private renderMap(): void {
    const template = this.renderHelper.renderInstManager.pushTemplate();
    template.setGfxProgram(this.trackProgram);
    template.setMegaStateFlags({
      cullMode: GfxCullMode.None,
      attachmentsState: [
        {
          channelWriteMask: GfxChannelWriteMask.AllChannels,
          rgbBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
          },
          alphaBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
          },
        },
      ],
    });

    const trackMatrix = mat4.create();
    mat4.scale(trackMatrix, trackMatrix, [
      GLOBAL_SCALE,
      GLOBAL_SCALE,
      GLOBAL_SCALE,
    ]);

    for (const geometry of this.trackGeometries) {
      this.submitGeometryDrawCalls(geometry, trackMatrix);
    }

    // ── Instanced O3D actors ──────────────────────────────────────────────
    if (this.showActors) {
      for (const actor of this.trackFile.Actors) {
        const o3dGeom = this.o3dGeometries.get(actor.O3DResourceIndex);
        if (!o3dGeom) continue;

        const actorMatrix = this.actorMatrices.get(actor.ResourceIndex)!;

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

// build a world matrix from an actor's transform data or fallback
function buildActorMatrix(actor: Actor, globalScale: number): mat4 {
  const m = mat4.create();

  if (actor.transform) {
    const t = actor.transform;

    // Column 0: Right vector (Rotation X)
    m[0] = t[0][0];
    m[1] = t[0][1];
    m[2] = t[0][2];
    m[3] = 0.0;

    // Column 1: Up vector (Rotation Y)
    m[4] = t[1][0];
    m[5] = t[1][1];
    m[6] = t[1][2];
    m[7] = 0.0;

    // Column 2: Forward vector (Rotation Z)
    m[8] = t[2][0];
    m[9] = t[2][1];
    m[10] = t[2][2];
    m[11] = 0.0;

    // Column 3: Translation (Position) scaled properly
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
    const baseUrl = `./RumbleRacing/`;

    const [trackBlob, globalBlob, actorBlob] = await Promise.all([
      sceneContext.dataFetcher.fetchData(
        `${baseUrl}/DATA/LOC${folder}/${this.internalName}.TRK`,
      ),
      sceneContext.dataFetcher.fetchData(`${baseUrl}/DATA/GLBLDATA.TRK`),
      sceneContext.dataFetcher.fetchData(
        `${baseUrl}/json/${this.internalName}.json`,
      ),
    ]);

    const decoder = new TextDecoder("utf-8");
    const actorTrans = JSON.parse(
      decoder.decode(actorBlob.arrayBuffer),
    ) as unknown as ActorTransforms;

    const trackBuffer = trackBlob.arrayBuffer;
    const globalBuffer = globalBlob.arrayBuffer;

    // spin up the worker and offload WASM parsing
    const myWorker = new Worker(new URL("worker.ts", import.meta.url));

    // Get the absolute URL of the WASM file relative to this module
    const wasmUrl = new URL("./rumble-racing.wasm", import.meta.url).href;

    const wasmParsingPromise = new Promise<{
      trackData: RumbleRacingTrackFile;
      globalData: RumbleRacingTrackFile;
    }>((resolve, reject) => {
      myWorker.onmessage = (e) => {
        myWorker.terminate(); // Clean up worker resources once finished
        if (e.data.success) {
          resolve({
            trackData: e.data.trackData,
            globalData: e.data.globalData,
          });
        } else {
          reject(new Error(`Worker WASM Error: ${e.data.error}`));
        }
      };
      myWorker.onerror = (err) => {
        myWorker.terminate();
        reject(err);
      };
    });

    myWorker.postMessage({ trackBuffer, globalBuffer, wasmUrl }, [
      trackBuffer,
      globalBuffer,
    ]);

    // Make the progress bar look like we're doing something
    sceneContext.dataFetcher.progressMeter?.setProgress(0.93);

    // Wait for the worker to finish processing
    const { trackData, globalData } = await wasmParsingPromise;

    sceneContext.dataFetcher.progressMeter?.setProgress(1.0);

    const existingTexIds = new Set(trackData.Textures.map((x) => x.TextureId));
    trackData.Textures.push(
      ...globalData.Textures.filter((t) => !existingTexIds.has(t.TextureId)),
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
      textureIds: new Set([32]), // sky texture
    }),
    new RumbleRacingSceneDesc("BB2", "SurfAndTurf", "Surf And Turf", {}),
    "Bad Lands",
    new RumbleRacingSceneDesc("BL1", "SoRefined", "So Refined", {
      textureIds: new Set([1584]),
    }),
    new RumbleRacingSceneDesc("BL2", "CoalCuts", "Coal Cuts", {}),
    "Daytona",
    new RumbleRacingSceneDesc("DA1", "FlipOut", "Flip Out", {}),
    new RumbleRacingSceneDesc("DA2", "TheGauntlet", "The Gauntlet", {}),
    new RumbleRacingSceneDesc("DA3", "WildKingdom", "Wild Kingdom", {}),
    "Joke Tracks",
    new RumbleRacingSceneDesc("JT1", "CircusMinimus", "Circus Minimus", {
      textureIds: new Set([32, 1056]), // sky
    }),
    new RumbleRacingSceneDesc("JT2", "OuterLimits", "Outer Limits", {}),
    "Mountain Air",
    new RumbleRacingSceneDesc("MA1", "PassingThrough", "Passing Through", {}),
    new RumbleRacingSceneDesc("MA2", "FallsDown", "Falls Down", {
      textureIds: new Set([1584]),
    }),
    "Metropolis",
    new RumbleRacingSceneDesc("MP1", "TouchAndGo", "Touch And Go", {}),
    new RumbleRacingSceneDesc("MP2", "CarGo", "Car Go", {
      nodeIds: new Set([1408952]), // Some giant angled rectangle on the border of the map/submarine. Not sure what this is for.
    }),
    "Southern Exposure",
    new RumbleRacingSceneDesc("SE1", "TrueGrits", "True Grits", {
      nodeIds: new Set([
        // some weird box around the barn fence which uses texture 0,
        // but texture 0 is a legitimate texture so ignore the geometry
        7001320, 7004664,
        // weird geometry (potential shadow?) overlaying truck in gas station
        1957496,
      ]),
    }),
    new RumbleRacingSceneDesc("SE2", "OverEasy", "Over Easy", {}),
  ],
  hidden: !IS_DEVELOPMENT,
};
