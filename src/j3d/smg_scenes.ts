
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { assert, nArray } from '../util';
import { fetchData } from '../fetch';

import {  DeviceProgram } from '../Program';
import * as Viewer from '../viewer';

import { BMDModel, BMDModelInstance, J3DTextureHolder } from './render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { TextureOverride, TextureMapping } from '../TextureHolder';

import * as RARC from './rarc';
import * as Yaz0 from '../compression/Yaz0';
import * as BCSV from '../luigis_mansion/bcsv';
import * as UI from '../ui';
import { mat4, quat } from 'gl-matrix';
import { BMD, BRK, BTK, BCK } from './j3d';
import { GfxBlendMode, GfxBlendFactor, GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxRenderTarget, GfxRenderPassDescriptor, GfxLoadDisposition } from '../gfx/platform/GfxPlatform';
import AnimationController from '../AnimationController';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxRenderInstViewRenderer, GfxRenderInst, GfxRenderInstBuilder } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor, PostFXRenderTarget, ColorAttachment, DepthStencilAttachment, DEFAULT_NUM_SAMPLES } from '../gfx/helpers/RenderTargetHelpers';
import { TransparentBlack } from '../Color';

const materialHacks: GXMaterialHacks = {
    alphaLightingFudge: (p) => p.matSource,
};

// Should I try to do this with GX? lol.
class FullscreenBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
out vec2 v_TexCoord;
uniform sampler2D u_Texture;
`;

    public static programReflection = DeviceProgram.parseReflectionDefinitions(FullscreenBaseProgram.BindingsDefinition); 

    public vert: string = `
${FullscreenBaseProgram.BindingsDefinition}
void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
    v_TexCoord = p;
}
`;
}

class FullscreenCopyProgram extends FullscreenBaseProgram {
    public frag: string = `
in vec2 v_TexCoord;

uniform sampler2D u_Texture;

void main() {
    gl_FragColor = texture(u_Texture, v_TexCoord);
}
`;
}

class BloomPassBlurProgram extends FullscreenBaseProgram {
    public frag: string = `
in vec2 v_TexCoord;

uniform sampler2D u_Texture;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    // Nintendo does this in two separate draws. We combine into one here...
    vec3 c = vec3(0.0);
    // Pass 1.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00562, -1.0 *  0.00000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 * -0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 * -0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00562, -1.0 *  0.00000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00281, -1.0 *  0.00866)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00281, -1.0 *  0.00866)).rgb * 0.15686);
    // Pass 2.
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00977, -1.0 * -0.00993)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00004, -1.0 * -0.02000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00972, -1.0 * -0.01006)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00976, -1.0 *  0.00993)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00004, -1.0 *  0.02000)).rgb * 0.15686);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00972, -1.0 *  0.01006)).rgb * 0.15686);
    gl_FragColor = vec4(c.rgb, 1.0);
}
`;
}

class BloomPassBokehProgram extends FullscreenBaseProgram {
    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

vec3 TevOverflow(vec3 a) { return fract(a*(255.0/256.0))*(256.0/255.0); }
void main() {
    vec3 f = vec3(0.0);
    vec3 c;

    // TODO(jstpierre): Double-check these passes. It seems weighted towards the top left. IS IT THE BLUR???

    // Pass 1.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02250, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01949, -1.0 * -0.02000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 * -0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.04000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 * -0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01948, -1.0 * -0.02001)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02250, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01949, -1.0 *  0.02000)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 2.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01125, -1.0 *  0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.00000, -1.0 *  0.04000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01125, -1.0 *  0.03464)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01948, -1.0 *  0.02001)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 3.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03937, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03410, -1.0 * -0.03499)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01970, -1.0 * -0.06061)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.07000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01968, -1.0 * -0.06063)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03409, -1.0 * -0.03502)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03937, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.03410, -1.0 *  0.03499)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 4.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.01970, -1.0 *  0.06061)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.07000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.01968, -1.0 *  0.06063)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.03409, -1.0 *  0.03502)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 5.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2(-0.05063, -1.0 *  0.00000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04385, -1.0 * -0.04499)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02532, -1.0 * -0.07793)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 * -0.09000)).rgb) * 0.23529;
    f += TevOverflow(c);
    // Pass 6.
    c = vec3(0.0);
    c += (texture(u_Texture, v_TexCoord + vec2( 0.02532, -1.0 *  0.07793)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2( 0.00000, -1.0 *  0.09000)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.02531, -1.0 *  0.07795)).rgb) * 0.23529;
    c += (texture(u_Texture, v_TexCoord + vec2(-0.04384, -1.0 *  0.04502)).rgb) * 0.23529;
    f += TevOverflow(c);

    f = clamp(f, 0.0, 1.0);

    // Combine pass.
    vec3 g;
    g = (texture(u_Texture, v_TexCoord).rgb * 0.43137);
    g += f * 0.43137;

    gl_FragColor = vec4(g, 1.0);
}
`;
}

