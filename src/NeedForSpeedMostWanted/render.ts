
import { mat4, vec3 } from "gl-matrix";
import { CameraController, computeViewSpaceDepthFromWorldSpacePoint } from "../Camera.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxAttachmentState, GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCullMode, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstList, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import * as UI from '../ui.js';
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { NfsMap, PathVertex } from "./map.js";
import { NfsParticleEmitter, NfsParticleEmitterGroup, NfsParticleProgram } from "./particles.js";
import { NfsPostProcessing } from "./postprocess.js";
import { InstanceType, NfsInstance, NfsRegion, NfsTexture, RegionType } from "./region.js";

export interface VertexInfo {
    inputLayout: GfxInputLayout;
    vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    indexBufferDescriptor: GfxIndexBufferDescriptor;
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
    private renderInstListMain = new GfxRenderInstList();
    private closestPathVertex: PathVertex;
    private aabbCenter: vec3 = vec3.create();
    private devicePrograms: DeviceProgram[] = [];
    private particleProgram: DeviceProgram;
    private particleGfxProgram: GfxProgram;
    private gfxPrograms: GfxProgram[];
    private sortKeyAlpha: number;
    private sortKeyTranslucent: number;
    private sortKeySky: number;
    private postProcessing: NfsPostProcessing;
    private streamingFreezed: boolean = false;
    private showPanoramas: boolean = true;
    private showTrackBarriers: boolean = false;
    private showHidden: boolean = false;
    private enableParticles: boolean = true;
    private fogIntensity: number = 1.0;
    private usePostProcessing: boolean = true;

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

        this.postProcessing = new NfsPostProcessing(map, renderHelper);

