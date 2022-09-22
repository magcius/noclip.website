
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as RARC from '../Common/JSYSTEM/JKRArchive';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assert, assertExists } from '../util';

import { J3DModelData, J3DModelMaterialData, J3DModelInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple';
import * as JPA from '../Common/JSYSTEM/JPA';
import { lightSetWorldPosition, EFB_WIDTH, EFB_HEIGHT, Light } from '../gx/gx_material';
import { mat4, quat, vec3 } from 'gl-matrix';
import { LoopMode, BMD, BMT, BCK, BPK, BTP, BTK, BRK } from '../Common/JSYSTEM/J3D/J3DLoader';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { colorFromRGBA, colorNewCopy, OpaqueBlack } from '../Color';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext, Destroyable } from '../SceneBase';
import { createModelInstance } from './scenes';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { executeOnPass, hasAnyVisible } from '../gfx/render/GfxRenderInstManager';
import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers';
import { Camera } from '../Camera';
import { transformVec3Mat4w1 } from '../MathHelpers';

const sjisDecoder = new TextDecoder('sjis')!;

function unpack(buffer: ArrayBufferSlice, sig: string): any[] {
    const view = buffer.createDataView();
    const result: any[] = [];
    let offs = 0;
    let allowExtra = false;
    for (let i = 0; i < sig.length; i++) {
        switch (sig[i]) {
        case 'B':
            result.push(view.getUint8(offs));
            offs += 0x01;
            break;
        case 'I':
            result.push(view.getUint32(offs));
            offs += 0x04;
            break;
        case 'i':
            result.push(view.getInt32(offs));
            offs += 0x04;
            break;
        case 'f':
            result.push(view.getFloat32(offs));
            offs += 0x04;
            break;
        case 's':
            const size = view.getUint16(offs);
            offs += 0x02;
            result.push(readString(buffer, offs, size, false));
            offs += size;
            break;
        case '.':
            allowExtra = true;
            break;
        case ' ':
            break;
        default:
            assert(false);
        }
    }

    if (!allowExtra) {
        assert(buffer.byteLength === offs);
    }

    return [offs, ...result];
}

interface SceneBinObjBase {
    klass: string;
    name: string;
    size: number;
}

interface SceneBinObjUnk extends SceneBinObjBase {
    type: 'Unknown';
}

interface SceneBinObjAmbColor extends SceneBinObjBase {
    type: 'AmbColor';
    klass: 'AmbColor';
    r: number;
    g: number;
    b: number;
    a: number;
}

interface SceneBinObjLight extends SceneBinObjBase {
    type: 'Light';
    klass: 'Light';
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    a: number;
    intensity: number;
}

interface SceneBinObjMapObj extends SceneBinObjBase {
    type: 'MapObj';
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    manager: string;
    model: string;
}

interface SceneBinObjStaticObj extends SceneBinObjBase {
    type: 'StaticObj';
    x: number;
    y: number;
    z: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    manager: string;
    model: string;
}

interface SceneBinObjGroup extends SceneBinObjBase {
    type: 'Group';
    klass: 'GroupObj' | 'Strategy' | 'AmbAry' | 'LightAry' | 'MarScene' | 'IdxGroup';
    children: SceneBinObj[];
}

type SceneBinObj = SceneBinObjGroup | SceneBinObjAmbColor | SceneBinObjLight | SceneBinObjMapObj | SceneBinObjStaticObj | SceneBinObjUnk;

