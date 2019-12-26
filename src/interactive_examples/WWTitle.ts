
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { OrbitCameraController } from "../Camera";
import { TransparentBlack, colorCopy, White } from "../Color";
import * as JPA from '../Common/JSYSTEM/JPA';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { GfxRenderInstManager, executeOnPass } from "../gfx/render/GfxRenderer";
import { assertExists } from "../util";
import { SceneContext, SceneDesc } from "../SceneBase";
import { fillSceneParamsDataOnTemplate, ub_SceneParams, u_SceneParamsBufferSize, gxBindingLayouts, GXRenderHelperGfx } from "../gx/gx_render";
import { TextureMapping } from "../TextureHolder";
import { EFB_WIDTH, EFB_HEIGHT } from "../gx/gx_material";
import { captureScene } from "../CaptureHelpers";
import { makeZipFile, ZipFileEntry } from "../ZipFile";
import { downloadBuffer } from "../DownloadUtils";
import { J3DModelInstanceSimple, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { parse } from "../j3d/rarc";
import { decompressArbitraryFile } from "../Scenes_FileDrops";
import { BMD, BCK } from "../Common/JSYSTEM/J3D/J3DLoader";

function setTextureMappingIndirect(m: TextureMapping, sceneTexture: GfxTexture): void {
    m.gfxTexture = sceneTexture;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

class BasicEffectSystem {
    private emitterManager: JPA.JPAEmitterManager;
    private drawInfo = new JPA.JPADrawInfo();
    private jpacData: JPA.JPACData;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();

    private fbTextureNames = [
        'P_ms_fb_8x8i4',    // Super Mario Sunshine
        'AK_kagerouSwap00', // The Legend of Zelda: The Wind Waker
        'IndDummy',         // Super Mario Galaxy
    ];

    constructor(device: GfxDevice, private jpac: JPA.JPAC) {
        this.emitterManager = new JPA.JPAEmitterManager(device, 6000, 300);
        this.jpacData = new JPA.JPACData(this.jpac);
    }

    private findResourceData(userIndex: number): [JPA.JPACData, JPA.JPAResourceRaw] | null {
        const r = this.jpacData.jpac.effects.find((resource) => resource.resourceId === userIndex);
        if (r !== undefined)
            return [this.jpacData, r];

        return null;
    }

    public setOpaqueSceneTexture(opaqueSceneTexture: GfxTexture): void {
        for (let i = 0; i < this.fbTextureNames.length; i++) {
            const m = this.jpacData.getTextureMappingReference(this.fbTextureNames[i]);
            if (m !== null)
                setTextureMappingIndirect(m, opaqueSceneTexture);
        }
    }

    public resourceDataUsesFB(resourceData: JPA.JPAResourceData): boolean {
        for (let i = 0; i < resourceData.textureIds.length; i++) {
            const texID = resourceData.textureIds[i];
            const textureName = this.jpacData.jpac.textures[texID].texture.name;
            if (this.fbTextureNames.includes(textureName))
                return true;
        }

        return false;
    }

    private getResourceData(device: GfxDevice, cache: GfxRenderCache, userIndex: number): JPA.JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResourceData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const resData = new JPA.JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.prjMtx = prjMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime * 30/1000;
        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    public forceDeleteEmitter(emitter: JPA.JPABaseEmitter): void {
        this.emitterManager.forceDeleteEmitter(emitter);
    }

    public createBaseEmitter(device: GfxDevice, cache: GfxRenderCache, resourceId: number): JPA.JPABaseEmitter {
        const resData = assertExists(this.getResourceData(device, cache, resourceId));
        const emitter = this.emitterManager.createEmitter(resData)!;
        return emitter;
    }

    public destroy(device: GfxDevice): void {
        this.jpacData.destroy(device);
        this.emitterManager.destroy(device);
    }
}

function extend<T>(L: T[], L_: T[]): void {
    L.push.apply(L, L_);
}

const clearPass = makeClearRenderPassDescriptor(true, TransparentBlack);
export class ParticlesSceneRenderer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GfxRenderHelper;
    private effectSystem: BasicEffectSystem;
    private emitters: JPA.JPABaseEmitter[] = [];

    constructor(device: GfxDevice, private jpac: JPA.JPAC) {
        this.renderHelper = new GfxRenderHelper(device);
        this.effectSystem = new BasicEffectSystem(device, this.jpac);
    }

    public createCameraController() {
        const orbit = new OrbitCameraController();
        orbit.shouldOrbit = false;
        orbit.x = -Math.PI / 2;
        orbit.y = 2;
        orbit.z = -450;
        return orbit;
    }

    public createEmitter(device: GfxDevice, effectIndex: number): JPA.JPABaseEmitter {
        const resourceId = this.jpac.effects[effectIndex].resourceId;
        const newEmitter = this.effectSystem.createBaseEmitter(device, this.renderHelper.getCache(), resourceId);
        this.emitters.push(newEmitter);
        return newEmitter;
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        this.effectSystem.calc(viewerInput);

        const efTemplate = this.renderHelper.pushTemplateRenderInst();
        efTemplate.setBindingLayouts(gxBindingLayouts);
        efTemplate.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(efTemplate, viewerInput);

        {
            this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, null);
            this.effectSystem.draw(device, this.renderHelper.renderInstManager, 0);
        }

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, clearPass);
        executeOnPass(renderInstManager, device, mainPassRenderer, 0);

        renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    private async filmEmitter(device: GfxDevice, emitterIndex: number): Promise<ZipFileEntry[]> {
        for (let i = 0; i < this.emitters.length; i++) {
            const emitter = this.emitters[i];
            // Emitter might have died of natural causes.
            if (!!(emitter.flags & JPA.BaseEmitterFlags.TERMINATE))
                continue;
            this.effectSystem.forceDeleteEmitter(emitter);
        }
        this.emitters.length = 0;

        const newEmitter = this.createEmitter(device, emitterIndex);

        const width = 1920, height = 1080;
        const name = `Particle_${emitterIndex}`;
        const filez = await captureScene(window.main.viewer, {
            width, height,
            opaque: false,
            frameCount: 300,
            filenamePrefix: `${name}/${name}`,
            setupCallback: (viewer, t, i) => {
                viewer.updateDT(1000/60);
                newEmitter.globalTranslation[0] += 2;
                const dead = !!(newEmitter.flags & JPA.BaseEmitterFlags.TERMINATE);
                return !dead;
            },
        });

        return filez;
    }

    public async film(device: GfxDevice) {
        const filez: ZipFileEntry[] = [];
        // extend(filez, await this.filmEmitter(device, 0));
        // extend(filez, await this.filmEmitter(device, 1));
        extend(filez, await this.filmEmitter(device, 2));

        const zipFile = makeZipFile(filez);
        downloadBuffer('WWTitle.zip', zipFile);
    }

    public destroy(device: GfxDevice) {
        this.effectSystem.destroy(device);
    }
}

