import { mat4, vec3 } from "gl-matrix";
import { CameraController, computeViewMatrix } from "../Camera";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxAttachmentState, GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputState, GfxProgram, GfxSamplerBinding } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot, GfxrRenderTargetID, GfxrResolveTextureID} from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { InstanceType, NfsInstance, NfsRegion,  NfsTexture, RegionType } from "./region";
import { fillMatrix4x3, fillMatrix4x4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import * as UI from '../ui';
import { NfsMap, PathVertex } from "./map";
import { TextureMapping } from "../TextureHolder";
import { NfsPostProcessing } from "./postprocess";
import { NfsParticleProgram as NfsParticleProgram, NfsParticleEmitter, NfsParticleEmitterGroup } from "./particles";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";

export interface VertexInfo {
    inputLayout: GfxInputLayout;
    inputState: GfxInputState;
    drawCall: DrawCall;
    textureMappings: NfsTexture[];
    shaderType: number;
}

interface DrawCall {
    indexOffset: number;
    indexCount: number;
}

export const attachmentStatesTranslucent: GfxAttachmentState[] = [{
    alphaBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.Zero, blendSrcFactor: GfxBlendFactor.One},
    channelWriteMask: GfxChannelWriteMask.AllChannels,
    rgbBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha, blendSrcFactor: GfxBlendFactor.SrcAlpha}
}];
export const attachmentStatesAdditive: GfxAttachmentState[] = [{
    alphaBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.One, blendSrcFactor: GfxBlendFactor.SrcAlpha},
    channelWriteMask: GfxChannelWriteMask.AllChannels,
    rgbBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.One, blendSrcFactor: GfxBlendFactor.SrcAlpha}
}];
export const attachmentStatesSubtractive: GfxAttachmentState[] = [{
    alphaBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha, blendSrcFactor: GfxBlendFactor.Zero},
    channelWriteMask: GfxChannelWriteMask.AllChannels,
    rgbBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.OneMinusSrc, blendSrcFactor: GfxBlendFactor.Zero}
}];

export class NfsRenderer implements SceneGfx {

    private map: NfsMap;
    private activeRegion: NfsRegion;
    private renderHelper: GfxRenderHelper;
    private closestPathVertex: PathVertex;
    private devicePrograms: DeviceProgram[] = [];
    private particleProgram: DeviceProgram;
    private particleGfxProgram: GfxProgram;
    private gfxPrograms: GfxProgram[];
    private sortKeyAlpha: number;
    private sortKeyTranslucent: number;
    private sortKeySky: number;
    private shadowPassTexture: TextureMapping = new TextureMapping();
    private postProcessing: NfsPostProcessing;
    private streamingFreezed: boolean = false;
    private showPanoramas: boolean = true;
    private showShadows: boolean = true;
    private showTrackBarriers: boolean = false;
    private showHidden: boolean = false;
    private enableParticles: boolean = true;
    private fogIntensity: number = 4.0;
    private usePostProcessing: boolean = true;
    private shadowsSupported: boolean;

    constructor(map: NfsMap, device: GfxDevice, renderHelper: GfxRenderHelper) {
        this.map = map;
        this.renderHelper = renderHelper;
        for(let i = 0; i < 6; i++) {
            this.devicePrograms.push(new NfsProgram());
        }
        this.devicePrograms[1].defines.set("ALPHA_TEST", "1");
        this.devicePrograms[2].defines.set("SHADOW", "1");
        this.devicePrograms[3].defines.set("NORMALMAP", "1");
        this.devicePrograms[4].defines.set("GLOSSYWINDOW", "1");
        this.devicePrograms[5].defines.set("SKY", "1");

        this.shadowsSupported = device.queryTextureFormatSupported(GfxFormat.U16_RG_NORM, 0, 0);
        this.showShadows = this.shadowsSupported;

        this.postProcessing = new NfsPostProcessing(map, renderHelper);

        NfsParticleEmitter.init(device);
        this.particleProgram = new NfsParticleProgram();
    }