        NfsParticleEmitter.init(this.renderHelper.renderCache);
        this.particleProgram = new NfsParticleProgram();
    }

    private fillSceneUniformBuffer(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPos: vec3) {
        let offs = template.allocateUniformBuffer(NfsProgram.ub_SceneParams, 24);
        const sceneParamsMapped = template.mapUniformBufferF32(NfsProgram.ub_SceneParams);
        const worldProjMatrix = mat4.create();
        mat4.mul(worldProjMatrix, viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x4(sceneParamsMapped, offs, worldProjMatrix);
        offs += fillVec4v(sceneParamsMapped, offs, [cameraPos[0], cameraPos[1], cameraPos[2], 0]);
        offs += fillVec4v(sceneParamsMapped, offs, [viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0, 0]);
    }

    private prepareToRender(viewerInput: ViewerRenderInput, cameraPos: vec3, instancesToRender: NfsInstance[]): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = renderInstManager.pushTemplate();

        // TODO(jstpierre): Why do I need to do this twice?
        this.fillSceneUniformBuffer(template, viewerInput, cameraPos);
        this.fillSceneUniformBuffer(template, viewerInput, cameraPos);

        const layer = GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        template.setGfxProgram(this.gfxPrograms[0]);
        instancesToRender.forEach(instance => {
            if(instance.worldMatrix === undefined)
                return;
            if(instance.type === InstanceType.TrackBarrier && !this.showTrackBarriers)
                return;
            if(instance.type === InstanceType.Hidden && !this.showHidden)
                return;
            const model = instance.model;
            if(model === undefined)
                return;
            model.vertInfos.forEach(vInfo => {
                template.setVertexInput(vInfo.inputLayout, vInfo.vertexBufferDescriptors, vInfo.indexBufferDescriptor);
                let offs = template.allocateUniformBuffer(NfsProgram.ub_ObjectParams, 16);
                const d = template.mapUniformBufferF32(NfsProgram.ub_ObjectParams);
                const renderInst = renderInstManager.newRenderInst();
                offs += fillMatrix4x3(d, offs, instance.worldMatrix);

                let cullMode = GfxCullMode.Back;
                if(vInfo.shaderType === 5 || vInfo.shaderType === 6 || !vInfo.textureMappings[0].faceCulling)
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
                if(instance.type === InstanceType.Sky) {
                    renderInst.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false});
                    renderInst.setGfxProgram(this.gfxPrograms[5]);
                    renderInst.sortKey = this.sortKeySky;
                }
                else if(diffuseTexture.transparencyType > 0) {
                    if(instance.type !== InstanceType.Shadow) {
                        renderInst.sortKey = this.sortKeyTranslucent;
                        instance.boundingBox.centerPoint(this.aabbCenter);
                        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera.viewMatrix, this.aabbCenter);
                        renderInst.sortKey = setSortKeyDepth(this.sortKeyTranslucent, depth);
                    }
                    else {
                        renderInst.sortKey = this.sortKeyTranslucent;
                    }
                    if(diffuseTexture.transparencyType === 1) {
                         renderInst.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false});
                    }
                    if(diffuseTexture.transparencyType === 2) {
                        renderInst.setMegaStateFlags({attachmentsState: attachmentStatesAdditive, depthWrite: false});
                        fog = 0;
                    }
                    else if(diffuseTexture.transparencyType === 3) {
                        renderInst.setMegaStateFlags({attachmentsState: attachmentStatesSubtractive, depthWrite: false});
                    }
                }
                else if(diffuseTexture.alphaTest) {
                    renderInst.setGfxProgram(this.gfxPrograms[1]);
                    renderInst.sortKey = this.sortKeyAlpha;
                }
                else if(vInfo.shaderType === 1 || vInfo.shaderType === 3)
                    renderInst.setGfxProgram(this.gfxPrograms[3]);
                else if(vInfo.shaderType === 5)
                    renderInst.setGfxProgram(this.gfxPrograms[4]);

                if(diffuseTexture.scrollAnimation !== undefined) {
                    const anim = diffuseTexture.scrollAnimation;
                    const animFactor = anim.interval === -1 ? viewerInput.time / 1000 : Math.floor(viewerInput.time / anim.interval / 1000);
                    fillVec4v(d, offs, [(anim.scrollSpeed[0] * animFactor) % 1, (anim.scrollSpeed[1] * animFactor) % 1, fog, 0]);
                }
                else if(instance.type === InstanceType.Sky) {
                    fillVec4v(d, offs, [(viewerInput.time / 70000) % 5.0, 0, 0, 0]);
                }
                else {
                    fillVec4v(d, offs, [0, 0, fog, 0]);
                }

                // Use the diffuse sampler state for all textures
                for(let i = 1; i < texMappings.length; i++) {
                    if(texMappings[i] !== undefined)
                        texMappings[i].gfxSampler = texMappings[0].gfxSampler;
                }
                renderInst.setSamplerBindingsFromTextureMappings(texMappings);
                renderInst.setDrawCount(vInfo.drawCall.indexCount, vInfo.drawCall.indexOffset);
                this.renderInstListMain.submitRenderInst(renderInst);
            });
        });

        renderInstManager.popTemplate();
    }

    private prepareToRenderParticles(viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager, activeEmitters: NfsParticleEmitterGroup[]) {
        const template = renderInstManager.pushTemplate();
        template.setGfxProgram(this.particleGfxProgram);
        template.setMegaStateFlags({attachmentsState: attachmentStatesTranslucent, depthWrite: false, cullMode: GfxCullMode.None});
        template.setVertexInput(NfsParticleEmitter.inputLayout, NfsParticleEmitter.vertexBufferDescriptors, NfsParticleEmitter.indexBufferDescriptor);
        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 1 }]);
        template.setDrawCount(6);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        let offs = template.allocateUniformBuffer(NfsParticleProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(NfsParticleProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        activeEmitters.forEach(e => e.prepareToRender(renderInstManager, this.renderInstListMain, viewerInput));

        renderInstManager.popTemplate();
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

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer, scope) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        let finalImage = mainColorTargetID;

        if (this.usePostProcessing)
            finalImage = this.postProcessing.render(builder, this.renderHelper, viewerInput, mainColorTargetID);

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, finalImage, viewerInput.mouseLocation);

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, finalImage);
        builder.resolveRenderTargetToExternalTexture(finalImage, viewerInput.onscreenTexture);

        const cameraPos: vec3 = [viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[13], viewerInput.camera.worldMatrix[14]];

        if(!this.streamingFreezed || this.closestPathVertex === null) {
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
            if(region.regionType === RegionType.Panorama && !this.activeRegion.ensureReady(device, this.renderHelper, this.map))
                return;
            if(!region.ensureReady(device, this.renderHelper, this.map))
                return;
            if(!this.showPanoramas && region.regionType === RegionType.Panorama)
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

        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 3 }]);
        this.prepareToRender(viewerInput, cameraPos, instancesToRender);
        if (this.enableParticles)
            this.prepareToRenderParticles(viewerInput, renderInstManager, regionsToRender.flatMap(r => r.region.emitterGroups));
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();

        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();

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
        fogSlider.setRange(0, 1, 0.1);
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