function readSceneBin(buffer: ArrayBufferSlice): SceneBinObj {
    let offs = 0x00;
    const view_ = buffer.createDataView();
    const size = view_.getUint32(offs + 0x00);
    const view = buffer.createDataView(0x00, size);
    offs += 0x04;
    const klassHash = view.getUint16(offs + 0x00);
    const klassSize = view.getUint16(offs + 0x02);
    offs += 0x04;
    const klass = readString(buffer, offs, klassSize, false);
    offs += klassSize;
    const nameHash = view.getUint16(offs + 0x00);
    const nameSize = view.getUint16(offs + 0x02);
    offs += 0x04;
    const name = sjisDecoder.decode(buffer.createTypedArray(Uint8Array, offs, nameSize));
    offs += nameSize;

    function readChildren(numChildren: number): SceneBinObj[] {
        const children = [];
        while (numChildren--) {
            const child = readSceneBin(buffer.slice(offs));
            children.push(child);
            offs += child.size;
        }
        return children;
    }

    const params = buffer.slice(offs, size);

    switch (klass) {
    case 'GroupObj':
    case 'LightAry':
    case 'Strategy':
    case 'AmbAry':
    {
        const [paramsSize, numChildren] = unpack(params, 'I.');
        offs += paramsSize;
        const children = readChildren(numChildren);
        return { type: 'Group', klass, name, size, children };
    }
    case 'IdxGroup':
    case 'MarScene':
    {
        const [paramsSize, groupId, numChildren] = unpack(params, 'II.');
        offs += paramsSize;
        const children = readChildren(numChildren);
        return { type: 'Group', klass, name, size, children };
    }
    case 'AmbColor':
    {
        const [paramsSize, r, g, b, a] = unpack(params, 'BBBB');
        return { type: 'AmbColor', klass, name, size, r, g, b, a };
    }
    case 'Light':
    {
        const [paramsSize, x, y, z, r, g, b, a, intensity] = unpack(params, 'fffBBBBf');
        return { type: 'Light', klass, name, size, x, y, z, r, g, b, a, intensity };
    }
    case 'MapStaticObj':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s.');
        return { type: 'StaticObj', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    case 'AirportPool':
    case 'AirportSwitch':
    case 'AmiKing':
    case 'back_nozzle_item':
    case 'BalloonKoopaJr':
    case 'bambooFence_revolve_inner':
    case 'BananaTree':
    case 'BasketReverse':
    case 'Bathtub':
    case 'BellDolpicPolice':
    case 'BellDolpicTV':
    case 'BellWatermill':
    case 'BiaBell':
    case 'BiaTurnBridge':
    case 'BiaWatermill':
    case 'BiaWatermillVertical':
    case 'BigWindmill':
    case 'bigWindmillBlock':
    case 'Billboard':
    case 'breakable_block':
    case 'BreakableBlock':
    case 'BrickBlock':
    case 'CasinoPanelGate':
    case 'CasinoRoulette':
    case 'Castella':
    case 'ChangeStage':
    case 'ChangeStageMerrygoround':
    case 'ChestRevolve':
    case 'Closet':
    case 'Cogwheel':
    case 'cogwheel_plate':
    case 'cogwheel_pot':
    case 'Coin':
    case 'coin_blue':
    case 'CoinBlue':
    case 'CoinFish':
    case 'coin_red':
    case 'CoinRed':
    case 'CoverFruit':
    case 'crane_cargo':
    case 'craneCargoUpDown':
    case 'CraneRotY':
    case 'craneUpDown':
    case 'DemoCannon':
    case 'DolWeathercock':
    case 'Donchou':
    case 'Door':
    case 'DptMonteFence':
    case 'EggYoshi':
    case 'EXKickBoard':
    case 'EXRollCube':
    case 'Fence':
    case 'FenceInner':
    case 'FenceRevolve':
    case 'fence_revolve_inner':
    case 'FenceWaterH':
    case 'FenceWaterV':
    case 'FerrisGondola':
    case 'FerrisWheel':
    case 'FileLoadBlockA':
    case 'FileLoadBlockB':
    case 'FileLoadBlockC':
    case 'FlowerCoin':
    case 'FluffManager':
    case 'Football':
    case 'Fruit':
    case 'FruitBanana':
    case 'FruitBasket':
    case 'FruitBasketEvent':
    case 'FruitDurian':
    case 'FruitHitHideObj':
    case 'FruitPapaya':
    case 'FruitPine':
    case 'FruitTree':
    case 'GateManta':
    case 'GateShell':
    case 'GesoSurfBoard':
    case 'GetaGreen':
    case 'GetaOrange':
    case 'GlassBreak':
    case 'GoalFlag':
    case 'GoalWatermelon':
    case 'HangingBridgeBoard':
    case 'HideObj':
    case 'Hikidashi':
    case 'HipDropHideObj':
    case 'IceBlock':
    case 'IceCar':
    case 'Item':
    case 'ItemNozzle':
    case 'ItemSlotDrum':
    case 'joint_coin':
    case 'JuiceBlock':
    case 'JumpBase':
    case 'JumpMushroom':
    case 'Kamaboko':
    case 'LampSeesaw':
    case 'LampSeesawMain':
    case 'LampTrapIron':
    case 'LampTrapSpike':
    case 'LeafBoat':
    case 'LeafBoatRotten':
    case 'lean_block':
    case 'LeanMirror':
    case 'MammaBlockRotate':
    case 'MammaSurfboard':
    case 'MammaYacht':
    case 'Manhole':
    case 'MapObjBase':
    case 'MapObjChangeStage':
    case 'MapObjChangeStageHipDrop':
    case 'MapObjElasticCode':
    case 'MapObjFloatOnSea':
    case 'MapObjGeneral':
    case 'MapObjGrowTree':
    case 'MapObjNail':
    case 'MapObjRootPakkun':
    case 'MapObjSmoke':
    case 'MapObjStartDemo':
    case 'MapObjSteam':
    case 'MapObjSwitch':
    case 'MapObjTreeScale':
    case 'MapObjWaterSpray':
    case 'MareCork':
    case 'MareEventBumpyWall':
    case 'MareFall':
    case 'maregate':
    case 'MareGate':
    case 'merry_egg':
    case 'Merrygoround':
    case 'merry_pole':
    case 'MiniWindmill':
    case 'MonteRoot':
    case 'MonumentShine':
    case 'MuddyBoat':
    case 'Mushroom1up':
    case 'mushroom1up':
    case 'Mushroom1upR':
    case 'mushroom1upR':
    case 'mushroom1upX':
    case 'Mushroom1upX':
    case 'no_data':
    case 'NormalBlock':
    case 'NormalLift':
    case 'normal_nozzle_item':
    case 'NozzleBox':
    case 'Palm':
    case 'PalmNatume':
    case 'PalmOugi':
    case 'PalmSago':
    case 'PanelBreak':
    case 'PanelRevolve':
    case 'PictureTeresa':
    case 'PinnaCoaster':
    case 'PinnaDoor':
    case 'PinnaDoorOpen':
    case 'PinnaHangingBridgeBoard':
    case 'PolluterBase':
    case 'Pool':
    case 'PosterTeresa':
    case 'Puncher':
    case 'RailBlock':
    case 'RailBlockB':
    case 'RailBlockR':
    case 'RailBlockY':
    case 'RailFence':
    case 'RandomFruit':
    case 'RedCoinSwitch':
    case 'ResetFruit':
    case 'RiccoLog':
    case 'RiccoSwitch':
    case 'RiccoSwitchShine':
    case 'riccoWatermill':
    case 'RideCloud':
    case 'rocket_nozzle_item':
    case 'RollBlock':
    case 'RollBlockB':
    case 'RollBlockR':
    case 'RollBlockY':
    case 'Roulette':
    case 'SakuCasino':
    case 'SandBird':
    case 'SandBirdBlock':
    case 'sand_bird_test':
    case 'SandBlock':
    case 'SandBomb':
    case 'SandBombBase':
    case 'SandCastle':
    case 'SandEgg':
    case 'SandLeaf':
    case 'SandLeafBase':
    case 'Shine':
    case 'SirenabossWall':
    case 'SirenaCasinoRoof':
    case 'SirenaGate':
    case 'SlotDrum':
    case 'submarine':
    case 'SuperHipDropBlock':
    case 'SurfGesoGreen':
    case 'SurfGesoRed':
    case 'SurfGesoYellow':
    case 'SwingBoard':
    case 'TelesaBlock':
    case 'TelesaSlot':
    case 'TurboNozzleDoor':
    case 'Uirou':
    case 'Umaibou':
    case 'Viking':
    case 'WaterHitHideObj':
    case 'WaterHitPictureHideObj':
    case 'WaterMelon':
    case 'WatermelonBlock':
    case 'WatermelonStatic':
    case 'WaterMoveBlock': // appears in test11, not actually implemented in game
    case 'WaterRecoverObj':
    case 'WindmillRoof':
    case 'WireBell':
    case 'WoodBarrel':
    case 'WoodBlock':
    case 'WoodBox':
    case 'YoshiBlock':
    case 'yoshi_whistle_item':
    {
        const [paramsSize, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, flags, model] = unpack(params, 'ffffff fffsi s.');
        return { type: 'MapObj', klass, name, size, x, y, z, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ, manager, model };
    }
    default:
        let warnUnknown = true;

        // Managers are internal.
        if (klass.endsWith('Manager') || klass.endsWith('Mgr'))
            warnUnknown = false;
        // Cube maps...
        if (klass.startsWith('Cube'))
            warnUnknown = false;

        if (warnUnknown)
            console.warn(`Unknown object class ${klassHash} ${klass}, size ${size}`);

        return { type: 'Unknown', klass, name, size };
    }
}

export const enum SMSPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    TRANSPARENT = 1 << 3,
}

class LightConfig {
    public lightObj: SceneBinObjLight[] = [];

    private LARGE_NUMBER = -1048576.0;
    private initSpecularDir(lit: Light, nx: number, ny: number, nz: number) {
        // Compute half-angle vector
        const hx = -nx, hy = -ny, hz = -(nz - 1.0);
        vec3.set(lit.Direction, hx, hy, hz);
        vec3.normalize(lit.Direction, lit.Direction);

        const px  = (nx * this.LARGE_NUMBER);
        const py  = (ny * this.LARGE_NUMBER);
        const pz  = (nz * this.LARGE_NUMBER);
        
        vec3.set(lit.Position, px, py, pz);
    }
    private scratchVec3 = vec3.create();

    public setOnModelInstance(modelInstance: J3DModelInstance, camera: Camera): void {
        const diffSrc = this.lightObj[0];
        const diffDst = modelInstance.getGXLightReference(0);
        lightSetWorldPosition(diffDst, camera, diffSrc.x, diffSrc.y, diffSrc.z);
        colorFromRGBA(diffDst.Color, diffSrc.r/0xFF, diffSrc.g/0xFF, diffSrc.b/0xFF, diffSrc.a/0xFF);
        vec3.set(diffDst.CosAtten, 1.0, 0.0, 0.0);
        vec3.set(diffDst.DistAtten, 1.0, 0.0, 0.0);
        
        const specSrc = this.lightObj[2];
        const specDst = modelInstance.getGXLightReference(2);
        const v = this.scratchVec3;
        vec3.set(v, specSrc.x, specSrc.y, specSrc.z);
        transformVec3Mat4w1(v, camera.viewMatrix, v);
        vec3.normalize(v, v);
        this.initSpecularDir(specDst, -v[0], -v[1], -v[2]);
        colorFromRGBA(specDst.Color, specSrc.r/0xFF, specSrc.g/0xFF, specSrc.b/0xFF, specSrc.a/0xFF);
        vec3.set(specDst.CosAtten, 0.0, 0.0, 1.0);
        vec3.set(specDst.DistAtten, 0.5*specSrc.intensity, 0.0, 1.0 - 0.5*specSrc.intensity);
    }
}