    private fillSceneUniformBuffer(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPos: vec3) {
        let offs = template.allocateUniformBuffer(NfsProgram.ub_SceneParams, 24);
        const sceneParamsMapped = template.mapUniformBufferF32(NfsProgram.ub_SceneParams);
        const worldProjMatrix = mat4.create();
        computeViewMatrix(worldProjMatrix, viewerInput.camera);
        mat4.mul(worldProjMatrix, viewerInput.camera.projectionMatrix, worldProjMatrix);
        offs += fillMatrix4x4(sceneParamsMapped, offs, worldProjMatrix);
        offs += fillVec4v(sceneParamsMapped, offs, [cameraPos[0], cameraPos[1], cameraPos[2], 0]);
        offs += fillVec4v(sceneParamsMapped, offs, [viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0, 0]);
    }

    private prepareToRenderShadows(viewerInput: ViewerRenderInput, cameraPos: vec3, instancesToRender: NfsInstance[]) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplateRenderInst();

        this.fillSceneUniformBuffer(template, viewerInput, cameraPos);

        template.setGfxProgram(this.gfxPrograms[2]);
        template.setMegaStateFlags({depthWrite: true, cullMode: GfxCullMode.Back});
        const layer = GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        instancesToRender.forEach(instance => {
            if(instance.type != InstanceType.Shadow)
                return;
            if(instance.worldMatrix === undefined)
                return;
            const model = instance.model;
            if(model === undefined)
                return;
            model.vertInfos.forEach(vInfo => {
                template.setInputLayoutAndState(vInfo.inputLayout, vInfo.inputState);
                let offs = template.allocateUniformBuffer(NfsProgram.ub_ObjectParams, 16);
                const d = template.mapUniformBufferF32(NfsProgram.ub_ObjectParams);
                const renderInst = renderInstManager.newRenderInst();
                const texMappings: GfxSamplerBinding[] = vInfo.textureMappings.slice();
                offs += fillMatrix4x3(d, offs, instance.worldMatrix);
                fillVec4v(d, offs, [0, 0, 0, 0]);
                renderInst.setSamplerBindingsFromTextureMappings(texMappings);
                renderInst.drawIndexes(vInfo.drawCall.indexCount, vInfo.drawCall.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            });
        });

        this.renderHelper.prepareToRender();
        renderInstManager.popTemplateRenderInst();
    }

    private prepareToRender(viewerInput: ViewerRenderInput, cameraPos: vec3, instancesToRender: NfsInstance[]): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplateRenderInst();

        this.fillSceneUniformBuffer(template, viewerInput, cameraPos);