const enum SceneGraphTag {
    Skybox = 'Skybox',
    Normal = 'Normal',
    Bloom = 'Bloom',
    Water = 'Water',
    Indirect = 'Indirect',
}

class SceneGraph {
    public nodes: BMDModelInstance[] = [];
    public nodeTags: string[][] = [];
    public onnodeadded: (node: BMDModelInstance, i: number) => void | null = null;

    public hasTag(tag: string): boolean {
        return this.nodeTags.some((tags) => tags.includes(tag));
    }

    public nodeHasTag(i: number, tag: string): boolean {
        return this.nodeTags[i].includes(tag);
    }

    public forTag(tag: string, cb: (node: BMDModelInstance, i: number) => void): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const nodeTags = this.nodeTags[i];
            if (nodeTags.includes(tag))
                cb(this.nodes[i], i);
        }
    }

    public addNode(node: BMDModelInstance | null, tags: string[]): void {
        if (node === null)
            return;
        this.nodes.push(node);
        this.nodeTags.push(tags);
        const i = this.nodes.length - 1;
        if (this.onnodeadded !== null)
            this.onnodeadded(node, i);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].destroy(device);
    }
}

function makeFullscreenPassRenderInstBuilder(device: GfxDevice) {
    const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 0, numSamplers: 1 }];
    return new GfxRenderInstBuilder(device, FullscreenBaseProgram.programReflection, bindingLayouts, []);
}

function makeFullscreenPassRenderInst(renderInstBuilder: GfxRenderInstBuilder, name: string, program: GfxProgram): GfxRenderInst {
    const renderInst = renderInstBuilder.pushRenderInst();
    renderInst.drawTriangles(3);
    renderInst.name = name;
    renderInst.gfxProgram = program;
    renderInst.inputState = null;
    renderInst.samplerBindings = [null];
    renderInst.setMegaStateFlags(fullscreenMegaState);
    return renderInst;
}

