import { mat4 } from "gl-matrix";
import { colorNewFromRGBA } from "../Color";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { BasicRenderTarget, makeClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxHostAccessPass, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxRenderPass, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { executeOnPass, GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { DeviceProgram } from "../Program";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVTR } from "./ParsedFiles/UVTR";
import { UVTX } from "./ParsedFiles/UVTX";

class TempTestingProgram extends DeviceProgram {
    public static inPosition = 0;
    public static inTexCoord = 1;
    public static inColor = 2;

    public static ub_ModelToWorld = 0;
    public static ub_WorldToNDC = 1;


    //TODO-ASK: why do i need to use an interface?
    //TODO: fix: yzx and * 1000.0?
    public vert = `
layout(location = ${TempTestingProgram.inPosition}) in vec3 inPosition;
layout(location = ${TempTestingProgram.inTexCoord}) in vec2 inTexCoord;
layout(location = ${TempTestingProgram.inColor}) in vec4 inColor;

layout(row_major, std140) uniform ub_ModelToWorld {
    Mat4x4 u_ModelToWorld;
};

layout(row_major, std140) uniform ub_WorldToNDC {
    Mat4x4 u_WorldToNDC;
};

out vec4 color;
out vec2 texCoord;

void main() {
    vec4 worldPos = Mul(u_ModelToWorld, vec4(inPosition, 1.0));
    //TODO: better solution for this
    worldPos = worldPos.yzxw;
    worldPos = worldPos * vec4(100.0, 100.0, 100.0, 1.0);
    gl_Position = Mul(u_WorldToNDC, worldPos);
    color = inColor;
    texCoord = inTexCoord;
}
    `;
    public frag = `
in vec4 color;
in vec2 texCoord;

uniform sampler2D u_Texture;

void main() {
#ifdef TEXTURED
    gl_FragColor = vec4((color * texture(u_Texture, texCoord)).xyz, 1.0);
#else
    gl_FragColor = color;
#endif
}
    `;
}


export interface Material {
    uvtx: UVTX | null;
    // XYZ ST RGBA
    vertexData: Float32Array;
    indexData: Uint16Array;
}

class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    private hasTextureData: boolean;
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;

    private program: DeviceProgram;

    private indexCount: number;

    constructor(device: GfxDevice, material: Material) {
        if(material.uvtx !== null) {
            for(let q = 0; q < material.vertexData.byteLength / 9; q++) {
                let origS = material.vertexData[q * 9 + 3];
                let origT = material.vertexData[q * 9 + 4];
                let oglS = (origS - material.uvtx.tile_sLo) / (material.uvtx.tile_sHi - material.uvtx.tile_sLo);
                let oglT = (origT - material.uvtx.tile_tLo) / (material.uvtx.tile_tHi - material.uvtx.tile_tLo);
                material.vertexData[q * 9 + 3] = oglS;
                material.vertexData[q * 9 + 4] = oglT;
                console.warn("REMOVEME!!!");
            }
        }

        this.program = new TempTestingProgram();
        this.indexCount = material.indexData.length;

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, material.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, material.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TempTestingProgram.inPosition, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: TempTestingProgram.inTexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 0x04, },
            { location: TempTestingProgram.inColor, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 9 * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0 });



        this.hasTextureData = false;
        if(material.uvtx !== null && !material.uvtx.not_supported_yet) {
            this.hasTextureData = true;
            const uvtx = material.uvtx;
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, uvtx.imageWidth, uvtx.imageHeight, 1));
            //device.setResourceName(this.gfxTexture, texture.name);
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(this.gfxTexture, 0, [uvtx.convertedTexelData]);
            device.submitPass(hostAccessPass);
    
            // TODO: actually implement
            this.gfxSampler = device.createSampler({
                wrapS: GfxWrapMode.REPEAT,
                wrapT: GfxWrapMode.REPEAT,
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0, maxLOD: 0,
            });
        }
        this.program.setDefineBool("TEXTURED", this.hasTextureData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {
        const renderInst = renderInstManager.newRenderInst();

        // Build model->NDC matrix
        let worldToNDCMatrix = mat4.create();
        mat4.mul(worldToNDCMatrix, viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix);

        // Allocate memory and fill matrix
        // TODO-ASK: what exactly is happening here? 
        let offs1 = renderInst.allocateUniformBuffer(TempTestingProgram.ub_ModelToWorld, 16);
        const d1 = renderInst.mapUniformBufferF32(TempTestingProgram.ub_ModelToWorld);
        offs1 += fillMatrix4x4(d1, offs1, modelToWorldMatrix);

        let offs2 = renderInst.allocateUniformBuffer(TempTestingProgram.ub_WorldToNDC, 16);
        const d2 = renderInst.mapUniformBufferF32(TempTestingProgram.ub_WorldToNDC);
        offs2 += fillMatrix4x4(d2, offs2, worldToNDCMatrix);

        // Load mesh data
        if(this.hasTextureData) {
            renderInst.setSamplerBindingsFromTextureMappings([{gfxTexture: this.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null}]);
        }
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        let gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.drawIndexes(this.indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyTexture(this.gfxTexture);
        device.destroySampler(this.gfxSampler);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

class BARRenderer implements SceneGfx {

    public renderHelper: GfxRenderHelper;
    public program: TempTestingProgram;
    private renderTarget = new BasicRenderTarget();

    private uvtr: UVTR;
    private materialToRendererMap: Map<any, MaterialRenderer>;

    constructor(device: GfxDevice, uvtr: UVTR) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = new TempTestingProgram();
        this.uvtr = uvtr;

        this.materialToRendererMap = new Map();
        for(let [uvct, placementMat] of this.uvtr.uvcts) {
            for(let material of uvct.materials) {
                const materialRenderer = new MaterialRenderer(device, material);
                this.materialToRendererMap.set(material, materialRenderer);
            }
            for(let [uvmd, placementMat] of uvct.uvmds) {
                const lod0 = uvmd.lods[0];
                for(let part of lod0.modelParts) {
                    for(let material of part.materials) {
                        const materialRenderer = new MaterialRenderer(device, material);
                        this.materialToRendererMap.set(material, materialRenderer);
                    }
                }
            }
        }
    }

    // TODO-ASK: how exactly do the templates work? what is a render inst?
    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const topTemplate = this.renderHelper.pushTemplateRenderInst();
        
        topTemplate.setBindingLayouts(bindingLayouts);

        topTemplate.setMegaStateFlags(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        }));
        topTemplate.setMegaStateFlags({cullMode: GfxCullMode.BACK});

        // TODO-ASK
        const renderInstManager = this.renderHelper.renderInstManager;
        for(let [uvct, uvctPlacementMat] of this.uvtr.uvcts) {
            for(let material of uvct.materials) {
                const materialRenderer = this.materialToRendererMap.get(material)!;
                materialRenderer.prepareToRender(device, renderInstManager, viewerInput, uvctPlacementMat);
            }
            for(let [uvmd, uvmdPlacementMat] of uvct.uvmds) {
                const lod0 = uvmd.lods[0];
                for(let part of lod0.modelParts) {
                    for(let material of part.materials) {
                        // i am so sorry i am just extremely lazy
                        let index = lod0.modelParts.indexOf(part);
                        
                        let modelToWorldMatrix = mat4.create();
                        let combinedPlacementMat = mat4.create();
                        mat4.multiply(combinedPlacementMat, uvmdPlacementMat, uvmd.matrices[index]);
                        mat4.multiply(modelToWorldMatrix, uvctPlacementMat, combinedPlacementMat);

                        const materialRenderer = this.materialToRendererMap.get(material)!;
                        materialRenderer.prepareToRender(device, renderInstManager, viewerInput, modelToWorldMatrix);
                    }
                }
            }
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();       
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    //TODO-ASK: how does this work? what is a pass? what is the host access pass? what is the return value?
    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // const skyPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, this.renderPassDescriptor);
        // executeOnPass(renderInstManager, device, skyPassRenderer, 0);
        // device.submitPass(skyPassRenderer);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, makeClearRenderPassDescriptor(true, colorNewFromRGBA(0, 0, 0, 1)));
        executeOnPass(renderInstManager, device, passRenderer, 0);
        // executeOnPass(renderInstManager, device, passRenderer, PW64Pass.SNOW);

        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        // if (this.snowRenderer !== null)
        //     this.snowRenderer.destroy(device);
    }
}