        const layer = GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        template.setGfxProgram(this.gfxPrograms[0]);
        instancesToRender.forEach(instance => {
            if(instance.type == InstanceType.Shadow)        // shadows get handled in separate pass
                return;
            if(instance.worldMatrix === undefined)
                return;
            if(instance.type == InstanceType.TrackBarrier && !this.showTrackBarriers)
                return;
            if(instance.type == InstanceType.Hidden && !this.showHidden)
                return;
            const model = instance.model;
            if(model === undefined)
                return;
            model.vertInfos.forEach(vInfo => {
                template.setInputLayoutAndState(vInfo.inputLayout, vInfo.inputState);
                let offs = template.allocateUniformBuffer(NfsProgram.ub_ObjectParams, 16);
                const d = template.mapUniformBufferF32(NfsProgram.ub_ObjectParams);
                const renderInst = renderInstManager.newRenderInst();
                offs += fillMatrix4x3(d, offs, instance.worldMatrix);

                let cullMode = GfxCullMode.Back;
                if(vInfo.shaderType == 5 || vInfo.shaderType == 6 || !vInfo.textureMappings[0].faceCulling)
                    cullMode = GfxCullMode.None;
                else if(instance.invertedFaces)
                    cullMode = GfxCullMode.Front;
                renderInst.setMegaStateFlags({depthWrite: true, cullMode: cullMode});

                let fog = this.fogIntensity;
                let texMappings: GfxSamplerBinding[] = vInfo.textureMappings.slice();
                const diffuseTexture: NfsTexture = texMappings[0] as NfsTexture;
                if(diffuseTexture.cycleAnimation !== undefined) {
                    const anim = diffuseTexture.cycleAnimation;
                    const frameNumber = Math.floor(viewerInput.time * anim.frequency / 1000) % anim.frames.length;
                    texMappings[0] = anim.frames[frameNumber];
                }
                if(instance.type == InstanceType.Sky) {
                    renderInst.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false});
                    renderInst.setGfxProgram(this.gfxPrograms[5]);
                    renderInst.sortKey = this.sortKeySky;
                }
                else if(diffuseTexture.transparencyType > 0) {
                    renderInst.sortKey = this.sortKeyTranslucent;
                    if(diffuseTexture.transparencyType == 1) {
                         renderInst.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false});
                    }
                    if(diffuseTexture.transparencyType == 2) {
                        renderInst.setMegaStateFlags({attachmentsState: attachmentStatesAdditive, depthWrite: false});
                        fog = 0;
                    }
                    else if(diffuseTexture.transparencyType == 3) {
                        renderInst.setMegaStateFlags({attachmentsState: attachmentStatesSubtractive, depthWrite: false});
                    }
                }
                else if(diffuseTexture.alphaTest) {
                    renderInst.setGfxProgram(this.gfxPrograms[1]);
                    renderInst.sortKey = this.sortKeyAlpha;
                }
                else if(vInfo.shaderType == 1 || vInfo.shaderType == 3)
                    renderInst.setGfxProgram(this.gfxPrograms[3]);
                else if(vInfo.shaderType == 5)
                    renderInst.setGfxProgram(this.gfxPrograms[4]);

                if(diffuseTexture.scrollAnimation !== undefined) {
                    const anim = diffuseTexture.scrollAnimation;
                    const animFactor = anim.interval == -1 ? viewerInput.time / 1000 : Math.floor(viewerInput.time / anim.interval / 1000);
                    fillVec4v(d, offs, [(anim.scrollSpeed[0] * animFactor) % 1, (anim.scrollSpeed[1] * animFactor) % 1, fog, 0]);
                }
                else if(instance.type == InstanceType.Sky) {
                    fillVec4v(d, offs, [(viewerInput.time / 70000) % 5.0, 0, 0, 0]);
                }
                else {
                    fillVec4v(d, offs, [0, 0, fog, 0]);
                }
                texMappings[3] = this.shadowPassTexture;

