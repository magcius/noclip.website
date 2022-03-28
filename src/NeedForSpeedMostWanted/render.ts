import { mat4, vec3 } from "gl-matrix";
import { CameraController, computeViewMatrix } from "../Camera";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxAttachmentState, GfxBlendFactor, GfxBlendMode, GfxChannelWriteMask, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputState, GfxProgram, GfxSamplerBinding } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot, GfxrRenderTargetID, GfxrResolveTextureID} from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInst, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { InstanceType, NfsInstance, NfsRegion,  NfsTexture, RegionType } from "./region";
import { fillMatrix4x3, fillMatrix4x4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import * as UI from '../ui';
import { NfsMap, PathVertex } from "./map";
import { TextureMapping } from "../TextureHolder";

export interface VertexInfo {
    inputLayout: GfxInputLayout;
    inputState: GfxInputState;
    drawCall: DrawCall;
    textureMappings: NfsTexture[];
}

interface DrawCall {
    indexOffset: number;
    indexCount: number;
}

export class NfsRenderer implements SceneGfx {

    private map: NfsMap;
    private activeRegion: NfsRegion;
    private renderHelper: GfxRenderHelper;
    private devicePrograms: DeviceProgram[] = [];
    private gfxPrograms: GfxProgram[];
    private sortKeyAlpha: number;
    private sortKeyTranslucent: number;
    private sortKeySky: number;
    private attachmentStatesTranslucent: GfxAttachmentState[] = [{
        alphaBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.Zero, blendSrcFactor: GfxBlendFactor.One},
        channelWriteMask: GfxChannelWriteMask.AllChannels,
        rgbBlendState: {blendMode: GfxBlendMode.Add, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha, blendSrcFactor: GfxBlendFactor.SrcAlpha}
    }];
    private streamingFreezed: boolean = false;
    private showPanoramas: boolean = true;
    private showShadows: boolean = true;
    private showTrackBarriers: boolean = false;
    private showHidden: boolean = false;
    private useSpecular: boolean = true;
    private shadowsSupported: boolean;
    private closestPathVertex: PathVertex;
    private shadowPassTexture: TextureMapping = new TextureMapping();

    constructor(map: NfsMap, device: GfxDevice, renderHelper: GfxRenderHelper) {
        this.map = map;
        this.renderHelper = renderHelper;
        for(let i = 0; i < 7; i++) {
            this.devicePrograms.push(new NfsProgram());
        }
        this.devicePrograms[1].defines.set("ALPHA_TEST", "1");
        this.devicePrograms[2].defines.set("TRANSLUCENT_GRAYSCALE", "1");
        this.devicePrograms[3].defines.set("NORMALMAP", "1");
        this.devicePrograms[4].defines.set("NORMALMAP", "1");
        this.devicePrograms[4].defines.set("SPECULAR", "1");
        this.devicePrograms[5].defines.set("SHADOW", "1");
        this.devicePrograms[6].defines.set("SKY", "1");
        this.shadowsSupported = device.queryTextureFormatSupported(GfxFormat.U16_RG_NORM, 0, 0);
        this.showShadows = this.shadowsSupported;
    }

    private fillSceneUniformBuffer(template: GfxRenderInst, viewerInput: ViewerRenderInput, cameraPos: vec3) {
        let offs = template.allocateUniformBuffer(NfsProgram.ub_SceneParams, 36);
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

        template.setGfxProgram(this.gfxPrograms[5]);
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

        // No backface culling for now because I can't figure out which objects should have it enabled and which don't
        template.setMegaStateFlags({depthWrite: true, cullMode: GfxCullMode.None});

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
                let texMappings: GfxSamplerBinding[] = vInfo.textureMappings.slice();
                const diffuseTexture: NfsTexture = texMappings[0] as NfsTexture;
                if(diffuseTexture.cycleAnimation != undefined) {
                    const anim = diffuseTexture.cycleAnimation;
                    const frameNumber = Math.floor(viewerInput.time * anim.frequency / 1000) % anim.frames.length;
                    texMappings[0] = anim.frames[frameNumber];
                }
                if(instance.type == InstanceType.Sky) {
                    renderInst.setMegaStateFlags({attachmentsState: this.attachmentStatesTranslucent, depthWrite: false});
                    renderInst.setGfxProgram(this.gfxPrograms[6]);
                    renderInst.sortKey = this.sortKeySky;
                }
                else if(diffuseTexture.transparencyType > 0) {
                    renderInst.setMegaStateFlags({attachmentsState: this.attachmentStatesTranslucent, depthWrite: false});
                    renderInst.sortKey = this.sortKeyTranslucent;
                    if(diffuseTexture.transparencyType >= 2) {
                        renderInst.setGfxProgram(this.gfxPrograms[2]);
                    }
                }
                else if(diffuseTexture.alphaTest) {
                    renderInst.setGfxProgram(this.gfxPrograms[1]);
                    renderInst.sortKey = this.sortKeyAlpha;
                }
                else if(vInfo.textureMappings.length > 1) {
                    if(this.useSpecular) {
                        renderInst.setGfxProgram(this.gfxPrograms[4]);
                    }
                    else {
                        renderInst.setGfxProgram(this.gfxPrograms[3]);
                        texMappings = [texMappings[0], texMappings[1]];
                    }
                }
                if(diffuseTexture.scrollAnimation != undefined) {
                    const anim = diffuseTexture.scrollAnimation;
                    const animFactor = anim.interval == -1 ? viewerInput.time / 1000 : Math.floor(viewerInput.time / anim.interval / 1000);
                    fillVec4v(d, offs, [(anim.scrollSpeed[0] * animFactor) % 1, (anim.scrollSpeed[1] * animFactor) % 1, 0, 0]);
                }
                else {
                    fillVec4v(d, offs, [0, 0, 0, 0]);
                }
                texMappings[3] = this.shadowPassTexture;
                renderInst.setSamplerBindingsFromTextureMappings(texMappings);
                renderInst.drawIndexes(vInfo.drawCall.indexCount, vInfo.drawCall.indexOffset);
                renderInstManager.submitRenderInst(renderInst);
            });
        });

        this.renderHelper.prepareToRender();
        renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        viewerInput.camera.setClipPlanes(0.05);
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
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        const cameraPos: vec3 = [-viewerInput.camera.worldMatrix[12], viewerInput.camera.worldMatrix[14], viewerInput.camera.worldMatrix[13]];

        if(!this.streamingFreezed || this.closestPathVertex == null) {
            this.closestPathVertex = this.map.getClosestPathVertex([cameraPos[0], cameraPos[1]]);
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
        this.sortKeyAlpha = makeSortKey(GfxRendererLayer.ALPHA_TEST);
        this.sortKeyTranslucent = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        this.sortKeySky = makeSortKey(GfxRendererLayer.BACKGROUND);

        const template = this.renderHelper.pushTemplateRenderInst();
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

        const freezeStreamingCheckbox = new UI.Checkbox('Freeze world streaming', false);
        freezeStreamingCheckbox.onchanged = () => {
            this.streamingFreezed = !this.streamingFreezed;
        };
        renderHacksPanel.contents.appendChild(freezeStreamingCheckbox.elem);

        const showPanoramas = new UI.Checkbox('Show panoramas', true);
        showPanoramas.onchanged = () => {
            this.showPanoramas = !this.showPanoramas;
        };
        renderHacksPanel.contents.appendChild(showPanoramas.elem);

        if(this.shadowsSupported) {
            const showShadows = new UI.Checkbox('Show shadows', true);
            showShadows.onchanged = () => {
                this.showShadows = !this.showShadows;
            };
            renderHacksPanel.contents.appendChild(showShadows.elem);
        }

        const showTrackBarriers = new UI.Checkbox('Show track barriers', false);
        showTrackBarriers.onchanged = () => {
            this.showTrackBarriers = !this.showTrackBarriers;
        };
        renderHacksPanel.contents.appendChild(showTrackBarriers.elem);

        const showHidden = new UI.Checkbox('Show hidden objects', false);
        showHidden.onchanged = () => {
            this.showHidden = !this.showHidden;
        };
        renderHacksPanel.contents.appendChild(showHidden.elem);

        const useSpecular = new UI.Checkbox('Enable specular shading', true);
        useSpecular.onchanged = () => {
            this.useSpecular = !this.useSpecular;
        };
        renderHacksPanel.contents.appendChild(useSpecular.elem);

        return [renderHacksPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.map.destroy(device);
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
    public static ub_DrawParams = 2;

    public static both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_WorldProjMat;
    vec4 u_CameraPos;
    vec2 u_ViewportSize;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ObjectWorldMat;
    vec4 u_uvOffset;
};

uniform sampler2D u_Texture;
uniform sampler2D u_Normal;
uniform sampler2D u_Specular;
uniform sampler2D u_Shadow;

#define u_ShadowRange 2000.0
#define u_ShadowBias 0.001
#define u_SkyColor vec3(0.54, 0.64, 0.69)
#define u_SunDirection normalize(vec3(0.665, -0.445, 0.6))
#define u_CloudIntensity 0.18
#define u_SpecularColor vec3(1.0, 0.85, 0.75)
    `;

    public override both = NfsProgram.both;

    public override vert = `
layout(location = ${NfsProgram.a_Position}) in vec3 a_Position;
layout(location = ${NfsProgram.a_UV}) in vec2 a_UV;
layout(location = ${NfsProgram.a_Color}) in vec4 a_Color;
layout(location = ${NfsProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${NfsProgram.a_Tangent}) in vec3 a_Tangent;

out vec4 v_Color;
out vec3 v_Normal;
out vec2 v_TexCoord;
out vec3 v_ViewDir;
#ifdef NORMALMAP
out vec3 v_Tangent;
out vec3 v_Bitangent;
#endif

void main() {
    vec4 worldPos = vec4(Mul(u_ObjectWorldMat, vec4(a_Position, 1.0)), 1.0);
    v_ViewDir = normalize(u_CameraPos.xyz - worldPos.xyz);
    worldPos = worldPos.xzyw;
    worldPos.x *= -1.0;
    gl_Position = Mul(u_WorldProjMat, worldPos);
    v_TexCoord = a_UV + u_uvOffset.xy;

#ifdef SKY
    float sunAngle = dot(u_SunDirection, v_ViewDir);
    v_Color.rgb = clamp(u_SkyColor * (sunAngle * sunAngle + 1.0), 0.0, 1.0);
#else
    v_Normal = normalize(Mul(u_ObjectWorldMat, vec4(a_Normal, 0.0)).xyz);
    v_Color.rgb = 3.0 * a_Color.bgr + 0.1;
    v_Color.a = a_Color.a;
#ifdef NORMALMAP
    v_Tangent = normalize(Mul(u_ObjectWorldMat, vec4(a_Tangent, 0.0)).xyz);
    v_Bitangent = cross(v_Normal, v_Tangent);
#endif
#endif
}
`;
    public override frag = `
in vec4 v_Color;
in vec2 v_TexCoord;
in vec3 v_ViewDir;
in vec3 v_Normal;
#ifdef NORMALMAP
in vec3 v_Tangent;
in vec3 v_Bitangent;
#endif

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);

#ifdef SKY
    vec3 baseColor = (1.0 - u_CloudIntensity) * v_Color.xyz;
    gl_FragColor.xyz = (gl_FragColor.rrr) * u_CloudIntensity + baseColor;
    gl_FragColor.a = 1.0;
#else

#ifdef SHADOW
    float linearDepth = 1.0 - (2.0 * gl_FragCoord.z - 1.0) / (1.0 - u_ShadowRange) / gl_FragCoord.w;
    gl_FragColor.xy = vec2(linearDepth, 1.0 - (gl_FragColor.a * v_Color.a * 0.7 * clamp(linearDepth * 10.0, 0.0, 1.0)));
    return;
#endif

#ifdef ALPHA_TEST
    if(gl_FragColor.a < 0.375)
        discard;
#endif
#ifdef TRANSLUCENT_GRAYSCALE
    gl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.b, gl_FragColor.g));