export class SunshineRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];
    public destroyables: Destroyable[] = [];
    public modelCache = new Map<RARC.RARCFile, J3DModelData>();
    public effectsCache = new Map<RARC.RARCFile, JPA.JPACData>();
    private clearDescriptor = makeAttachmentClearDescriptor(colorNewCopy(OpaqueBlack));

    public objLightConfig: LightConfig | null = null;

    constructor(device: GfxDevice, public rarc: RARC.JKRArchive) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    private setIndirectTextureOverride(device: GfxDevice): void {
        for (let i = 0; i < this.modelInstances.length; i++) {
            // In options.szs, the seaindirect appears to have more than one sampler named "indirectdummy". WTF?
            const samplers = this.modelInstances[i].tex1Data.tex1.samplers;
            for (let j = 0; j < samplers.length; j++) {
                const m = this.modelInstances[i].materialInstanceState.textureMappings[j];
                if (samplers[j].name === "indirectdummy") {
                    m.lateBinding = 'opaque-scene-texture';
                    m.width = EFB_WIDTH;
                    m.height = EFB_HEIGHT;
                    m.flipY = gfxDeviceNeedsFlipY(device);
                }
            }
        }
    }
    
    private LARGE_NUMBER = -1048576.0;
    private initSpecularDir(lit: Light, nx: number, ny: number, nz: number) {
        // Compute half-angle vector
        const hx = -nx, hy = -ny, hz = -(nz - 1.0);
        vec3.set(lit.Direction, hx, hy, hz);
        vec3.normalize(lit.Direction, lit.Direction);

        const px  = (nx * this.LARGE_NUMBER);
        const py  = (ny * this.LARGE_NUMBER);
        const pz  = (nz * this.LARGE_NUMBER);
        
        vec3.set(lit.Position, px, py, pz);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        if (this.objLightConfig !== null)
            for (let i = 0; i < this.modelInstances.length; i++)
                this.objLightConfig.setOnModelInstance(this.modelInstances[i], viewerInput.camera);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.setIndirectTextureOverride(device);
        this.prepareToRender(device, viewerInput);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, passRenderer, SMSPass.SKYBOX);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, passRenderer, SMSPass.OPAQUE);
            });
        });

        if (hasAnyVisible(renderInstManager, SMSPass.INDIRECT)) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    renderInstManager.setVisibleByFilterKeyExact(SMSPass.INDIRECT);
                    renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null, lateBinding: null });
                    renderInstManager.drawOnPassRenderer(passRenderer);
                });
            });
        }

        builder.pushPass((pass) => {
            pass.setDebugName('Transparent');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, passRenderer, SMSPass.TRANSPARENT);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy();
        this.destroyables.forEach((o) => o.destroy(device));
        this.modelInstances.forEach((instance) => instance.destroy(device));
        for (const v of this.modelCache.values())
            v.destroy(device);
    }
}
        

export class SunshineSceneDesc implements Viewer.SceneDesc {
    private ambAry: SceneBinObjGroup;
    private playerAmbIndex = -1;
    private objectsAmbIndex = -1;
    