// TODO: move?
export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;
    constructor(public uvtrIndex: number, public name: string) {
        this.id = uvtrIndex.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        const uvtr = filesystem.getParsedFile(UVTR, "UVTR", this.uvtrIndex);

        console.log(uvtr);

        // const levelData = dataHolder.uvlv[0].levels[uvlvIDList[this.levelID]];

        // const skybox = dataHolder.uven[envIndex(this.levelID, this.weatherConditions)];
        // const activePalette: Map<number, number> | undefined = dataHolder.uvtp[paletteIndex(this.levelID, this.weatherConditions)];

        // const modelBuilder = {
        //     uvmdData: dataHolder.uvmdData,
        //     palette: new TexturePalette(dataHolder.textureData, activePalette),
        // };

        const renderer = new BARRenderer(device, uvtr);
        // renderer.renderPassDescriptor = makeClearRenderPassDescriptor(true, {r: skybox.clearColor[0], g: skybox.clearColor[1], b: skybox.clearColor[2], a: 1});
        // const isMap = this.weatherConditions < 0;

        // if (skybox.skyboxModel !== undefined) {
        //     const sky = spawnObject(modelBuilder, skybox.skyboxModel);
        //     renderer.skyRenderers.push(sky);
        // }
        // if (skybox.oceanModel !== undefined) {
        //     const oceanPlane = spawnEnvObject(modelBuilder, skybox.oceanModel);
        //     oceanPlane.sortKeyBase = makeSortKey(GfxRendererLayer.BACKGROUND);
        //     renderer.dobjRenderers.push(oceanPlane);
        // }
        // if (this.levelID === 3 && this.weatherConditions === 2)
        //     renderer.snowRenderer = new SnowRenderer(device, 800);

        // const currUPWL = dataHolder.upwl[this.levelID];
        // const landingPads: LandingPad[] = [];

        // if (isMap)
        //     renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, { modelIndex: levelMapID(this.levelID), position: vec3.create() }));
        // else {
        //     for (let i = 0; i < levelData.terras.length; i++) {
        //         const terraIndex = levelData.terras[i];
        //         const uvtrChunk = dataHolder.uvtr[0].maps[terraIndex];
        //         const uvtrRenderer = new UVTRRenderer(dataHolder, modelBuilder, uvtrChunk);
        //         mat4.copy(uvtrRenderer.modelMatrix, toNoclipSpace);
        //         renderer.uvtrRenderers.push(uvtrRenderer);
        //     }

        //     const levelDobjs = getLevelDobjs(this.levelID, modelBuilder, dataHolder);
        //     for (let i = 0; i < levelDobjs.length; i++) {
        //         renderer.dobjRenderers.push(levelDobjs[i]);
        //     }

        //     for (let i = 0; i < currUPWL.windObjects.length; i++) {
        //         // TODO: move these based on wind
        //         renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, currUPWL.windObjects[i]));
        //     }

        //     for (let i = 0; i < currUPWL.landingPads.length; i++) {
        //         const padData = dataHolder.uvmdData[currUPWL.landingPads[i].modelIndex];
        //         const pad = new LandingPad(padData, modelBuilder.palette);
        //         fromTranslationScaleEuler(pad.modelMatrix, currUPWL.landingPads[i].position, 1 / padData.uvmd.inverseScale, currUPWL.landingPads[i].angles);
        //         renderer.dobjRenderers.push(pad);
        //         landingPads.push(pad);
        //     }
        //     const starData = dataHolder.uvmdData[0xf2];
        //     const star = new BirdmanStar(starData, modelBuilder.palette);
        //     fromTranslationScaleEuler(star.modelMatrix, currUPWL.bonusStar, 1 / starData.uvmd.inverseScale);
        //     renderer.dobjRenderers.push(star);
        // }

        // const taskList = dataHolder.upwt[this.levelID];
        // taskList.sort(taskSort);
        // for (let i = 0; i < taskList.length; i++) {
        //     const upwt = taskList[i];
        //     if (isEmptyTask(upwt))
        //         continue;
        //     renderer.taskLabels.push(upwt.label);
        //     renderer.strIndexToTask.push(i);
        //     for (let j = 0; j < upwt.models.length; j++) {
        //         if ((!isMap && upwt.models[j].modelIndex >= 0) || (isMap && upwt.models[j].mapModelIndex !== -1))
        //             renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, upwt.models[j], i, isMap));
        //     }
        //     for (let j = 0; j < upwt.rings.length; j++) {
        //         if (isMap) {
        //             if (upwt.rings[j].mapModelIndex !== undefined)
        //                 renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, upwt.rings[j], i, isMap));
        //         } else {
        //             const ringData = upwt.rings[j];
        //             const ringModel = dataHolder.uvmdData[ringData.modelIndex];
        //             const ringObj = new Ring(ringModel, modelBuilder.palette, ringData.axis);
        //             ringObj.taskNumber = i;
        //             fromTranslationScaleEuler(ringObj.modelMatrix, ringData.position, 1 / ringModel.uvmd.inverseScale, ringData.angles);
        //             renderer.dobjRenderers.push(ringObj);
        //         }
        //     }
        //     if (upwt.landingPad) {
        //         if (isMap)
        //             renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, upwt.landingPad, i, isMap));
        //         else
        //             for (let j = 0; j < currUPWL.landingPads.length; j++) {
        //                 // when a task is chosen, the game finds a nearby inactive pad and replaces its model and flags
        //                 if (vec3.distance(upwt.landingPad.position, currUPWL.landingPads[j].position) < 100) {
        //                     // the UPWT pad doesn't have the real position, copy from UPWL
        //                     upwt.landingPad.position = currUPWL.landingPads[j].position;
        //                     upwt.landingPad.angles = currUPWL.landingPads[j].angles;
        //                     const activePad = spawnObjectAt(modelBuilder, upwt.landingPad, i);
        //                     renderer.dobjRenderers.push(activePad);
        //                     landingPads[j].alternates.push(activePad);
        //                     break;
        //                 }
        //             }
        //     }
        //     if (upwt.takeoffPad) {
        //         const vehicle = upwt.label.vehicle;
        //         if (!isMap) {
        //             // place a random character at the start position
        //             const character = (Math.random() * 6) >>> 0;
        //             upwt.takeoffPad.modelIndex = playerModel(vehicle, character);
        //             const player = spawnObjectAt(modelBuilder, upwt.takeoffPad, i);
        //             renderer.dobjRenderers.push(player);
        //             if (upwt.takeoffPad.onGround || vehicle === Vehicle.JumbleHopper) {
        //                 let height = groundHeight(dataHolder, dataHolder.uvtr[0].maps[levelData.terras[0]], upwt.takeoffPad.position[0], upwt.takeoffPad.position[1]);
        //                 const limit = vehicle === Vehicle.Cannonball ? Infinity : vehicle === Vehicle.JumbleHopper ? 50 : 1;
        //                 // two tasks actually start on top of objects
        //                 if (Math.abs(height - upwt.takeoffPad.position[2]) > limit)
        //                     height = vehicle === Vehicle.JumbleHopper ? 107 : 179;
        //                 alignToGround(player.modelMatrix, height, vehicle, character);
        //             }
        //         } else if (vehicle !== Vehicle.Cannonball) // cannonball doesn't show any marker at the start
        //             renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, upwt.takeoffPad, i, isMap));
        //     }
        // }

        return renderer;
    }
}

