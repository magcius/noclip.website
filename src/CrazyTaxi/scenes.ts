import * as Viewer from '../viewer.js';
import * as GXTexture from '../gx/gx_texture.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { gfxRenderInstCompareNone, GfxRenderInstExecutionOrder, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx, GXTextureHolder } from '../gx/gx_render.js';
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { mat4, vec3 } from 'gl-matrix';
import { CameraController } from '../Camera.js';
import { Blue, Color, colorNewFromRGBA, Green, Red } from '../Color.js';
import { MaterialCache } from './material.js';
import { createShape } from './shape.js';
import { FileManager } from './util.js';

export class Scene implements Viewer.SceneGfx {
    private renderHelper: GXRenderHelperGfx;
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListSky = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    private materials: MaterialCache;
    private scratchVec3a = vec3.create();
    private scratchVec3b = vec3.create();

    constructor(device: GfxDevice, private manager: FileManager, public textureHolder: GXTextureHolder, public debugPos: vec3[][], public shapeNames: string[]) {
        this.renderHelper = new GXRenderHelperGfx(device);

        console.log('creating shapes')
        this.materials = new MaterialCache(this.renderHelper.renderCache, this.textureHolder);
        for (const name of shapeNames) {
            const shape = createShape(manager, name);
            this.materials.addShape(shape);
        }
        this.materials.finish();
        console.log('done')
    }

    private drawDebugPoints(points: vec3[], viewerInput: Viewer.ViewerRenderInput, color?: Color, connect?: boolean) {
        for (let i = 0; i < points.length; i++) {
            const pos = points[i];
            const t = i / points.length;
            drawWorldSpacePoint(
                getDebugOverlayCanvas2D(),
                viewerInput.camera.clipFromWorldMatrix,
                pos,
                color ? color : colorNewFromRGBA(t, t, 1),
                10,
            );
            if (connect) {
                let pos2 = points[i + 1];
                if (i+1 % 8 === 0 || i+1 === points.length) {
                    pos2 = points[i - 7];
                }
                if (vec3.sqrLen(pos2) < 0.01) {
                    continue;
                }
                drawWorldSpaceLine(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    pos, pos2,
                    color ? color : colorNewFromRGBA(t, t, 1),
                )
            }
        }
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);

        renderInstManager.setCurrentList(this.renderInstListMain);
        this.materials.prepareToRender(renderInstManager, viewerInput);
        this.drawDebugPoints(this.debugPos[2], viewerInput);

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.1);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.1);
        this.prepareToRender(device, viewerInput);
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Sky");
            const skyDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Sky Depth");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const manager = new FileManager(context.dataFetcher, [
            "poldc0.all",
            "texDC0.all",
            `pol${this.id}.all`,
            `pol${this.id}_stream.all`,
            `tex${this.id.toUpperCase()}.all`,
            "misc.all",
            "white.tex",
        ]);
        await manager.fetch();
        const mainData = await context.dataFetcher.fetchData("CrazyTaxi/sys/main.dol");
        const customerPos = [];
        const posData = mainData.slice(0x1e5aac).createDataView();
        const N_SHAPES = 982;
        const stride = 10 * 4;
        for (let i = 0; i < 982; i++) {
            const offs = i * stride;
            const x = posData.getFloat32(offs);
            const y = posData.getFloat32(offs + 0x4);
            const z = posData.getFloat32(offs + 0x8);
            const unk0 = posData.getUint32(offs + 0xc);
            const unk1 = posData.getUint32(offs + 0x10);
            const unk2 = posData.getFloat32(offs + 0x14);
            const unk3 = posData.getFloat32(offs + 0x18);
            const unk4 = posData.getFloat32(offs + 0x1c);
            const unk5 = posData.getUint32(offs + 0x20);
            const unk6 = posData.getUint32(offs + 0x24);
            customerPos.push(vec3.fromValues(x, y, z));
        }

        const deliveryZones = [];
        const pos2Data = mainData.slice(0xFB818, 0x101434).createDataView();
        let offs = 0;
        while (offs < pos2Data.byteLength) {
            deliveryZones.push(vec3.fromValues(
                pos2Data.getFloat32(offs + 0),
                pos2Data.getFloat32(offs + 4),
                pos2Data.getFloat32(offs + 8),
            ));
            offs += 3 * 4;
        }

        const pos3: vec3[] = [];
        const pos3Data = mainData.slice(0xe4ecc, 0xe69e4).createDataView();
        offs = 0;
        while (offs < pos3Data.byteLength) {
            try {
                pos3.push(vec3.fromValues(
                    pos3Data.getFloat32(offs + 0),
                    pos3Data.getFloat32(offs + 4),
                    pos3Data.getFloat32(offs + 8),
                ));
            } catch (err) { }
            offs += 3 * 4;
        }

        // const nameData = mainData.slice(0x12a884, 0x12fb40).createTypedArray(Uint8Array);
        // hexdump(mainData.slice(0x12a884));
        let names = [];
        // let offs = 0;
        // let name = '';
        // while (offs < nameData.byteLength) {
        //     if (nameData[offs] !== 0) {
        //         name += String.fromCharCode(nameData[offs]);
        //     } else if (name.length > 0) {
        //         names.push(name);
        //         name = '';
        //     }
        //     offs += 1;
        // }

        const indexNameData = mainData.slice(0x15f18c, 0x1942c0 + 0x44).createDataView();
        offs = 0;
        let fuck: [string, number][][] = [];
        while (offs < indexNameData.byteLength) {
            let name = '';
            let nameOffs = 0;
            while (indexNameData.getUint8(offs + nameOffs) !== 0) {
                name += String.fromCharCode(indexNameData.getUint8(offs + nameOffs));
                nameOffs += 1;
            }
            offs += 0x42;
            let index = indexNameData.getUint16(offs);
            if (index === 0) {
                fuck.push([]);
            }
            fuck[fuck.length - 1].push([name, index]);
            offs += 0x2;
        }

        console.log(fuck)

        const textures: GXTexture.TextureInputGX[] = [];
        for (const filename of manager.fileStore.list_textures()) {
            textures.push(manager.createTexture(filename.toLowerCase()));
        }
        names = [];
        for (const filename of manager.fileStore.list_shapes()) {
            if (['setdownbox.shp', 'grampus.shp'].includes(filename)) continue;
            names.push(filename);
        }
        const textureHolder = new GXTextureHolder();
        for (const texture of textures) {
            textureHolder.addTexture(gfxDevice, texture);
        }
        const scene = new Scene(gfxDevice, manager, textureHolder, [customerPos, deliveryZones, pos3], names);
        return scene;
    }
}

const sceneDescs: SceneDesc[] = [
    new SceneDesc('dc1', 'Arcade'),
    new SceneDesc('dc2', 'Original'),
    new SceneDesc('dc3', 'Crazy Box'),
];

const name = "Crazy Taxi";
const id = "crazytaxi";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