layout(std140, row_major) uniform ub_SceneParams {
    mat4 u_WorldProjMat;
    vec4 u_CameraPos;
    vec2 u_ViewportSize;
};

layout(std140, row_major) uniform ub_ObjectParams {
    mat4x3 u_ObjectWorldMat;
    vec2 u_uvOffset;
    float u_FogIntensity;
};

layout(binding=0) uniform sampler2D u_Diffuse;
layout(binding=1) uniform sampler2D u_Normal;
layout(binding=2) uniform sampler2D u_Specular;

#define FogSunFalloff 0.0
#define FogInLightScatter 10.0
#define FogSkyColor vec3(0.27, 0.46, 1.0)
#define FogSkyColorScale 1.0
#define FogHazeColor vec3(0.18, 0.24, 0.37)
#define FogHazeColorScale 0.1
#define AmbientColor vec4(0.19, 0.24, 0.32, 4.0)
#define DiffuseColor vec4(1.0, 0.8, 0.3, 1.0)
#define SpecularColor vec3(0.32, 0.28, 0.22)
#define FogDistanceScale 4.0
#define SunDirection normalize(-vec3(0.565, -0.324, 0.7588))
#define CloudIntensity 0.33
#define SpecularPower 11.0

#define ShadowRange 2000.0
#define ShadowBias 0.001

#define PI 3.14159265
#define FOUR_PI (4.0 * PI)
#define THREE_OVER_16_PI (3.0 / (16.0 * PI))

${GfxShaderLibrary.MulNormalMatrix}
${GfxShaderLibrary.saturate}

vec3 toGameWorldSpace(vec3 v) {
    vec3 c = v.xzy;
    c.x = -c.x;
    return c;
}

vec3 toTangentSpace(vec3 v, vec3 tangent, vec3 bitangent, vec3 normal) {
    return vec3(dot(tangent, v), dot(bitangent, v),  dot(normal, v));
}