    public static createSunshineSceneForBasename(device: GfxDevice, cache: GfxRenderCache, passMask: number, rarc: RARC.JKRArchive, basename: string, isSkybox: boolean): J3DModelInstanceSimple | null {
        const bmdFile = rarc.findFile(`${basename}.bmd`);
        if (!bmdFile)
            return null;
        const btkFile = rarc.findFile(`${basename}.btk`);
        const brkFile = rarc.findFile(`${basename}.brk`);
        const bckFile = rarc.findFile(`${basename}.bck`);
        const bmtFile = rarc.findFile(`${basename}.bmt`);
        const modelInstance = createModelInstance(device, cache, bmdFile, btkFile, brkFile, bckFile, bmtFile);
        modelInstance.name = basename;
        modelInstance.isSkybox = isSkybox;
        modelInstance.passMask = passMask;
        return modelInstance;
    }

    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const pathBase = `j3d/sms`;
        const path = `${pathBase}/${this.id}.szs`;
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(path).then((result: ArrayBufferSlice) => {
            return Yaz0.decompress(result);
        }).then((buffer: ArrayBufferSlice) => {
            const rarc = RARC.parse(buffer);

            const sceneBinObj = readSceneBin(rarc.findFileData('map/scene.bin')!);
            console.log(rarc, sceneBinObj);

            const renderer = new SunshineRenderer(device, rarc);

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.SKYBOX, rarc, 'map/map/sky', true);
            if (skyScene !== null)
                renderer.modelInstances.push(skyScene);
            const mapScene = SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.OPAQUE, rarc, 'map/map/map', false);
            if (mapScene !== null)
                renderer.modelInstances.push(mapScene);
            const seaScene = SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.OPAQUE, rarc, 'map/map/sea', false);
            if (seaScene !== null)
                renderer.modelInstances.push(seaScene);
            const seaIndirectScene = SunshineSceneDesc.createSunshineSceneForBasename(device, cache, SMSPass.INDIRECT, rarc, 'map/map/seaindirect', false);
            if (seaIndirectScene !== null)
                renderer.modelInstances.push(seaIndirectScene);

            this.createSceneBinObjects(device, cache, renderer, rarc, sceneBinObj);
            
            for (let i = 0; i < renderer.modelInstances.length; i++) {
                this.setUpAmbientLight(renderer.modelInstances[i]);
            }
            
            return renderer;
        });
    }

    private createSceneBinObjects(device: GfxDevice, cache: GfxRenderCache, renderer: SunshineRenderer, rarc: RARC.JKRArchive, obj: SceneBinObj): void {
        if (obj.type === 'Group') {
            obj.children.forEach(c => this.createSceneBinObjects(device, cache, renderer, rarc, c));
            if (obj.klass === 'LightAry') {
                renderer.objLightConfig = new LightConfig();
                renderer.objLightConfig.lightObj[0] = assertExists(obj.children.find((light) => light.name === "太陽（オブジェクト）")) as SceneBinObjLight;
                renderer.objLightConfig.lightObj[1] = assertExists(obj.children.find((light) => light.name === "太陽サブ（オブジェクト）")) as SceneBinObjLight;
                renderer.objLightConfig.lightObj[2] = assertExists(obj.children.find((light) => light.name === "太陽スペキュラ（オブジェクト）")) as SceneBinObjLight;
            } else if (obj.klass === 'AmbAry') {
                this.ambAry = obj;
                this.objectsAmbIndex = obj.children.findIndex((ambColor) => ambColor.name === "太陽アンビエント（オブジェクト）");
                this.playerAmbIndex = obj.children.findIndex((ambColor) => ambColor.name === "太陽アンビエント（プレイヤー）");
            }
        } else if (obj.type === 'MapObj') {
            this.createRendererForSceneBinMapObj(device, cache, renderer, rarc, obj);
        } else if (obj.type === 'StaticObj') {
            this.createRendererForSceneBinStaticObj(device, cache, renderer, rarc, obj);
        }
    }
    
    private setUpAmbientLight(modelInstance: J3DModelInstanceSimple) {
        if (this.objectsAmbIndex !== -1 && modelInstance.modelMaterialData.materialData !== null) {
            const ambColor = this.ambAry.children[this.objectsAmbIndex] as SceneBinObjAmbColor;
            modelInstance.modelMaterialData.materialData.forEach(matData => colorFromRGBA(matData.material.colorAmbRegs[0], ambColor.r/255, ambColor.g/255, ambColor.b/255, ambColor.a/255));
         }
     }

    private createRendererForSceneBinMapObj(device: GfxDevice, cache: GfxRenderCache, renderer: SunshineRenderer, rarc: RARC.JKRArchive, obj: SceneBinObjMapObj): J3DModelInstanceSimple | null {
        interface ModelLookup {
            k: string; // model key
            m?: string; // model name
            t?: string; // material
            n?: string; // animation
            u?: number; // animation type
        };

        const modelCache = renderer.modelCache;
        function lookupModel(bmdFile: RARC.RARCFile): J3DModelData {
            assert(!!bmdFile);
            if (modelCache.has(bmdFile)) {
                return modelCache.get(bmdFile)!;
            } else {
                const bmd = BMD.parse(bmdFile.buffer);
                const bmdModel = new J3DModelData(device, cache, bmd);
                modelCache.set(bmdFile, bmdModel);
                return bmdModel;
            }
        }
        
        const modelLookup: ModelLookup[] = [
{ k: 'AirportPole' },
{ k: 'amiking', m: 'amiking_model1.bmd' },
{ k: 'ArrowBoardDown', t: 'ArrowBoard'},
{ k: 'ArrowBoardLR', t: 'ArrowBoard'},
{ k: 'ArrowBoardUp', t: 'ArrowBoard'},
{ k: 'balloonKoopaJr', m: 'balloonKoopaJr.bmd', n: 'balloonkoopajr_wait', u: 0 },
{ k: 'baloonball', m: 'soccerball.bmd' },
{ k: 'bambooRailFence', m: 'bambooFence_rail.bmd' },
{ k: 'BananaTree', m: 'BananaTree.bmd' },
{ k: 'barrel_oil', m: 'barrel_oil.bmd' },
{ k: 'BasketReverse', m: 'Basket.bmd' },
{ k: 'bath', m: 'bath.bmd' },
{ k: 'belldolpic', m: 'BellDolpic.bmd' },
{ k: 'BiaBell', m: 'BiaBell.bmd' },
{ k: 'BiaWatermill00', m: 'BiaWatermill00.bmd' },
{ k: 'bigWindmill', t: 'bianco', m: 'bigWindmill.bmd' },
{ k: 'billboard_dolphin', m: 'billboardDol.bmd' },
{ k: 'billboard_fish', m: 'billboardFish.bmd' },
{ k: 'billboard_restaurant', m: 'billboardRestaurant.bmd' },
{ k: 'billboard_sun', m: 'billboardSun.bmd' },
{ k: 'breakable_block', m: 'breakable_block.bmd' },
{ k: 'BrickBlock', t: 'BrickBlock', m: 'BrickBlock.bmd' },
{ k: 'castella', m: 'castella.bmd' },
{ k: 'ChangeStage' },
{ k: 'ChangeStageMerrygoround' },
{ k: 'ChestRevolve', m: 'ChestRevolve.bmd' },
{ k: 'ChipShine', m: 'chip_shine_model1.bmd' },
{ k: 'Closet', m: 'closet.bmd', n: 'ClosetOpen', u: 0 },
{ k: 'cloud', m: 'cloud.bmd', n: 'cloud_wait', u: 0 },
{ k: 'cluster_block', m: 'test_cluster.bmd' },
{ k: 'coconut_ball', m: 'soccerball.bmd' },
{ k: 'cogwheel', m: 'cogwheel_wheel.bmd' },
{ k: 'CoinFish', m: 'CoinFish.bmd', n: 'coinfish', u: 0 },
{ k: 'DokanGate', m: 'efDokanGate.bmd', n: 'efdokangate', u: 4 },
{ k: 'doorHotel', m: 'doorHotel.bmd' },
{ k: 'dptlight', m: 'dptlight.bmd' },
{ k: 'dptWeathercock', m: 'DptWeathercock.bmd', n: 'dptweathercock', u: 0 },
{ k: 'drum_can', m: 'drum_can_model.bmd' },
{ k: 'eggYoshiEvent', m: 'eggYoshi_normal.bmd', n: 'eggyoshi_wait', u: 0 },
{ k: 'eggYoshi', m: 'eggYoshi_normal.bmd', n: 'eggyoshi_wait', u: 0 },
{ k: 'ex1_turn_lift', m: 'TurnLift.bmd' },
{ k: 'exkickboard', m: 'EXKickBoard.bmd' },
{ k: 'expand_block', m: 'breakable_block.bmd' },
{ k: 'exrollcube', m: 'EXRollCube.bmd' },
{ k: 'fall_slow_block', m: 'breakable_block.bmd' },
{ k: 'fence3x3', m: 'fence_half.bmd' },
{ k: 'fence_revolve', m: 'fence_revolve_outer.bmd' },
{ k: 'FerrisLOD', m: 'FerrisLOD.bmd', n: 'ferrislod', u: 0 },
{ k: 'FerrisWheel', m: 'FerrisWheel.bmd', n: 'ferriswheel', u: 0 },
{ k: 'FileLoadBlockA', m: 'FileLoadBlockA.bmd' },
{ k: 'FileLoadBlockB', m: 'FileLoadBlockB.bmd' },
{ k: 'FileLoadBlockC', m: 'FileLoadBlockC.bmd' },
{ k: 'flowerOrange', t: 'flower', m: 'flowerOrange.bmd' },
{ k: 'flowerPink', t: 'flower', m: 'flowerPink.bmd' },
{ k: 'flowerPurple', t: 'flower', m: 'flowerPurple.bmd' },
{ k: 'flowerRed', t: 'flower', m: 'flowerRed.bmd' },
{ k: 'flowerSunflower', t: 'flower', m: 'flowerSunflower.bmd' },
{ k: 'flowerYellow', t: 'flower', m: 'flowerYellow.bmd' },
{ k: 'FluffManager' },
{ k: 'Fluff', m: 'Watage.bmd' },
{ k: 'football_goal', m: 'soccergoal_model.bmd' },
{ k: 'football', m: 'soccerball.bmd' },
{ k: 'FruitBasket', m: 'Basket.bmd' },
{ k: 'FruitCoverPine', m: 'FruitPine.bmd' },
{ k: 'FruitHitHideObj' },
{ k: 'GateManta', m: 'GateManta.bmd', n: 'gatemanta', u: 0 },
{ k: 'Gateshell', m: 'Gateshell.bmd', n: 'gateshell', u: 0 },
{ k: 'GeneralHitObj' },
{ k: 'GesoSurfBoard', m: 'surf_geso.bmd' },
{ k: 'GesoSurfBoardStatic', m: 'surf_geso.bmd' },
{ k: 'getag', m: 'getaGreen.bmd' },
{ k: 'getao', m: 'getaOrange.bmd' },
{ k: 'GlassBreak', m: 'GlassBreak.bmd' },
{ k: 'GoalWatermelon' },
{ k: 'HangingBridge' },
{ k: 'HangingBridgeBoard', m: 'mon_bri.bmd' },
{ k: 'HatoPop', m: 'hatopop_model1.bmd' },
{ k: 'HideObj' },
{ k: 'hikidashi', m: 'hikidashi.bmd' },
{ k: 'HipDropHideObj' },
{ k: 'ice_car', m: 'yatai.bmd' },
{ k: 'invisible_coin' },
{ k: 'joint_coin', m: 'coin.bmd' },
{ k: 'jumpbase', m: 'jumpbase.bmd' },
{ k: 'JumpMushroom', m: 'JumpKinoko.bmd' },
{ k: 'kamaboko', m: 'kamaboko.bmd' },
{ k: 'KoopaJrSignM', m: 'koopa_jr_sign.bmd' },
{ k: 'lampBianco', m: 'lampBianco.bmd' },
{ k: 'LampSeesaw', m: 'lampBianco.bmd' },
{ k: 'lamptrapiron', m: 'lamptrapiron.bmd' },
{ k: 'lamptrapspike', m: 'lamptrapspike.bmd' },
{ k: 'LeafBoatRotten', t: 'LeafBoat'},
{ k: 'LeafBoat', t: 'LeafBoat'},
{ k: 'lean_block', m: 'breakable_block.bmd' },
{ k: 'lean_direct_block', m: 'breakable_block.bmd' },
{ k: 'lean_indirect_block', m: 'breakable_block.bmd' },
{ k: 'manhole', m: 'manhole.bmd', n: 'manhole', u: 0 },
{ k: 'MapObjNail', m: 'kugi.bmd' },
{ k: 'MapObjPachinkoNail', m: 'PachinkoKugi.bmd' },
{ k: 'MapSmoke' },
{ k: 'MareEventBumpyWall' },
{ k: 'mareFall', m: 'MareFall.bmd', n: 'marefall', u: 4 },
{ k: 'maregate', m: 'maregate.bmd', n: 'maregate', u: 4 },
{ k: 'mario_cap', m: 'mariocap.bmd' },
{ k: 'merry', m: 'merry.bmd', n: 'merry', u: 0 },
{ k: 'merry_pole' },
{ k: 'MiniWindmillL', t: 'bianco'},
{ k: 'MiniWindmillS', t: 'bianco'},
{ k: 'monte_chair', m: 'monte_chair_model.bmd' },
{ k: 'MonteGoalFlag', m: 'monteflag.bmd', n: 'monteflag_wait', u: 0 },
{ k: 'MonteRoot', m: 'nekko.bmd' },
{ k: 'monumentshine', m: 'monumentshine.bmd' },
{ k: 'move_block', m: 'breakable_block.bmd' },
{ k: 'MoveCoin', m: 'SandMoveCoin.bmd', n: 'sandmovecoin', u: 0 },
{ k: 'Moyasi', m: 'Moyasi.bmd', n: 'moyasi_wait', u: 0 },
{ k: 'MuddyBoat', m: 'MuddyBoat.bmd' },
{ k: 'mushroom1up', m: 'mushroom1up.bmd' },
{ k: 'mushroom1upR', m: 'mushroom1up.bmd' },
{ k: 'mushroom1upX', m: 'mushroom1up.bmd' },
{ k: 'no_data' },
{ k: 'normallift', m: 'NormalBlock.bmd' },
{ k: 'normal_nozzle_item', t: 'nozzleItem'},
{ k: 'NozzleBox', t: 'nozzleBox', m: 'nozzleBox.bmd' },
{ k: 'nozzleDoor', m: 'nozzleDoor.bmd' },
{ k: 'palmLeaf', m: 'palmLeaf.bmd' },
{ k: 'palmNormal', m: 'palmNormal.bmd' },
{ k: 'PanelBreak', m: 'PanelBreak.bmd' },
{ k: 'PanelRevolve', m: 'PanelRevolve.bmd' },
{ k: 'PinnaHangingBridgeBoard', m: 'PinnaBoard.bmd' },
{ k: 'PoleNormal' },
{ k: 'Puncher', m: 'puncher_model1.bmd' },
{ k: 'railblockb', m: 'AllPurposeBoardB.bmd' },
{ k: 'railblockr', m: 'AllPurposeBoardR.bmd' },
{ k: 'railblocky', m: 'AllPurposeBoardY.bmd' },
{ k: 'RailFence', m: 'fence_normal.bmd' },
{ k: 'riccoBoatL', t: 'riccoShip'},
{ k: 'riccoBoatS', t: 'riccoShip'},
{ k: 'riccoPole' },
{ k: 'riccoShipDol', t: 'riccoShip'},
{ k: 'riccoShipLog', t: 'riccoShip'},
{ k: 'riccoShip', t: 'riccoShip'},
{ k: 'riccoSwitchShine' },
{ k: 'riccoYachtL', t: 'riccoShip'},
{ k: 'riccoYachtS', t: 'riccoShip'},
{ k: 'rollblockb', m: 'AllPurposeBoardB.bmd' },
{ k: 'rollblockr', m: 'AllPurposeBoardR.bmd' },
{ k: 'rollblocky', m: 'AllPurposeBoardY.bmd' },
{ k: 'rulet00', m: 'rulet00.bmd', n: 'rulet00', u: 0 },
{ k: 'SandBird', m: 'SandBird.bmd', n: 'sandbird', u: 0 },
{ k: 'sand_block', m: 'SandBlock.bmd' },
{ k: 'SandBombBase00', t: 'SandBombBase', m: 'SandBombBase00.bmd' },
{ k: 'SandBombBaseFoot', t: 'SandBombBase', m: 'SandBombBaseFoot.bmd' },
{ k: 'SandBombBaseHand', t: 'SandBombBase', m: 'SandBombBaseHand.bmd' },
{ k: 'SandBombBaseMushroom', t: 'SandBombBase', m: 'SandBombBaseMushroom.bmd' },
{ k: 'SandBombBasePyramid', t: 'SandBombBase', m: 'SandBombBasePyramid.bmd' },
{ k: 'SandBombBaseShit', t: 'SandBombBase', m: 'SandBombBaseShit.bmd' },
{ k: 'SandBombBaseStairs', t: 'SandBombBase', m: 'SandBombBaseStairs.bmd' },
{ k: 'SandBombBaseStar', t: 'SandBombBase', m: 'SandBombBaseStar.bmd' },
{ k: 'SandBombBaseTurtle', t: 'SandBombBase', m: 'SandBombBaseTurtle.bmd' },
{ k: 'SandBomb', m: 'SandBomb.bmd', n: 'sandbomb_wait', u: 0 },
{ k: 'SandCastle', t: 'SandBombBase', m: 'SandCastle.bmd' },
{ k: 'SandLeafBase00', m: 'SandLeafBase00.bmd' },
{ k: 'SandLeafBase01', m: 'SandLeafBase01.bmd' },
{ k: 'SandLeafBase02', m: 'SandLeafBase02.bmd' },
{ k: 'SandLeafBase03', m: 'SandLeafBase03.bmd' },
{ k: 'SandLeaf', m: 'SandLeaf.bmd', n: 'sandleaf_wait', u: 0 },
{ k: 'ShellCup', m: 'ShellCup.bmd', n: 'shellcup', u: 0 },
{ k: 'shine' },
{ k: 'SignCircle', m: 'maru_sign.bmd' },
{ k: 'SignCross', m: 'batu_sign.bmd' },
{ k: 'SignTriangle', m: '3kaku_sign.bmd' },
{ k: 'SirenabossWall', m: 'boss_wall.bmd' },
{ k: 'SirenaCasinoRoof', m: 'casino_lighting.bmd', n: 'casino_lighting', u: 5 },
{ k: 'skate_block', m: 'breakable_block.bmd' },
{ k: 'SkyIsland', m: 'SkyIsland.bmd', n: 'skyisland', u: 0 },
{ k: 'spread_block', m: 'breakable_block.bmd' },
{ k: 'stand_break', m: 'stand_break.bmd', n: 'stand_break0', u: 0 },
{ k: 'StartDemo' },
{ k: 'SuperHipDropBlock', m: 'super_rock.bmd' },
{ k: 'supermario_block', m: 'breakable_block.bmd' },
{ k: 'SurfGesoGreen' },
{ k: 'SurfGesoRed' },
{ k: 'SurfGesoYellow' },
{ k: 'TeethOfJuicer', m: 'TeethOfJuicer.bmd', n: 'teethofjuicer', u: 0 },
{ k: 'uirou', m: 'uirou.bmd' },
{ k: 'umaibou', m: 'umaibou.bmd' },
{ k: 'WaterHitHideObj' },
{ k: 'WaterMelonBlock', t: 'WaterMelon', m: 'WaterMelonBlock.bmd' },
{ k: 'watermelon', m: 'watermelon.bmd' },
{ k: 'WatermelonStatic', m: 'watermelon.bmd' },
{ k: 'water_power_inertial_lift', m: 'breakable_block.bmd' },
{ k: 'water_power_lift', m: 'breakable_block.bmd' },
{ k: 'water_power_ship', m: 'breakable_block.bmd' },
{ k: 'WaterRecoverObj' },
{ k: 'water_roll_block', m: 'water_roll_block.bmd' },
{ k: 'WaterSprayBox' },
{ k: 'WaterSprayCylinder' },
{ k: 'windmill_far', m: 'bigWindmill.bmd' },
{ k: 'wood_barrel_once', t: 'barrel', m: 'barrel_normal.bmd' },
{ k: 'wood_barrel', t: 'barrel', m: 'barrel_normal.bmd' },
{ k: 'WoodBox', t: 'kibako', m: 'kibako.bmd' },
{ k: 'yoshiblock', m: 'yoshiblock.bmd' },
{ k: 'yTurnLift', m: 'yTurnLift.bmd' },
        ];

        let modelEntry = modelLookup.find((lt) => obj.model === lt.k);
        if (modelEntry === undefined || (modelEntry.t && !modelEntry.m)) {
            const bmdFile = rarc.findFile(`mapobj/${obj.model.toLowerCase()}.bmd`);
            if (bmdFile) {
                //console.log("trying bmd heuristic for "+obj.model);
                if (modelEntry === undefined)
                    modelEntry = { k: obj.model, m: `${obj.model}.bmd` };
                else
                    modelEntry.m = `${obj.model}.bmd`;
            }
        }

        if (modelEntry === undefined) {
            console.warn(`No model for ${obj.klass} ${obj.model}`);
            return null;
        }

        let scene = null;
        if (modelEntry.m !== undefined) {
            const bmdFilename = `mapobj/${modelEntry.m.toLowerCase()}`;
            const bmdFile = assertExists(rarc.findFile(bmdFilename), bmdFilename);
            const bmdModel = lookupModel(bmdFile);
            scene = new J3DModelInstanceSimple(bmdModel);
            scene.passMask = SMSPass.OPAQUE;
        }

        if (scene === null) {
            console.log("couldn't load "+JSON.stringify(modelEntry));
            return null;
        }
        
        if (modelEntry.t !== undefined) {
            const bmtFilename = `mapobj/${modelEntry.t.toLowerCase()}.bmt`;
            const bmtFile = rarc.findFile(bmtFilename);
            if (bmtFile !== null) {
                const modelMaterialData = new J3DModelMaterialData(device, cache, BMT.parse(bmtFile.buffer));
                renderer.destroyables.push(modelMaterialData);
                scene.setModelMaterialData(modelMaterialData);
            }
        }
        
        if (modelEntry.n) {
            switch (modelEntry.u) {
            case 0:
            {
                const anmFile = rarc.findFile(`mapobj/${modelEntry.n.toLowerCase()}.bck`);
                if (anmFile !== null) {
                    const anm = BCK.parse(anmFile.buffer);
                    //anm.loopMode = LoopMode.REPEAT;
                    scene.bindANK1(anm);
                }
                break;
            }
            case 2:
            {
                const anmFile = assertExists(rarc.findFile(`mapobj/${modelEntry.n.toLowerCase()}.bpk`));
                const anm = BPK.parse(anmFile.buffer);
                scene.bindTRK1(anm);
                break;
            }
            case 3:
            {
                const anmFile = assertExists(rarc.findFile(`mapobj/${modelEntry.n.toLowerCase()}.btp`));
                const anm = BTP.parse(anmFile.buffer);
                scene.bindTPT1(anm);
                break;
            }
            case 4:
            {
                const anmFile = assertExists(rarc.findFile(`mapobj/${modelEntry.n.toLowerCase()}.btk`));
                const anm = BTK.parse(anmFile.buffer);
                scene.bindTTK1(anm);
                break;
            }
            case 5:
            {
                const anmFile = assertExists(rarc.findFile(`mapobj/${modelEntry.n.toLowerCase()}.brk`));
                const anm = BRK.parse(anmFile.buffer);
                scene.bindTRK1(anm);
                break;
            }
            default:
                throw `unhandled animation type ${modelEntry.u}`;
            }
        }
        
        const q = quat.create();
        quat.fromEuler(q, obj.rotationX, obj.rotationY, obj.rotationZ);
        mat4.fromRotationTranslationScale(scene.modelMatrix, q, [obj.x, obj.y, obj.z], [obj.scaleX, obj.scaleY, obj.scaleZ]);
        renderer.modelInstances.push(scene);
        return scene;
    }
    
    private createRendererForSceneBinStaticObj(device: GfxDevice, cache: GfxRenderCache, renderer: SunshineRenderer, rarc: RARC.JKRArchive, obj: SceneBinObjStaticObj): J3DModelInstanceSimple | null {
        interface ModelLookup {
            k: string; // model key
            m?: string; // model name
            p?: string; // particle system path
        };

        const modelCache = renderer.modelCache;
        function lookupModel(bmdFile: RARC.RARCFile): J3DModelData {
            assert(!!bmdFile);
            if (modelCache.has(bmdFile)) {
                return modelCache.get(bmdFile)!;
            } else {
                const bmd = BMD.parse(bmdFile.buffer);
                const bmdModel = new J3DModelData(device, cache, bmd);
                modelCache.set(bmdFile, bmdModel);
                return bmdModel;
            }
        }

        const effectsCache = renderer.effectsCache;
        function lookupEffect(jpaFile: RARC.RARCFile): JPA.JPACData {
            assert(!!jpaFile);
            if (effectsCache.has(jpaFile)) {
                return effectsCache.get(jpaFile)!;
            } else {
                const jpa = JPA.parse(jpaFile.buffer);
                const jpaEffect = new JPA.JPACData(jpa);
                effectsCache.set(jpaFile, jpaEffect);
                return jpaEffect;
            }
        }

        const modelLookup: ModelLookup[] = [
{ k: 'BiancoBossEffectLight', p: 'map/map/ms_wmlin_light.jpa' },
{ k: 'BiancoRiver', m: 'BiancoRiver' },
{ k: 'BiaWaterPollution', m: 'BiaWaterPollution' },
{ k: 'IndirectObj', m: 'IndirectObj' },
{ k: 'Mare5ExGate', m: 'Mare5ExGate' },
{ k: 'mareSeaPollutionS0', m: 'mareSeaPollutionS0' },
{ k: 'mareSeaPollutionS12', m: 'mareSeaPollutionS12' },
{ k: 'MonteRiver', m: 'MonteRiver' },
//{ k: 'ReflectParts', m: 'ReflectParts' },
//{ k: 'ReflectSky', m: 'ReflectSky' },
{ k: 'riccoSeaPollutionS0', m: 'riccoSeaPollutionS0' },
{ k: 'riccoSeaPollutionS1', m: 'riccoSeaPollutionS1' },
{ k: 'riccoSeaPollutionS2', m: 'riccoSeaPollutionS2' },
{ k: 'riccoSeaPollutionS3', m: 'riccoSeaPollutionS3' },
{ k: 'riccoSeaPollutionS4', m: 'riccoSeaPollutionS4' },
//{ k: 'SeaIndirect', m: 'SeaIndirect' },
//{ k: 'sea', m: 'sea' },
{ k: 'sun_mirror', m: 'sun_mirror' },
{ k: 'TargetArrow', m: 'TargetArrow' },
{ k: 'TopOfCorona', p: 'mapObj/ms_coronasmoke.jpa' },
        ];
        
        let modelEntry = modelLookup.find((lt) => obj.model === lt.k);
        if (modelEntry === undefined) {
            console.warn(`No model for ${obj.klass} ${obj.model}`);
            return null;
        }

        let scene = null;

        if (modelEntry.m !== undefined) {
            const bmdFilename = `map/map/${modelEntry.m.toLowerCase()}.bmd`;
            const bmdFile = assertExists(rarc.findFile(bmdFilename), bmdFilename);
            const bmdModel = lookupModel(bmdFile);
            scene = new J3DModelInstanceSimple(bmdModel);
            scene.passMask = SMSPass.OPAQUE;
        }
        
        if (modelEntry.p !== undefined) {
            const jpaFilename = modelEntry.p.toLowerCase();
            const jpaFile = assertExists(rarc.findFile(jpaFilename), jpaFilename);
            const jpaData = lookupEffect(jpaFile);
        }

        if (scene === null) {
            console.log("couldn't load "+JSON.stringify(modelEntry));
            return null;
        }

        const q = quat.create();
        quat.fromEuler(q, obj.rotationX, obj.rotationY, obj.rotationZ);
        mat4.fromRotationTranslationScale(scene.modelMatrix, q, [obj.x, obj.y, obj.z], [obj.scaleX, obj.scaleY, obj.scaleZ]);
        renderer.modelInstances.push(scene);
        return scene;
    }
}