const id = 'BeetleAdventureRacing';
const name = "Beetle Adventure Racing!";
const sceneDescs = [
    'Tracks', // TODO: name?
    new BARSceneDesc(19, 'Coventry Cove'),
    new BARSceneDesc(34, 'Mount Mayhem'),
    new BARSceneDesc(22, 'Inferno Isle'),
    new BARSceneDesc(20, 'Sunset Sands'),
    new BARSceneDesc(21, '[thing under sunset sands]'),
    new BARSceneDesc(35, 'Metro Madness'),
    new BARSceneDesc(23, 'Wicked Woods'),
    'Beetle Battle',
    new BARSceneDesc(24, 'Airport'),
    new BARSceneDesc(26, 'Castle'),
    new BARSceneDesc(27, 'Stadium'),
    new BARSceneDesc(28, 'Volcano'),
    new BARSceneDesc(29, 'Dunes'),
    new BARSceneDesc(30, 'Rooftops'),
    new BARSceneDesc(31, 'Ice Flows'),
    new BARSceneDesc(32, 'Parkade'),
    new BARSceneDesc(33, 'Woods'),
    'Unused',
    new BARSceneDesc(36, 'Stunt O\'Rama'), // Stunt O Rama (unused)
    new BARSceneDesc(25, 'Unused Beetle Battle arena'),
    'Not Sure',
    new BARSceneDesc(0, '0'),
    new BARSceneDesc(2, 'Parkade duplicate??'),
    new BARSceneDesc(12, '12'),
    new BARSceneDesc(13, '13'),
    new BARSceneDesc(14, '14'),
    new BARSceneDesc(15, '15'), // bridge test level
    new BARSceneDesc(16, '16'), // big ring test level
    new BARSceneDesc(17, '17'), // checkerboard test level
    new BARSceneDesc(18, '18'),
    new BARSceneDesc(37, '37'),
    //new BARSceneDesc(1, '1'), blue tint
    //new BARSceneDesc(3, '3'), blue tint
    // new BARSceneDesc(8, '8'), blue tint
    // new BARSceneDesc(9, '9'), blue tint
    // new BARSceneDesc(10, '10'), blue tint
    // new BARSceneDesc(11, '11'), blue tint
    // new BARSceneDesc(4, '4'), advertise segment
    // new BARSceneDesc(5, '5'), advertise segment
    // new BARSceneDesc(6, '6'), advertise segment
    // new BARSceneDesc(7, '7'), advertise segment
    // new BARSceneDesc(38, '38'), advertise segment
    // new BARSceneDesc(39, '39'), advertise segment

];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