vec3 calcScatterCoefficient(vec3 vecToEye, vec3 Br, vec3 Bm, vec3 extinction) {
    float cosTheta = dot(normalize(-SunDirection), normalize(vecToEye));
    float g = FogSunFalloff;
    float hazeScattering = pow(1.0 - g, 2.0) / (FOUR_PI * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
    float airScattering = THREE_OVER_16_PI * (1.0 + cosTheta * cosTheta);
    vec3 scatterCoeff = (Br * airScattering + Bm * hazeScattering) / (Br + Bm);
    return saturate(scatterCoeff * (1.0 - extinction) * FogInLightScatter);
}
`;

    public override vert = `
layout(location = ${NfsProgram.a_Position}) in vec3 a_Position;
layout(location = ${NfsProgram.a_UV}) in vec2 a_UV;
layout(location = ${NfsProgram.a_Color}) in vec4 a_Color;
layout(location = ${NfsProgram.a_Normal}) in vec3 a_Normal;
#ifdef NORMALMAP
layout(location = ${NfsProgram.a_Tangent}) in vec3 a_Tangent;
#endif

out vec2 v_UV0;
out vec2 v_UV1;
out vec3 v_Ambient;
out vec3 v_Diffuse;
out vec3 v_Scatter;
out vec3 v_Extinction;
out vec3 v_TangentLightVec;
out vec3 v_TangentEyeVec;
out float v_Gloss;
out float v_Alpha;

void main() {
    vec3 worldPos = u_ObjectWorldMat * vec4(a_Position, 1.0);
    gl_Position = u_WorldProjMat * vec4(worldPos, 1.0);
    vec3 worldPosGame = toGameWorldSpace(worldPos);

    vec3 cameraPosWorld = toGameWorldSpace(u_CameraPos.xyz);
    vec3 vecToEye = cameraPosWorld - worldPosGame;
    vec3 normal = toGameWorldSpace(MulNormalMatrix(u_ObjectWorldMat, a_Normal));
#ifdef NORMALMAP
    vec3 tangent = toGameWorldSpace(u_ObjectWorldMat * vec4(a_Tangent, 0.0));
    vec3 bitangent = normalize(cross(normal, tangent));

    vec3 tangentLightVec = toTangentSpace(-SunDirection, tangent, bitangent, normal);
    v_TangentLightVec = normalize(tangentLightVec);

    vec3 tangentEyeVec = toTangentSpace(vecToEye, tangent, bitangent, normal);
    v_TangentEyeVec = normalize(tangentEyeVec);
#endif

#ifdef SKY
    v_UV0 = a_UV;
    v_UV0.x -= 0.4 * u_uvOffset.x;
    v_UV1 = a_UV;
    v_UV1.x -= 0.2 * u_uvOffset.x + 0.3;
#else
    v_UV0 = a_UV.xy + u_uvOffset;       // no offset for GLOSSY
#endif

#ifdef GLOSSYWINDOW
    vec3 reflectedVec = reflect(-SunDirection, normal);
    v_Gloss = pow(saturate(dot(-reflectedVec, normalize(vecToEye))), 10.0);
#endif

    vec3 BetaRayleigh = FogSkyColor * 0.0001 * (1.0 + 0.99 * FogSkyColorScale);
    vec3 BetaMie = FogHazeColor * 0.0001 * (1.0 + 0.99 * FogHazeColorScale);

#ifdef SKY
    float fogValue = 15000.0;
#else
    float fogValue = length(vecToEye) * FogDistanceScale;
    fogValue = clamp(fogValue, 0.0, 2500.0) * u_FogIntensity;
#endif

    vec3 extinction = exp(fogValue * -(BetaRayleigh + BetaMie));
    v_Scatter = calcScatterCoefficient(vecToEye, BetaRayleigh, BetaMie, extinction);
    v_Extinction = min(extinction, 1.0);
    v_Ambient = AmbientColor.a * AmbientColor.rgb * a_Color.bgr;
    float lightAmount = saturate(dot(-SunDirection, normal));
    v_Diffuse = lightAmount * DiffuseColor.rgb;
    v_Alpha = a_Color.a;
}
`;
    public override frag = `
in vec2 v_UV0;
in vec2 v_UV1;
in vec3 v_Ambient;
in vec3 v_Diffuse;
in vec3 v_Scatter;
in vec3 v_Extinction;
in vec3 v_TangentLightVec;
in vec3 v_TangentEyeVec;
in float v_Gloss;
in float v_Alpha;

void main() {
    vec3 finalColor = vec3(0.0);
    vec4 diffuseTexVal = texture(SAMPLER_2D(u_Diffuse), v_UV0);

#ifdef SKY
    float diffuseTexValA = diffuseTexVal.r;
    float diffuseTexValC = texture(SAMPLER_2D(u_Diffuse), v_UV1).r;

    float diffAlphaA = diffuseTexValA;
    float diffAlphaC = diffuseTexValC;

    float cloudStrength = diffAlphaA * diffAlphaC * CloudIntensity * 2.0;
    float clouds = (1.0 + diffuseTexValA) / 2.0;
    gl_FragColor.rgb = cloudStrength * clouds + (1.0 - cloudStrength) * v_Scatter;
    gl_FragColor.a = 1.0;
    return;
#endif

#ifdef NORMALMAP
    vec3 normalTexVal = texture(SAMPLER_2D(u_Normal), v_UV0).rgb;
    normalTexVal = normalize(2.0 * normalTexVal - 1.0);
    vec3 specularTexVal = 2.0 * texture(SAMPLER_2D(u_Specular), v_UV0).rgb;
    vec3 tangentLightVec = normalize(v_TangentLightVec);
    vec3 tangentEyeVec = normalize(v_TangentEyeVec);

    vec3 reflectedLightVec = reflect(-tangentLightVec, normalTexVal);
    float specularity = saturate(dot(reflectedLightVec, tangentEyeVec));
    vec3 specular = pow(specularity, SpecularPower) * SpecularColor.rgb * specularTexVal;
    finalColor += specular * v_Extinction.xyz;

    float lightAmount = saturate(dot(normalTexVal, tangentLightVec));
    vec3 diffuse = lightAmount * DiffuseColor.rgb;
    diffuse *= v_Extinction.xyz;
#else
    vec3 diffuse = v_Diffuse;
#endif

    float alpha = diffuseTexVal.a * v_Alpha;
#ifdef ALPHA_TEST
    if(alpha <= 0.375)
        discard;
#endif

    finalColor += diffuseTexVal.rgb * (v_Ambient * v_Extinction + diffuse);
    finalColor *= 2.0;
    finalColor += v_Scatter;

#ifdef GLOSSYWINDOW
    vec4 reflectedTexVal = texture(SAMPLER_2D(u_Normal), v_UV0 + 0.5);
    finalColor += diffuseTexVal.a * (4.0 * v_Gloss + reflectedTexVal.rgb);
    alpha = diffuseTexVal.a;
#endif

    gl_FragColor.rgb = finalColor;
    gl_FragColor.a = alpha;
}
`;
}