const id = "sms";
const name = "Super Mario Sunshine";

const sceneDescs = [
    "Delfino Airstrip",
    new SunshineSceneDesc("airport0", "Delfino Airstrip (first visit)"),
    new SunshineSceneDesc("airport1", "Delfino Airstrip (after defeating proto piranha plant)"),
    "Delfino Plaza",
    new SunshineSceneDesc("dolpic0", "Delfino Plaza (first visit)"),
    new SunshineSceneDesc("dolpic1", "Delfino Plaza (after defeating proto piranha plant)"),
    new SunshineSceneDesc("dolpic5", "Delfino Plaza (after unlocking Bianco Hills)"),
    new SunshineSceneDesc("dolpic6", "Delfino Plaza (after unlocking Ricco Harbor and Gelato Beach)"),
    new SunshineSceneDesc("dolpic7", "Delfino Plaza (after collecting 10 Shine Sprites)"),
    new SunshineSceneDesc("dolpic8", "Delfino Plaza (after unlocking Pinna Park)"),
    new SunshineSceneDesc("dolpic9", "Delfino Plaza (after collecting all 7th Shine Sprites)"),
    new SunshineSceneDesc("dolpic10", "Delfino Plaza (after visiting Corona Mountain)"),
    new SunshineSceneDesc("dolpic_ex0", "Delfino Airstrip (red coins)"),
    new SunshineSceneDesc("dolpic_ex1", "Delfino Plaza (eastern pillar secret)"),
    new SunshineSceneDesc("dolpic_ex2", "Delfino Plaza (secret under the bridge)"),
    new SunshineSceneDesc("dolpic_ex3", "Delfino Plaza (western palm secret)"),
    new SunshineSceneDesc("dolpic_ex4", "Delfino Plaza (Yoshi boat ride secret)"),
    new SunshineSceneDesc("bia_ex1", "Delfino Plaza (police station secret)"),
    "Bianco Hills",
    new SunshineSceneDesc("bianco0", "Road to the Big Windmill"),
    new SunshineSceneDesc("bianco1", "Down with Petey Piranha! (introduction)"),
    new SunshineSceneDesc("biancoBoss", "Down with Petey Piranha! (boss fight)"),
    new SunshineSceneDesc("bianco2", "The Hillside Cave Secret (introduction)"),
    new SunshineSceneDesc("coro_ex1", "The Hillside Cave Secret (secret area)"),
    new SunshineSceneDesc("bianco3", "Red Coins of Windmill Village"),
    new SunshineSceneDesc("bianco4", "Petey Piranha Strikes Back"),
    new SunshineSceneDesc("bianco7", "The Secret of the Dirty Lake (introduction)"),
    new SunshineSceneDesc("coro_ex0", "The Secret of the Dirty Lake (secret area)"),
    new SunshineSceneDesc("bianco6", "Shadow Mario on the Loose"),
    new SunshineSceneDesc("bianco5", "The Red Coins of the Lake"),
    "Ricco Harbor",
    new SunshineSceneDesc("ricco0", "Gooper Blooper Breaks Out (introduction)"),
    new SunshineSceneDesc("ricco8", "Gooper Blooper Breaks Out (boss fight)"),
    new SunshineSceneDesc("ricco1", "Blooper Surfing Safari (introduction)"),
    new SunshineSceneDesc("rico_ex0", "Blooper Surfing Safari (racing area)"),
    new SunshineSceneDesc("ricco2", "The Caged Shine Sprite"),
    new SunshineSceneDesc("ricco3", "The Secret of Ricco Tower"),
    new SunshineSceneDesc("coro_ex2", "The Secret of Ricco Tower (secret area)"),
    new SunshineSceneDesc("ricco4", "Gooper Blooper Returns"),
    new SunshineSceneDesc("ricco5", "Red Coins on the Water"),
    new SunshineSceneDesc("ricco6", "Shadow Mario Revisited"),
    new SunshineSceneDesc("ricco7", "Yoshi's Fruit Adventure"),
    "Gelato Beach",
    new SunshineSceneDesc("mamma0", "Dune Bud Sand Castle Secret (introduction)"),
    new SunshineSceneDesc("mam_ex0", "Dune Bud Sand Castle Secret (secret area)"),
    new SunshineSceneDesc("mamma1", "Mirror Madness! Tilt, Slam, Bam!"),
    new SunshineSceneDesc("mamma2", "Wiggler Ahoy! Full Steam Ahead!"),
    new SunshineSceneDesc("mamma3", "The Sand Bird is Born (introduction)"),
    new SunshineSceneDesc("mam_ex1", "The Sand Bird is Born (Sand Bird)"),
    new SunshineSceneDesc("mamma4", "Il Piantissimo's Sand Sprint"),
    new SunshineSceneDesc("mamma5", "Red Coins in the Coral Reef"),
    new SunshineSceneDesc("mamma6", "It's Shadow Mario! After Him!"),
    new SunshineSceneDesc("mamma7", "The Watermelon Festival"),
    "Pinna Park Beach",
    new SunshineSceneDesc("pinnaBeach0", "Mecha-Bowser Appears!"),
    new SunshineSceneDesc("pinnaBeach1", "The Beach Cannon's Secret (introduction)"),
    new SunshineSceneDesc("coro_ex4", "The Beach Cannon's Secret (secret area)"),
    new SunshineSceneDesc("pinnaBeach3", "Red Coins of the Pirate Ships"),
    new SunshineSceneDesc("pinnaBeach2", "The Wilted Sunflowers"),
    new SunshineSceneDesc("pinnaBeach4", "The Runaway Ferris Wheel/The Yoshi-Go-Round's Secret/Shadow Mario in the Park/Roller Coaster Balloons"),
    "Pinna Park",
    new SunshineSceneDesc("pinnaParco0", "Mecha-Bowser Appears! (introduction)"),
    new SunshineSceneDesc("pinnaParco6", "Mecha-Bowser Appears! (after revealing boss)"),
    new SunshineSceneDesc("pinnaBoss1", "Mecha-Bowser Appears! (boss fight)"),
    new SunshineSceneDesc("pinnaParco7", "Mecha-Bowser Appears! (after defeating boss)"),
    new SunshineSceneDesc("pinnaParco1", "Red Coins of the Pirate Ships"),
    new SunshineSceneDesc("pinnaParco2", "The Runaway Ferris Wheel"),
    new SunshineSceneDesc("pinnaParco3", "The Yoshi-Go-Round's Secret (introduction)"),
    new SunshineSceneDesc("sirena_ex1", "The Yoshi-Go-Round's Secret (secret area)"),
    new SunshineSceneDesc("pinnaParco4", "Shadow Mario in the Park"),
    new SunshineSceneDesc("pinnaParco5", "Roller Coaster Balloons (introduction)"),
    new SunshineSceneDesc("pinnaBoss0", "Roller Coaster Balloons (roller coaster)"),
    "Sirena Beach",
    new SunshineSceneDesc("sirena0", "The Manta Storm"),
    new SunshineSceneDesc("sirena1", "The Hotel Lobby's Secret"),
    new SunshineSceneDesc("sirena2", "Mysterious Hotel Delfino"),
    new SunshineSceneDesc("sirena3", "The Secret of Casino Delfino"),
    new SunshineSceneDesc("sirena4", "King Boo Down Below"),
    new SunshineSceneDesc("sirena5", "Scrubbing Sirena Beach"),
    new SunshineSceneDesc("sirena6", "Shadow Mario Checks In"),
    new SunshineSceneDesc("sirena7", "Red Coins in the Hotel"),
    "Delfino Hotel",
    new SunshineSceneDesc("delfino0", "The Hotel Lobby's Secret (introduction)"),
    new SunshineSceneDesc("coro_ex5", "The Hotel Lobby's Secret (secret area)"),
    new SunshineSceneDesc("delfino1", "Mysterious Hotel Delfino"),
    new SunshineSceneDesc("delfino2", "The Secret of Casino Delfino/King Boo Down Below (hotel)"),
    new SunshineSceneDesc("casino0", "The Secret of Casino Delfino (casino)"),
    new SunshineSceneDesc("sirena_ex0", "The Secret of Casino Delfino (secret area)"),
    new SunshineSceneDesc("casino1", "King Boo Down Below (casino)"),
    new SunshineSceneDesc("delfinoBoss", "King Boo Down Below (boss fight)"),
    new SunshineSceneDesc("delfino3", "Shadow Mario Checks In"),
    new SunshineSceneDesc("delfino4", "Red Coins in the Hotel"),
    "Pianta Village",
    new SunshineSceneDesc("monte0", "Chain Chomplets Unchained"),
    new SunshineSceneDesc("monte5", "Il Piantissimo's Crazy Climb"),
    new SunshineSceneDesc("monte2", "The Goopy Inferno"),
    new SunshineSceneDesc("monte1", "Chain Chomp's Bath"),
    new SunshineSceneDesc("monte4", "Secret of the Village Underside (introduction)"),
    new SunshineSceneDesc("monte_ex0", "Secret of the Village Underside (secret area)"),
    new SunshineSceneDesc("monte3", "Piantas in Need"),
    new SunshineSceneDesc("monte6", "Shadow Mario Runs Wild"),
    new SunshineSceneDesc("monte7", "Fluff Festival Coin Hunt"),
    "Noki Bay",
    new SunshineSceneDesc("mare0", "Uncork the Waterfall"),
    new SunshineSceneDesc("mare1", "The Boss of Tricky Ruins"),
    new SunshineSceneDesc("mare2", "Red Coins in a Bottle (introduction)"),
    new SunshineSceneDesc("mare_ex0", "Red Coins in a Bottle (bottle)"),
    new SunshineSceneDesc("mare3", "Eely-Mouth's Dentist (introduction)"),
    new SunshineSceneDesc("mareBoss", "Eely-Mouth's Dentist (boss fight)"),
    new SunshineSceneDesc("mare4", "Il Piantissimo's Surf Swim"),
    new SunshineSceneDesc("mare5", "The Shell's Secret (introduction)"),
    new SunshineSceneDesc("rico_ex1", "The Shell's Secret (secret area)"),
    new SunshineSceneDesc("mare6", "Hold It, Shadow Mario!"),
    new SunshineSceneDesc("mare7", "The Red Coin Fish (introduction)"),
    new SunshineSceneDesc("mareUndersea", "The Red Coin Fish (underwater)"),
    "Corona Mountain",
    new SunshineSceneDesc("coro_ex6", "Corona Mountain (introduction)"),
    new SunshineSceneDesc("coronaBoss", "Corona Mountain (boss fight)"),
    "Test Map 1",
    new SunshineSceneDesc("test11", "Test Map 1"),
    "Main Menu",
    new SunshineSceneDesc("option", "Main Menu"),
];

// Backwards compatibility
const sceneIdMap = new Map<string, string>();
sceneIdMap.set("Delfino Plaza", "dolpic0");
sceneIdMap.set("Delfino Airport", "airport0");
sceneIdMap.set("Bianco Hills", "bianco0");
sceneIdMap.set("Ricco Harbor", "ricco0");
sceneIdMap.set("Gelato Beach", "mamma0");
sceneIdMap.set("Pinna Park Beach", "pinnaBeach0");
sceneIdMap.set("Pinna Park", "pinnaParco0");
sceneIdMap.set("Sirena Beach", "sirena0");
sceneIdMap.set("Delfino Hotel", "delfino0");
sceneIdMap.set("Noki Bay", "mare0");
sceneIdMap.set("Pianta Village", "monte3");

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, sceneIdMap };