                // Use the diffuse sampler state for all textures
                for(let i = 1; i < texMappings.length; i++) {
                    if(texMappings[i] !== undefined)
                        texMappings[i].gfxSampler = texMappings[0].gfxSampler;
                }
                renderInst.setSamplerBindingsFromTextureMappings(texMappings);
                renderInst.drawIndexes(vInfo.drawCall.indexCount, vInfo.drawCall.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            });
        });

        renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderParticles(viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager, activeEmitters: NfsParticleEmitterGroup[]) {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(this.particleGfxProgram);
        template.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false, cullMode: GfxCullMode.None});
        template.setInputLayoutAndState(NfsParticleEmitter.inputLayout, NfsParticleEmitter.inputState);
        template.drawIndexes(6);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);
        let offs = template.allocateUniformBuffer(NfsParticleProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(NfsParticleProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        activeEmitters.forEach(e => e.prepareToRender(renderInstManager, viewerInput));

        renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.05);
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        let shadowTargetID: GfxrRenderTargetID;
        if(this.showShadows) {
            const shadowPassDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
            shadowPassDesc.pixelFormat = GfxFormat.U16_RG_NORM;
            const shadowPassDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
            shadowTargetID = builder.createRenderTargetID(shadowPassDesc, 'Shadows');
            const shadowDepthTargetID = builder.createRenderTargetID(shadowPassDepthDesc, 'Shadows Depth');

            builder.pushPass((pass) => {
                pass.setDebugName("Shadows");
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, shadowTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, shadowDepthTargetID);
                pass.exec((passRenderer) => {
                    this.prepareToRenderShadows(viewerInput, cameraPos, instancesToRender);
                    renderInstManager.drawOnPassRenderer(passRenderer);
                });
            });
        }

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            let shadowTexId: GfxrResolveTextureID;
            if(this.showShadows) {
                shadowTexId = builder.resolveRenderTarget(shadowTargetID);
                pass.attachResolveTexture(shadowTexId);
            }
            pass.exec((passRenderer, scope) => {
                this.shadowPassTexture.gfxTexture = this.showShadows ? scope.getResolveTextureForID(shadowTexId) : null;
                this.prepareToRender(viewerInput, cameraPos, instancesToRender);
                if(this.enableParticles)
                    this.prepareToRenderParticles(viewerInput, renderInstManager, regionsToRender.flatMap(r => r.region.emitterGroups));
                this.renderHelper.prepareToRender();
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });

        let finalImage = mainColorTargetID;

        if(this.usePostProcessing)
            finalImage = this.postProcessing.render(builder, this.renderHelper, viewerInput, mainColorTargetID);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, finalImage);
        builder.resolveRenderTargetToExternalTexture(finalImage, viewerInput.onscreenTexture);

        const cameraPos: vec3 = [viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]];

        if(!this.streamingFreezed || this.closestPathVertex == null) {
            this.closestPathVertex = this.map.getClosestPathVertex([-cameraPos[0], cameraPos[2]]);
            this.activeRegion = this.closestPathVertex.region;
        }

        const regionsToRender = this.map.getRegionsToRender(this.closestPathVertex.position, this.activeRegion);
        const frustum = viewerInput.camera.frustum;
        const instancesToRender: NfsInstance[] = [];

        // Always draw the skydome
        this.map.regions[2600].rootBoundingVolumes[0].collectInstancesToRender(instancesToRender, frustum, false);
        regionsToRender.forEach(regionRenderCommand => {
            const region = regionRenderCommand.region;
            if(region.regionType == RegionType.Panorama && !this.activeRegion.ensureReady(device, this.renderHelper, this.map))
                return;
            if(!region.ensureReady(device, this.renderHelper, this.map))
                return;
            if(!this.showPanoramas && region.regionType == RegionType.Panorama)
                return;

            for(let i = regionRenderCommand.upperPartOnly ? region.upperPartOffset : 0; i < region.rootBoundingVolumes.length; i++) {
                region.rootBoundingVolumes[i].collectInstancesToRender(instancesToRender, frustum, false);
            }
        });

        this.gfxPrograms = this.devicePrograms.map(p => renderInstManager.gfxRenderCache.createProgram(p));
        this.particleGfxProgram = renderInstManager.gfxRenderCache.createProgram(this.particleProgram);
        this.sortKeyAlpha = makeSortKey(GfxRendererLayer.ALPHA_TEST);
        this.sortKeyTranslucent = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        this.sortKeySky = makeSortKey(GfxRendererLayer.BACKGROUND);

        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 4}]);

        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.popTemplateRenderInst();
        renderInstManager.resetRenderInsts();

        viewerInput.debugConsole.addInfoLine(`Region ID: ${this.activeRegion.id}`);
    }

    public adjustCameraController(cameraController: CameraController) {
        cameraController.setSceneMoveSpeedMult(0.02);
    }

    public createPanels() {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const useIngameStreaming = new UI.Checkbox('Use ingame visibility', false);
        useIngameStreaming.onchanged = () => {
            this.map.ingameStreamingMode = !this.map.ingameStreamingMode;
        };
        renderHacksPanel.contents.appendChild(useIngameStreaming.elem);

        const freezeStreamingCheckbox = new UI.Checkbox('Freeze world streaming', this.streamingFreezed);
        freezeStreamingCheckbox.onchanged = () => {
            this.streamingFreezed = !this.streamingFreezed;
        };
        renderHacksPanel.contents.appendChild(freezeStreamingCheckbox.elem);

        const showPanoramas = new UI.Checkbox('Show panoramas', this.showPanoramas);
        showPanoramas.onchanged = () => {
            this.showPanoramas = !this.showPanoramas;
        };
        renderHacksPanel.contents.appendChild(showPanoramas.elem);

        const showTrackBarriers = new UI.Checkbox('Show track barriers', this.showTrackBarriers);
        showTrackBarriers.onchanged = () => {
            this.showTrackBarriers = !this.showTrackBarriers;
        };
        renderHacksPanel.contents.appendChild(showTrackBarriers.elem);

        const showHidden = new UI.Checkbox('Show hidden objects', this.showHidden);
        showHidden.onchanged = () => {
            this.showHidden = !this.showHidden;
        };
        renderHacksPanel.contents.appendChild(showHidden.elem);

        if(this.shadowsSupported) {
            const showShadows = new UI.Checkbox('Enable shadows', this.showShadows);
            showShadows.onchanged = () => {
                this.showShadows = !this.showShadows;
            };
            renderHacksPanel.contents.appendChild(showShadows.elem);
        }

        const enableParticles = new UI.Checkbox('Enable particle effects', this.enableParticles);
        enableParticles.onchanged = () => {
            this.enableParticles = !this.enableParticles;
        };
        renderHacksPanel.contents.appendChild(enableParticles.elem);

        const usePostProcessing = new UI.Checkbox('Enable post-processing', this.usePostProcessing);
        usePostProcessing.onchanged = () => {
            this.usePostProcessing = !this.usePostProcessing;
        };
        renderHacksPanel.contents.appendChild(usePostProcessing.elem);

        const tintSlider = new UI.Slider();
        tintSlider.setRange(0, 1, 0.01);
        tintSlider.setLabel("Tint Intensity");
        tintSlider.onvalue = () => {
            this.postProcessing.tintIntensity = tintSlider.getValue();
        };
        tintSlider.setValue(1);
        renderHacksPanel.contents.appendChild(tintSlider.elem);

        const fogSlider = new UI.Slider();
        fogSlider.setRange(0, 4, 0.1);
        fogSlider.setLabel("Fog Intensity");
        fogSlider.onvalue = () => {
            this.fogIntensity = fogSlider.getValue();
        };
        fogSlider.setValue(4);
        renderHacksPanel.contents.appendChild(fogSlider.elem);


        return [renderHacksPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.map.destroy(device);
        NfsParticleEmitter.destroy(device);        
    }
}