const TIME_OF_DAY_ICON = `<svg viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;

function getZoneLayerFilterTag(zoneName: string, layerIndex: number): string {
    return `${zoneName}_${getLayerName(layerIndex)}`;
}

const enum SMGPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    BLOOM = 1 << 3,

    BLOOM_DOWNSAMPLE = 1 << 4,
    BLOOM_BLUR = 1 << 5,
    BLOOM_BOKEH = 1 << 6,
    BLOOM_COMBINE = 1 << 7,
}

export class WeirdFancyRenderTarget {
    public gfxRenderTarget: GfxRenderTarget | null = null;
    public colorAttachment = new ColorAttachment();

    constructor(public depthStencilAttachment: DepthStencilAttachment) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        const colorChanged = this.colorAttachment.setParameters(device, width, height, numSamples);
        if (colorChanged) {
            this.destroyInternal(device);
            this.gfxRenderTarget = device.createRenderTarget({
                colorAttachment: this.colorAttachment.gfxColorAttachment,
                depthStencilAttachment: this.depthStencilAttachment.gfxDepthStencilAttachment,
            });
        }
    }

    private destroyInternal(device: GfxDevice): void {
        if (this.gfxRenderTarget !== null) {
            device.destroyRenderTarget(this.gfxRenderTarget);
            this.gfxRenderTarget = null;
        }
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }
}

const bloomClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.CLEAR,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};

class SMGRenderer implements Viewer.SceneGfx {
    private sceneGraph: SceneGraph;
    public textureHolder: J3DTextureHolder

    // Bloom stuff.
    private bloomRenderInstDownsample: GfxRenderInst;
    private bloomRenderInstBlur: GfxRenderInst;
    private bloomRenderInstBokeh: GfxRenderInst;
    private bloomRenderInstCombine: GfxRenderInst;

    private bloomSampler: GfxSampler;
    private bloomTextureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());
    private bloomSceneColorTarget: WeirdFancyRenderTarget;
    private bloomSceneColorTexture = new ColorTexture();
    private bloomScratch1ColorTarget = new PostFXRenderTarget();
    private bloomScratch1ColorTexture = new ColorTexture();
    private bloomScratch2ColorTarget = new PostFXRenderTarget();
    private bloomScratch2ColorTexture = new ColorTexture();

    private mainRenderTarget = new BasicRenderTarget();
    private opaqueSceneTexture = new ColorTexture();
    private currentScenarioIndex: number = 0;

    constructor(device: GfxDevice, private spawner: SMGSpawner, private viewRenderer: GfxRenderInstViewRenderer, private scenarioData: BCSV.Bcsv, private zoneNames: string[]) {
        this.sceneGraph = spawner.sceneGraph;
        this.textureHolder = spawner.textureHolder;

        this.sceneGraph.onnodeadded = (node: BMDModelInstance, i: number) => {
            this.applyCurrentScenario();
        };

        this.bloomSampler = device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.bloomTextureMapping[0].gfxSampler = this.bloomSampler;

        const renderInstBuilder = makeFullscreenPassRenderInstBuilder(device);
        this.bloomSceneColorTarget = new WeirdFancyRenderTarget(this.mainRenderTarget.depthStencilAttachment);
        this.bloomRenderInstDownsample = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom downsample', device.createProgram(new FullscreenCopyProgram()));
        this.bloomRenderInstDownsample.passMask = SMGPass.BLOOM_DOWNSAMPLE;

        this.bloomRenderInstBlur = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom blur', device.createProgram(new BloomPassBlurProgram()));
        this.bloomRenderInstBlur.passMask = SMGPass.BLOOM_BLUR;

        this.bloomRenderInstBokeh = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom bokeh', device.createProgram(new BloomPassBokehProgram()));
        this.bloomRenderInstBokeh.passMask = SMGPass.BLOOM_BOKEH;

        this.bloomRenderInstCombine = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom combine', device.createProgram(new FullscreenCopyProgram()));
        this.bloomRenderInstCombine.passMask = SMGPass.BLOOM_COMBINE;
        this.bloomRenderInstCombine.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        });

        renderInstBuilder.finish(device, this.viewRenderer);
    }

    private setZoneLayersVisible(zoneName: string, layerMask: number): void {
        for (let i = 0; i < 10; i++) {
            const visible = !!(layerMask & (1 << i));
            this.sceneGraph.forTag(getZoneLayerFilterTag(zoneName, i), (node) => {
                node.setVisible(visible);
            });
        }
    }

    private applyCurrentScenario(): void {
        const scenarioRecord = this.scenarioData.records[this.currentScenarioIndex];
        for (const zoneName of this.zoneNames) {
            const layerMask = BCSV.getField<number>(this.scenarioData, scenarioRecord, zoneName, 0);
            this.setZoneLayersVisible(zoneName, layerMask);
        }
    }

    public setCurrentScenario(index: number): void {
        this.currentScenarioIndex = index;
        this.applyCurrentScenario();
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(TIME_OF_DAY_ICON, 'Scenario');

        const scenarioNames = this.scenarioData.records.map((record) => {
            return BCSV.getField<string>(this.scenarioData, record, 'ScenarioName');
        });
        const scenarioSelect = new UI.SingleSelect();
        scenarioSelect.setStrings(scenarioNames);
        scenarioSelect.onselectionchange = (index: number) => {
            this.setCurrentScenario(index);
        };
        scenarioSelect.selectItem(0);

        scenarioPanel.contents.appendChild(scenarioSelect.elem);

        return [scenarioPanel];
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.spawner.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        const skyboxPassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SMGPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, opaquePassRenderer, SMGPass.OPAQUE);

        let lastPassRenderer: GfxRenderPass;
        if (this.viewRenderer.hasAnyVisible(SMGPass.INDIRECT)) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            const textureOverride: TextureOverride = { gfxTexture: this.opaqueSceneTexture.gfxTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("IndDummy", textureOverride);

            const indTexPassRenderer = device.createRenderPass(this.mainRenderTarget.gfxRenderTarget, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, indTexPassRenderer, SMGPass.INDIRECT);
            lastPassRenderer = indTexPassRenderer;
        } else {
            lastPassRenderer = opaquePassRenderer;
        }

        if (this.viewRenderer.hasAnyVisible(SMGPass.BLOOM)) {
            const bloomColorTargetScene = this.bloomSceneColorTarget;
            const bloomColorTextureScene = this.bloomSceneColorTexture;
            bloomColorTargetScene.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
            bloomColorTextureScene.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
            const bloomPassRenderer = device.createRenderPass(bloomColorTargetScene.gfxRenderTarget, bloomClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, bloomPassRenderer, SMGPass.BLOOM);
            bloomPassRenderer.endPass(bloomColorTextureScene.gfxTexture);
            device.submitPass(bloomPassRenderer);

            // Downsample.
            const bloomWidth = viewerInput.viewportWidth >> 2;
            const bloomHeight = viewerInput.viewportHeight >> 2;
            this.viewRenderer.setViewport(bloomWidth, bloomHeight);

            const bloomColorTargetDownsample = this.bloomScratch1ColorTarget;
            const bloomColorTextureDownsample = this.bloomScratch1ColorTexture;
            bloomColorTargetDownsample.setParameters(device, bloomWidth, bloomHeight, 1);
            bloomColorTextureDownsample.setParameters(device, bloomWidth, bloomHeight);
            this.bloomTextureMapping[0].gfxTexture = bloomColorTextureScene.gfxTexture;
            this.bloomRenderInstDownsample.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
            const bloomDownsamplePassRenderer = device.createRenderPass(bloomColorTargetDownsample.gfxRenderTarget, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, bloomDownsamplePassRenderer, SMGPass.BLOOM_DOWNSAMPLE);
            bloomDownsamplePassRenderer.endPass(bloomColorTextureDownsample.gfxTexture);
            device.submitPass(bloomDownsamplePassRenderer);

            // Blur.
            const bloomColorTargetBlur = this.bloomScratch2ColorTarget;
            const bloomColorTextureBlur = this.bloomScratch2ColorTexture;
            bloomColorTargetBlur.setParameters(device, bloomWidth, bloomHeight, 1);
            bloomColorTextureBlur.setParameters(device, bloomWidth, bloomHeight);
            this.bloomTextureMapping[0].gfxTexture = bloomColorTextureDownsample.gfxTexture;
            this.bloomRenderInstBlur.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
            const bloomBlurPassRenderer = device.createRenderPass(bloomColorTargetBlur.gfxRenderTarget, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, bloomBlurPassRenderer, SMGPass.BLOOM_BLUR);
            bloomBlurPassRenderer.endPass(bloomColorTextureBlur.gfxTexture);
            device.submitPass(bloomBlurPassRenderer);

            // TODO(jstpierre): Downsample blur / bokeh as well.

            // Bokeh-ify.
            // We can ditch the second render target now, so just reuse it.
            const bloomColorTargetBokeh = this.bloomScratch1ColorTarget;
            const bloomColorTextureBokeh = this.bloomScratch1ColorTexture;
            const bloomBokehPassRenderer = device.createRenderPass(bloomColorTargetBokeh.gfxRenderTarget, noClearRenderPassDescriptor);
            this.bloomTextureMapping[0].gfxTexture = bloomColorTextureBlur.gfxTexture;
            this.bloomRenderInstBokeh.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
            this.viewRenderer.executeOnPass(device, bloomBokehPassRenderer, SMGPass.BLOOM_BOKEH);
            bloomBokehPassRenderer.endPass(bloomColorTextureBokeh.gfxTexture);
            device.submitPass(bloomBokehPassRenderer);

            // Combine.
            this.bloomTextureMapping[0].gfxTexture = bloomColorTextureBokeh.gfxTexture;
            this.bloomRenderInstCombine.setSamplerBindingsFromTextureMappings(this.bloomTextureMapping);
            this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
            this.viewRenderer.executeOnPass(device, lastPassRenderer, SMGPass.BLOOM_COMBINE);
        }

        return lastPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.spawner.destroy(device);

        device.destroySampler(this.bloomSampler);
        this.bloomSceneColorTarget.destroy(device);
        this.bloomSceneColorTexture.destroy(device);
        this.bloomScratch1ColorTarget.destroy(device);
        this.bloomScratch1ColorTexture.destroy(device);
        this.bloomScratch2ColorTarget.destroy(device);
        this.bloomScratch2ColorTexture.destroy(device);
    }
}

function getLayerName(index: number) {
    if (index === -1) {
        return 'common';
    } else {
        assert(index >= 0);
        const char = String.fromCharCode('a'.charCodeAt(0) + index);
        return `layer${char}`;
    }
}

interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    rotateSpeed: number;
    rotateAccelType: number;
    modelMatrix: mat4;
}

interface ZoneLayer {
    index: number;
    objinfo: ObjInfo[];
    mappartsinfo: ObjInfo[];
    stageobjinfo: ObjInfo[];
}

interface Zone {
    name: string;
    layers: ZoneLayer[];
}

function computeModelMatrixFromRecord(modelMatrix: mat4, bcsv: BCSV.Bcsv, record: BCSV.BcsvRecord): void {
    const pos_x = BCSV.getField<number>(bcsv, record, 'pos_x', 0);
    const pos_y = BCSV.getField<number>(bcsv, record, 'pos_y', 0);
    const pos_z = BCSV.getField<number>(bcsv, record, 'pos_z', 0);
    const dir_x = BCSV.getField<number>(bcsv, record, 'dir_x', 0);
    const dir_y = BCSV.getField<number>(bcsv, record, 'dir_y', 0);
    const dir_z = BCSV.getField<number>(bcsv, record, 'dir_z', 0);
    const scale_x = BCSV.getField<number>(bcsv, record, 'scale_x', 1);
    const scale_y = BCSV.getField<number>(bcsv, record, 'scale_y', 1);
    const scale_z = BCSV.getField<number>(bcsv, record, 'scale_z', 1);
    const q = quat.create();
    quat.fromEuler(q, dir_x, dir_y, dir_z);
    mat4.fromRotationTranslationScale(modelMatrix, q, [pos_x, pos_y, pos_z], [scale_x, scale_y, scale_z]);
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

const pathBase = `data/j3d/smg`;

class YSpinAnimator {
    constructor(public animationController: AnimationController, public objinfo: ObjInfo) {
    }

    public calcModelMtx(dst: mat4, src: mat4): void {
        const time = this.animationController.getTimeInSeconds();
        // RotateSpeed appears to be deg/sec?
        const rotateSpeed = this.objinfo.rotateSpeed / (this.objinfo.rotateAccelType > 0 ? this.objinfo.rotateAccelType : 1);
        const speed = rotateSpeed * Math.PI / 180;
        mat4.rotateY(dst, src, time * speed);
    }
}

class ModelCache {
    public promiseCache = new Map<string, Progressable<BMDModel>>();
    public archiveCache = new Map<string, RARC.RARC>();

    public getModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, archiveName: string): Progressable<BMDModel> {
        if (this.promiseCache.has(archiveName))
            return this.promiseCache.get(archiveName);

        const p = fetchData(`${pathBase}/ObjectData/${archiveName}.arc`).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not spawn archive ${archiveName}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            if (buffer === null)
                return null;
            const rarc = RARC.parse(buffer);
            const lowerName = archiveName.toLowerCase();
            const bmd = rarc.findFileData(`${lowerName}.bdl`) !== null ? BMD.parse(rarc.findFileData(`${lowerName}.bdl`)) : null;
            const bmdModel = new BMDModel(device, renderHelper, bmd, null, materialHacks);
            textureHolder.addJ3DTextures(device, bmd);
            this.archiveCache.set(archiveName, rarc);
            return bmdModel;
        });

        this.promiseCache.set(archiveName, p);
        return p;
    }
}

class SMGSpawner {
    public textureHolder = new J3DTextureHolder();
    public sceneGraph = new SceneGraph();
    private modelCache = new ModelCache();

    constructor(private renderHelper: GXRenderHelperGfx, private viewRenderer: GfxRenderInstViewRenderer, private planetTable: BCSV.Bcsv) {
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.sceneGraph.nodes.length; i++)
            this.sceneGraph.nodes[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public applyAnimations(modelInstance: BMDModelInstance, rarc: RARC.RARC, animOptions?: AnimOptions): void {
        let bckFile: RARC.RARCFile | null = null;
        let brkFile: RARC.RARCFile | null = null;
        let btkFile: RARC.RARCFile | null = null;

        if (animOptions !== null) {
            if (animOptions !== undefined) {
                bckFile = animOptions.bck ? rarc.findFile(animOptions.bck) : null;
                brkFile = animOptions.brk ? rarc.findFile(animOptions.brk) : null;
                btkFile = animOptions.btk ? rarc.findFile(animOptions.btk) : null;
            } else {
                // Look for "wait" animation first, then fall back to the first animation.
                bckFile = rarc.findFile('wait.bck');
                brkFile = rarc.findFile('wait.brk');
                btkFile = rarc.findFile('wait.btk');
                if (!(bckFile || brkFile || btkFile)) {
                    bckFile = rarc.files.find((file) => file.name.endsWith('.bck')) || null;
                    brkFile = rarc.files.find((file) => file.name.endsWith('.brk')) || null;
                    btkFile = rarc.files.find((file) => file.name.endsWith('.btk')) || null;
                }
            }
        }

        if (btkFile !== null) {
            const btk = BTK.parse(btkFile.buffer);
            modelInstance.bindTTK1(btk.ttk1);
        }

        if (brkFile !== null) {
            const brk = BRK.parse(brkFile.buffer);
            modelInstance.bindTRK1(brk.trk1);
        }

        if (bckFile !== null) {
            const bck = BCK.parse(bckFile.buffer);
            modelInstance.bindANK1(bck.ank1);

            // Apply a random phase to the animation.
            modelInstance.animationController.phaseFrames += Math.random() * bck.ank1.duration;
        }
    }

    public spawnArchive(device: GfxDevice, modelMatrix: mat4, name: string, animOptions?: AnimOptions): Progressable<BMDModelInstance | null> {
        // Should do a remap at some point.
        return this.modelCache.getModel(device, this.renderHelper, this.textureHolder, name).then((bmdModel) => {
            if (bmdModel === null)
                return null;

            // Trickery.
            const rarc = this.modelCache.archiveCache.get(name);

            const bmdModelInstance = new BMDModelInstance(device, this.renderHelper, this.textureHolder, bmdModel);
            bmdModelInstance.name = name;
            this.applyAnimations(bmdModelInstance, rarc, animOptions);
            mat4.copy(bmdModelInstance.modelMatrix, modelMatrix);
            return bmdModelInstance;
        });
    }

    public spawnObject(device: GfxDevice, zoneLayerFilterTag: string, objinfo: ObjInfo, modelMatrix: mat4): void {
        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions?: AnimOptions) => {
            this.spawnArchive(device, modelMatrix, arcName, animOptions).then((modelInstance) => {
                if (modelInstance) {
                    if (tag === SceneGraphTag.Skybox) {
                        // If we have a skybox, then shrink it down a bit.
                        const skyboxScale = 0.5;
                        mat4.scale(modelInstance.modelMatrix, modelInstance.modelMatrix, [skyboxScale, skyboxScale, skyboxScale]);
                        modelInstance.setIsSkybox(true);
                        modelInstance.passMask = SMGPass.SKYBOX;
                    } else if (tag === SceneGraphTag.Indirect) {
                        modelInstance.passMask = SMGPass.INDIRECT;
                    } else if (tag === SceneGraphTag.Bloom) {
                        modelInstance.passMask = SMGPass.BLOOM;
                    } else {
                        modelInstance.passMask = SMGPass.OPAQUE;
                    }

                    this.sceneGraph.addNode(modelInstance, [tag, zoneLayerFilterTag]);

                    if (objinfo.rotateSpeed !== 0) {
                        // Set up a rotator animation to spin it around.
                        modelInstance.bindModelMatrixAnimator(new YSpinAnimator(modelInstance.animationController, objinfo));
                    }

                    this.renderHelper.renderInstBuilder.constructRenderInsts(device, this.viewRenderer);
                }
            });
        };

        const name = objinfo.objName;
        switch (objinfo.objName) {
        case 'FlagPeachCastleA':
        case 'FlagPeachCastleB':
        case 'FlagPeachCastleC':
            // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
            return;
        case 'PeachCastleTownBeforeAttack':
            spawnGraph('PeachCastleTownBeforeAttack', SceneGraphTag.Normal);
            spawnGraph('PeachCastleTownBeforeAttackBloom', SceneGraphTag.Bloom);
            break;
        case 'FlowerGroup':
        case 'FlowerBlueGroup':
        case 'ShootingStar':
        case 'MeteorCannon':
            // Archives missing. Again, runtime mesh?
            return;
        case 'TimerSwitch':
        case 'SwitchSynchronizerReverse':
        case 'PrologueDirector':
        case 'MovieStarter':
        case 'ScenarioStarter':
        case 'LuigiEvent':
            // Logic objects.
            return;
        case 'AstroCore':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'revival4.bck', brk: 'revival4.brk', btk: 'astrocore.btk' });
            break;
        case 'AstroDomeEntrance': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroDomeEntranceObservatory'); break;
            case 2: spawnGraph('AstroDomeEntranceWell'); break;
            case 3: spawnGraph('AstroDomeEntranceKitchen'); break;
            case 4: spawnGraph('AstroDomeEntranceBedroom'); break;
            case 5: spawnGraph('AstroDomeEntranceMachine'); break;
            case 6: spawnGraph('AstroDomeEntranceTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'AstroStarPlate': {
            switch (objinfo.objArg0) {
            case 1: spawnGraph('AstroStarPlateObservatory'); break;
            case 2: spawnGraph('AstroStarPlateWell'); break;
            case 3: spawnGraph('AstroStarPlateKitchen'); break;
            case 4: spawnGraph('AstroStarPlateBedroom'); break;
            case 5: spawnGraph('AstroStarPlateMachine'); break;
            case 6: spawnGraph('AstroStarPlateTower'); break;
            default: assert(false);
            }
            break;
        }
        case 'SignBoard':
            spawnGraph(name, SceneGraphTag.Normal, null);
            break;
        case 'Rosetta':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'waita.bck' });
            break;
        case 'HalfGalaxySky':
        case 'GalaxySky':
        case 'RockPlanetOrbitSky':
        case 'VROrbit':
            // Skyboxen.
            spawnGraph(name, SceneGraphTag.Skybox);
            break;
        default: {
            const name = objinfo.objName;
            spawnGraph(name, SceneGraphTag.Normal);
            // Spawn planets.
            const planetRecord = this.planetTable.records.find((record) => BCSV.getField(this.planetTable, record, 'PlanetName') === name);
            if (planetRecord) {
                const bloomFlag = BCSV.getField(this.planetTable, planetRecord, 'BloomFlag');
                const waterFlag = BCSV.getField(this.planetTable, planetRecord, 'WaterFlag');
                const indirectFlag = BCSV.getField(this.planetTable, planetRecord, 'IndirectFlag');
                if (bloomFlag)
                    spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
                if (waterFlag)
                    spawnGraph(`${name}Water`, SceneGraphTag.Water);
                if (indirectFlag)
                    spawnGraph(`${name}Indirect`, SceneGraphTag.Indirect);
            }
            break;
        }
        }
    }

    public spawnZone(device: GfxDevice, zone: Zone, zones: Zone[], modelMatrixBase: mat4): void {
        // Spawn all layers. We'll hide them later when masking out the others.

        for (const layer of zone.layers) {
            const zoneLayerFilterTag = getZoneLayerFilterTag(zone.name, layer.index);

            for (const objinfo of layer.objinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(device, zoneLayerFilterTag, objinfo, modelMatrix);
            }

            for (const objinfo of layer.mappartsinfo) {
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, objinfo.modelMatrix);
                this.spawnObject(device, zoneLayerFilterTag, objinfo, modelMatrix);
            }

            for (const zoneinfo of layer.stageobjinfo) {
                const subzone = zones.find((zone) => zone.name === zoneinfo.objName);
                const subzoneModelMatrix = mat4.create();
                mat4.mul(subzoneModelMatrix, modelMatrixBase, zoneinfo.modelMatrix);
                this.spawnZone(device, subzone, zones, subzoneModelMatrix);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.sceneGraph.destroy(device);
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
    }
}

class SMGSceneDesc implements Viewer.SceneDesc {
    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    public parsePlacement(bcsv: BCSV.Bcsv): ObjInfo[] {
        return bcsv.records.map((record): ObjInfo => {
            const objId = BCSV.getField<number>(bcsv, record, 'l_id', -1);
            const objName = BCSV.getField<string>(bcsv, record, 'name', 'Unknown');
            const objArg0 = BCSV.getField<number>(bcsv, record, 'Obj_arg0', -1);
            const rotateSpeed = BCSV.getField<number>(bcsv, record, 'RotateSpeed', 0);
            const rotateAccelType = BCSV.getField<number>(bcsv, record, 'RotateAccelType', 0);
            const modelMatrix = mat4.create();
            computeModelMatrixFromRecord(modelMatrix, bcsv, record);
            return { objId, objName, objArg0, rotateSpeed, rotateAccelType, modelMatrix };
        });
    }

    public parseZone(name: string, buffer: ArrayBufferSlice): Zone {
        const rarc = RARC.parse(buffer);
        const layers: ZoneLayer[] = [];
        for (let i = -1; i < 10; i++) {
            const layerName = getLayerName(i);
            const placementDir = `jmp/placement/${layerName}`;
            const mappartsDir = `jmp/mapparts/${layerName}`;
            if (!rarc.findDir(placementDir))
                continue;
            const objinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/objinfo`)));
            const mappartsinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${mappartsDir}/mappartsinfo`)));
            const stageobjinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/stageobjinfo`)));
            layers.push({ index: i, objinfo, mappartsinfo, stageobjinfo });
        }
        return { name, layers };
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const galaxyName = this.galaxyName;
        return Progressable.all([
            fetchData(`${pathBase}/ObjectData/PlanetMapDataTable.arc`, abortSignal),
            fetchData(`${pathBase}/StageData/${galaxyName}/${galaxyName}Scenario.arc`, abortSignal),
        ]).then((buffers: ArrayBufferSlice[]) => {
            return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
        }).then((buffers: ArrayBufferSlice[]) => {
            const [planetTableBuffer, buffer] = buffers;

            // Load planet table.
            const planetTableRarc = RARC.parse(planetTableBuffer);
            const planetTable = BCSV.parse(planetTableRarc.findFileData('planetmapdatatable.bcsv'));

            // Load all the subzones.
            const scenarioRarc = RARC.parse(buffer);
            const zonelist = BCSV.parse(scenarioRarc.findFileData('zonelist.bcsv'));
            const scenariodata = BCSV.parse(scenarioRarc.findFileData('scenariodata.bcsv'));

            // zonelist contains one field, ZoneName, a string
            assert(zonelist.fields.length === 1);
            assert(zonelist.fields[0].nameHash === BCSV.bcsvHashSMG('ZoneName'));
            const zoneNames = zonelist.records.map(([zoneName]) => zoneName as string);

            // The master zone is the first one.
            const masterZoneName = zoneNames[0];
            assert(masterZoneName === galaxyName);

            const renderHelper = new GXRenderHelperGfx(device);
            const viewRenderer = new GfxRenderInstViewRenderer();

            // Construct initial state.
            renderHelper.renderInstBuilder.constructRenderInsts(device, viewRenderer);

            return Progressable.all(zoneNames.map((zoneName) => fetchData(`${pathBase}/StageData/${zoneName}.arc`))).then((buffers: ArrayBufferSlice[]) => {
                return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
            }).then((zoneBuffers: ArrayBufferSlice[]): Viewer.SceneGfx => {
                const zones = zoneBuffers.map((zoneBuffer, i) => this.parseZone(zoneNames[i], zoneBuffer));
                const spawner = new SMGSpawner(renderHelper, viewRenderer, planetTable);
                const modelMatrixBase = mat4.create();
                spawner.spawnZone(device, zones[0], zones, modelMatrixBase);
                return new SMGRenderer(device, spawner, viewRenderer, scenariodata, zoneNames);
            });
        });
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMGSceneDesc("Peach's Castle Garden", "PeachCastleGardenGalaxy"),
    new SMGSceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMGSceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMGSceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