export class ShipSceneRenderer implements SceneGfx {
    private renderTarget = new BasicRenderTarget();
    private renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderHelper.getCache();
    }

    public createCameraController() {
        const orbit = new OrbitCameraController();
        orbit.shouldOrbit = false;
        orbit.x = -Math.PI;
        orbit.y = Math.PI / 2;
        orbit.z = -400;
        return orbit;
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        template.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, clearPass);
        executeOnPass(renderInstManager, device, mainPassRenderer, 1);

        renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public async film() {
        const width = 1920, height = 1080;
        const name = `Ship`;
        const filez = await captureScene(window.main.viewer, {
            width, height,
            opaque: false,
            frameCount: 300,
            filenamePrefix: `${name}/${name}`,
            setupCallback: (viewer, t, i) => {
                viewer.updateDT(1000/60);
                return true;
            },
        });

        const zipFile = makeZipFile(filez);
        downloadBuffer('WWTitle_Ship.zip', zipFile);
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

export class WWTitle implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const jpc = await context.dataFetcher.fetchData(`j3d/ww/Particle/Pscene001.jpc`);
        const jpac = JPA.parse(jpc);
        const r = new ParticlesSceneRenderer(device, jpac);
        r.film(device);
        return r;

        /*
        const arcData = await context.dataFetcher.fetchData(`j3d/ww/Object/TlogoE.arc`);
        const arc = parse(await decompressArbitraryFile(arcData));
        const r = new ShipSceneRenderer(device);
        const mdlData = new J3DModelData(device, r.getCache(), BMD.parse(arc.findFileData(`bdlm/title_ship.bdl`)!));
        const mdlInstance = new J3DModelInstanceSimple(mdlData);
        mdlInstance.modelMatrix[13] = -100;
        mdlInstance.bindANK1(BCK.parse(arc.findFileData(`bck/title_ship.bck`)!));
        const light = mdlInstance.getGXLightReference(0);
        colorCopy(light.Color, White);
        vec3.set(light.Position, -35000, 0, -(-30000));
        r.modelInstances.push(mdlInstance);
        r.film();
        return r;
        */
    }
}