class NfsProgram extends DeviceProgram {

    public static a_Position = 0;
    public static a_UV = 1;
    public static a_Color = 2;
    public static a_Normal = 3;
    public static a_Tangent = 4;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_WorldProjMat;
    vec4 u_CameraPos;
    vec2 u_ViewportSize;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ObjectWorldMat;
    vec2 u_uvOffset;
    float u_FogIntensity;
};

uniform sampler2D u_Diffuse;
uniform sampler2D u_Normal;
uniform sampler2D u_Specular;
uniform sampler2D u_Shadow;

#define AmbientColor vec4(0.19, 0.24, 0.32, 4.0)
#define DiffuseColor vec4(1.0, 0.8, 0.3, 1.0)
#define SpecularColor vec3(0.32, 0.28, 0.22)
#define SpecularPower 11.0
#define SunDirection normalize(vec3(-0.665, 0.6, -0.445))
#define SunHighlightBase vec3(0.213570565038984, 0.17809287890625, 0.135189822656088)
#define SunHighlightFactor vec3(0.436663384570152, 0.46304148515625, 0.495696016405656)
#define Fog_Br_Plus_Bm vec3(0.00007351, 0.00011792, 0.00023966)

#define ShadowRange 2000.0
#define ShadowBias 0.001
#define CloudIntensity 0.33
`;

    public override vert = `