#endif
    gl_FragColor.rgb *= v_Color.rgb;

    vec3 devCoords = gl_FragCoord.xyz / vec3(u_ViewportSize.x, -u_ViewportSize.y, 1.0) * vec3(1.0, -1.0, 1.0);
    vec4 shadow = texture(SAMPLER_2D(u_Shadow), devCoords.xy);
    float depth = (2.0 * gl_FragCoord.w - 1.0) / (1.0 - u_ShadowRange);
    depth = 1.0 - depth / gl_FragCoord.w;
    float lightAmount = 1.0;
    bool isInShadow = depth <= shadow.x + u_ShadowBias && shadow.x > 0.0;
    if(isInShadow) {
        lightAmount = shadow.y;
    }
    gl_FragColor.rgb *= lightAmount;

    vec4 normal = vec4(v_Normal, 1.0);

#ifdef NORMALMAP
    vec3 texNormal = 5.0 * (texture(SAMPLER_2D(u_Normal), v_TexCoord).rgb * 2.0 - vec3(1.0));
    normal.xyz = normalize(texNormal.y * v_Tangent + texNormal.x * v_Bitangent + texNormal.z * v_Normal);
#endif
#ifdef SPECULAR
    vec3 reflectVec = -v_ViewDir.xyz - 2.0 * normal.xyz * dot(-v_ViewDir.xyz, normal.xyz);
    float specularAmount = (max(0.9, dot(normalize(reflectVec), normalize(u_SunDirection))) - 0.9) * 5.0 * texture(SAMPLER_2D(u_Specular), v_TexCoord).r;
    specularAmount = max(0.0, specularAmount * (lightAmount - 0.6) * (1.0 / (0.4)));
    gl_FragColor.rgb += specularAmount * u_SpecularColor;
#endif

    gl_FragColor.rgb += 0.05 * clamp(dot(normal.xyz, normalize(u_SunDirection)), 0.0, 1.0);
    gl_FragColor.a *= v_Color.a;
#endif
}
`;
}