layout(location = ${NfsProgram.a_Position}) in vec3 a_Position;
layout(location = ${NfsProgram.a_UV}) in vec2 a_UV;
layout(location = ${NfsProgram.a_Color}) in vec4 a_Color;
layout(location = ${NfsProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${NfsProgram.a_Tangent}) in vec3 a_Tangent;

out vec2 v_TexCoord;
out vec2 v_TexCoord2;
out vec3 v_Fog;
out vec4 v_ColorA;
out vec4 v_ColorB;
out vec3 v_LightDir;
out vec3 v_CameraDir;
out vec3 v_AdditionalFog;
out vec3 v_Specular;

${GfxShaderLibrary.MulNormalMatrix}

void main() {
    vec4 worldPos = vec4(Mul(u_ObjectWorldMat, vec4(a_Position, 1.0)), 1.0);
    gl_Position = Mul(u_WorldProjMat, worldPos);
    vec3 position = worldPos.xyz / worldPos.w;
    vec3 normal = MulNormalMatrix(u_ObjectWorldMat, a_Normal);
    v_TexCoord = a_UV + u_uvOffset.xy;

#ifdef SHADOW
    v_ColorA = a_Color.bgra;
    return;
#endif

    vec3 vecToEye = normalize(u_CameraPos.xyz - position);
    float lightNormalDot = dot(normal, SunDirection);
    float lightAmount = dot(SunDirection, vecToEye);
    lightAmount = 1.0 + lightAmount * lightAmount;

    vec3 sunHighlight = lightAmount * SunHighlightFactor + SunHighlightBase;

#ifdef SKY
    float fogValue = 15000.0;
#else
    float distanceToEye = distance(u_CameraPos.xyz, position);
    float fogValue = clamp(distanceToEye * u_FogIntensity, 0.0, 2500.0);
#endif
    vec3 fog = exp(-fogValue * Fog_Br_Plus_Bm);
    v_Fog = clamp(sunHighlight * (1.0 - fog), 0.0, 1.0);

    v_ColorA = vec4(AmbientColor.a * AmbientColor.rgb * a_Color.bgr, a_Color.a);

    v_ColorB = clamp(lightNormalDot, 0.0, 1.0) * DiffuseColor;

#ifdef NORMALMAP
    vec3 tangent = MulNormalMatrix(u_ObjectWorldMat, a_Tangent);
    vec3 bitangent = cross(normal, tangent);
    v_LightDir = vec3(dot(SunDirection, tangent), dot(SunDirection, bitangent), lightNormalDot);
    v_CameraDir = vec3(dot(vecToEye, tangent), dot(vecToEye, bitangent), dot(vecToEye, normal));
    v_AdditionalFog = min(fog, 1.0);
#else

v_ColorA.xyz *= min(fog, 1.0);

#endif

#ifdef GLOSSYWINDOW
    v_ColorA.a = 1.0;

    v_TexCoord2 = 0.5 * vec2(a_UV.x, a_UV.y);

    vec3 lightDir = 2.0 * lightNormalDot * normal - SunDirection;
    float glossiness = clamp(dot(lightDir, vecToEye), 0.0, 1.0);
    v_Specular = vec3(pow(glossiness, 10.0));
#endif

#ifdef SKY
    v_TexCoord = vec2(a_UV.x - 0.4 * u_uvOffset.x, a_UV.y);
    v_TexCoord2 = vec2(a_UV.x - 0.2 * u_uvOffset.x - 0.3, a_UV.y);
#endif
}
`;
    public override frag = `
in vec2 v_TexCoord;
in vec2 v_TexCoord2;
in vec3 v_Fog;
in vec4 v_ColorA;
in vec4 v_ColorB;
in vec3 v_LightDir;
in vec3 v_CameraDir;
in vec3 v_AdditionalFog;
in vec3 v_Specular;

void main() {

#ifdef SKY
    float cloudsA = texture(SAMPLER_2D(u_Diffuse), v_TexCoord).r;
    float cloudsB = texture(SAMPLER_2D(u_Diffuse), v_TexCoord2).r;

    float clouds = 2.0 * CloudIntensity * cloudsA * cloudsB;
    gl_FragColor = vec4(clouds + (1.0 - clouds) * v_Fog, 1.0);
    return;
#endif

    vec4 diffuseTex = texture(SAMPLER_2D(u_Diffuse), v_TexCoord);

#ifdef SHADOW
    float linearDepth = 1.0 - (2.0 * gl_FragCoord.z - 1.0) / (1.0 - ShadowRange) / gl_FragCoord.w;
    gl_FragColor.xy = vec2(linearDepth, 1.0 - (diffuseTex.a * v_ColorA.a * 0.7 * clamp(linearDepth * 10.0, 0.0, 1.0)));
    return;
#endif

    // Shadow stuff
    vec3 devCoords = gl_FragCoord.xyz / vec3(u_ViewportSize.x, -u_ViewportSize.y, 1.0) * vec3(1.0, -1.0, 1.0);
    vec4 shadowTex = texture(SAMPLER_2D(u_Shadow), devCoords.xy);
    float depth = (2.0 * gl_FragCoord.w - 1.0) / (1.0 - ShadowRange);
    depth = 1.0 - depth / gl_FragCoord.w;
    float shadowFactor = 1.0;
    if(depth <= shadowTex.x + ShadowBias && shadowTex.x > 0.0) {
        gl_FragColor.rgb = vec3(shadowTex.yyy);
        shadowFactor = shadowTex.y;
    }

#ifdef ALPHA_TEST
    if(diffuseTex.a <= 0.375)
        discard;
#endif
    vec3 colorA = diffuseTex.rgb * v_ColorA.rgb;

#ifdef NORMALMAP
    vec4 normalTex = texture(SAMPLER_2D(u_Normal), v_TexCoord);
    vec4 specularTex = texture(SAMPLER_2D(u_Specular), v_TexCoord);

    vec3 normal = normalize(2.0 * normalTex.rgb - 1.0);

    vec3 lightDir = normalize(v_LightDir.xyz);
    float lightAmount = dot(normal, lightDir);
    lightDir = 2.0 * lightAmount * normal - lightDir;

    vec3 camDir = normalize(v_CameraDir.xyz);
    float specularAmount = clamp(dot(lightDir, camDir), 0.0, 1.0) * shadowFactor;
    vec3 specularHighlight = pow(specularAmount, SpecularPower) * SpecularColor * specularTex.rgb;

    vec3 colorB = max(lightAmount, 0.0) * diffuseTex.rgb * DiffuseColor.rgb + specularHighlight;
    colorB = 2.0 * (colorA + colorB) * shadowFactor;
    colorB *= v_AdditionalFog;
#else
    vec3 colorB = diffuseTex.rgb * v_ColorB.rgb;
    colorB = 2.0 * (colorA + colorB) * shadowFactor;
#endif

#ifdef GLOSSYWINDOW
    vec4 reflectionTexColor = texture(SAMPLER_2D(u_Normal), v_TexCoord2);
    colorB = diffuseTex.a * (reflectionTexColor.rgb + 4.0 * v_Specular);
    colorB += 2.0 * (colorA + diffuseTex.rgb * v_ColorB.rgb);
#endif

    gl_FragColor = vec4(colorB + v_Fog, diffuseTex.a * v_ColorA.a);
}
`;
}
