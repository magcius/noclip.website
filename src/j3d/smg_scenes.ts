
import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';
import { assert, nArray, assertExists } from '../util';
import { fetchData } from '../fetch';

import { DeviceProgram } from '../Program';
import * as Viewer from '../viewer';

import { BMDModel, BMDModelInstance, J3DTextureHolder } from './render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { TextureOverride, TextureMapping } from '../TextureHolder';

import * as RARC from './rarc';
import * as Yaz0 from '../compression/Yaz0';
import * as BCSV from '../luigis_mansion/bcsv';
import * as UI from '../ui';
import { mat4, quat, vec3 } from 'gl-matrix';
import { BMD, BRK, BTK, BCK, LoopMode } from './j3d';
import { GfxBlendMode, GfxBlendFactor, GfxDevice, GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxRenderPassDescriptor, GfxLoadDisposition } from '../gfx/platform/GfxPlatform';
import AnimationController from '../AnimationController';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxRenderInstViewRenderer, GfxRenderInst, GfxRenderInstBuilder } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, noClearRenderPassDescriptor, PostFXRenderTarget, ColorAttachment, DepthStencilAttachment, DEFAULT_NUM_SAMPLES, makeEmptyRenderPassDescriptor, copyRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { TransparentBlack } from '../Color';
import { getPointBezier } from '../Spline';
import { RENDER_HACKS_ICON } from '../bk/scenes';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => p.matSource,
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
};

interface ModelMatrixAnimator {
    updateRailAnimation(dst: mat4, time: number): void;
}

class RailAnimationPlatform {
    private railPhase: number = 0;

    constructor(public path: Path, modelMatrix: mat4) {
        assert(path.points.length === 2);
        assert(path.closed === 'OPEN');
        const translation = scratchVec3;
        mat4.getTranslation(translation, modelMatrix);

        // Project translation onto our line segment to find t.
        const seg = vec3.create();
        const prj = vec3.create();
        vec3.sub(seg, path.points[1].p0, path.points[0].p0);
        vec3.sub(prj, translation, path.points[0].p0);
        const n = vec3.dot(prj, seg);
        const d = vec3.dot(seg, seg);
        const t = n / d;
        this.railPhase = t;
    }

    public updateRailAnimation(dst: mat4, time: number): void {
        // TODO(jstpierre): Figure out the path speed.
        const tS = time / 10;
        const t = (tS + this.railPhase) % 1.0;
        interpPathPoints(scratchVec3, this.path.points[0], this.path.points[1], t);
        dst[12] = scratchVec3[0];
        dst[13] = scratchVec3[1];
        dst[14] = scratchVec3[2];
    }
}

class RailAnimationTico {
    private railPhase: number = 0;

    constructor(public path: Path) {
    }

    public updateRailAnimation(dst: mat4, time: number): void {
        const path = this.path;

        // TODO(jstpierre): calculate speed. probably on the objinfo.
        const tS = time / 70;
        const t = (tS + this.railPhase) % 1.0;

        // Which point are we in?
        let numSegments = path.points.length;
        if (path.closed === 'OPEN')
            --numSegments;

        const segmentFrac = t * numSegments;
        const s0 = segmentFrac | 0;
        const sT = segmentFrac - s0;

        const s1 = (s0 >= path.points.length - 1) ? 0 : s0 + 1;
        const pt0 = assertExists(path.points[s0]);
        const pt1 = assertExists(path.points[s1]);

        const c = scratchVec3;
        interpPathPoints(c, pt0, pt1, sT);
        dst[12] = c[0];
        dst[13] = c[1];
        dst[14] = c[2];

        // Now compute the derivative to rotate.
        interpPathPoints(c, pt0, pt1, sT + 0.05);
        c[0] -= dst[12];
        c[1] -= dst[13];
        c[2] -= dst[14];

        const ny = Math.atan2(c[2], -c[0]);
        mat4.rotateY(dst, dst, ny);
    }
}

const scratchVec3 = vec3.create();
class Node {
    public name: string = '';

    private modelMatrixAnimator: ModelMatrixAnimator | null = null;
    private modelMatrix = mat4.create();
    private rotateSpeed = 0;
    private rotatePhase = 0;

    constructor(public objinfo: ObjInfo, public modelInstance: BMDModelInstance, parentModelMatrix: mat4, public animationController: AnimationController) {
        this.name = modelInstance.name;
        // BlackHole is special and doesn't inherit SR from parent.
        if (objinfo.objName === 'BlackHole') {
            mat4.copy(this.modelMatrix, objinfo.modelMatrix);
            this.modelMatrix[12] += parentModelMatrix[12];
            this.modelMatrix[13] += parentModelMatrix[13];
            this.modelMatrix[14] += parentModelMatrix[14];
        } else {
            mat4.mul(this.modelMatrix, parentModelMatrix, objinfo.modelMatrix);
        }

        this.setupAnimations();
    }

    public setupAnimations(): void {
        this.rotateSpeed = this.objinfo.rotateSpeed;

        const objName = this.objinfo.objName;
        if (objName.startsWith('HoleBeltConveyerParts') && this.objinfo.path)
            this.modelMatrixAnimator = new RailAnimationPlatform(this.objinfo.path, this.modelMatrix);
        else if (objName === 'TicoRail')
            this.modelMatrixAnimator = new RailAnimationTico(this.objinfo.path);
        else if (objName.endsWith('Coin')) {
            this.rotateSpeed = 140;
            this.rotatePhase = (this.objinfo.modelMatrix[12] + this.objinfo.modelMatrix[13] + this.objinfo.modelMatrix[14]);
        }
    }

    public updateMapPartsRotation(dst: mat4, time: number): void {
        if (this.rotateSpeed !== 0) {
            // RotateSpeed appears to be deg/sec?
            const rotateSpeed = this.rotateSpeed / (this.objinfo.rotateAccelType > 0 ? this.objinfo.rotateAccelType : 1);
            const speed = rotateSpeed * Math.PI / 180;
            mat4.rotateY(dst, dst, (time + this.rotatePhase) * speed);
        }
    }

    public updateSpecialAnimations(): void {
        const time = this.animationController.getTimeInSeconds();
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.updateMapPartsRotation(this.modelInstance.modelMatrix, time);
        if (this.modelMatrixAnimator !== null)
            this.modelMatrixAnimator.updateRailAnimation(this.modelInstance.modelMatrix, time);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        this.updateSpecialAnimations();
        this.modelInstance.prepareToRender(renderHelper, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

class SceneGraph {
    public nodes: Node[] = [];
    public nodeTags: string[][] = [];
    public onnodeadded: () => void | null = null;

    public hasTag(tag: string): boolean {
        return this.nodeTags.some((tags) => tags.includes(tag));
    }

    public nodeHasTag(i: number, tag: string): boolean {
        return this.nodeTags[i].includes(tag);
    }

    public forTag(tag: string, cb: (node: Node, i: number) => void): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const nodeTags = this.nodeTags[i];
            if (nodeTags.includes(tag))
                cb(this.nodes[i], i);
        }
    }

    public addNode(node: Node | null, tags: string[]): void {
        if (node === null)
            return;
        this.nodes.push(node);
        this.nodeTags.push(tags);
        const i = this.nodes.length - 1;
        if (this.onnodeadded !== null)
            this.onnodeadded();
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

function makeFullscreenPassRenderInst(renderInstBuilder: GfxRenderInstBuilder, name: string, program: DeviceProgram): GfxRenderInst {
    const renderInst = renderInstBuilder.pushRenderInst();
    renderInst.drawTriangles(3);
    renderInst.name = name;
    renderInst.setDeviceProgram(program);
    renderInst.inputState = null;
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
    public colorAttachment = new ColorAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(public depthStencilAttachment: DepthStencilAttachment) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }

    public createRenderPass(device: GfxDevice, renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxColorAttachment;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxDepthStencilAttachment;
        return device.createRenderPass(this.renderPassDescriptor);
    }
}

const bloomClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    depthStencilAttachment: null,
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.CLEAR,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};

class SMGRenderer implements Viewer.SceneGfx {
    private sceneGraph: SceneGraph;
    public textureHolder: J3DTextureHolder;

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
    private scenarioSelect: UI.SingleSelect;

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, private spawner: SMGSpawner, private viewRenderer: GfxRenderInstViewRenderer, private scenarioData: BCSV.Bcsv, private zoneNames: string[]) {
        this.sceneGraph = spawner.sceneGraph;
        this.textureHolder = spawner.textureHolder;

        this.sceneGraph.onnodeadded = () => {
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
        this.bloomRenderInstDownsample = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom downsample', new FullscreenCopyProgram());
        this.bloomRenderInstDownsample.passMask = SMGPass.BLOOM_DOWNSAMPLE;

        this.bloomRenderInstBlur = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom blur', new BloomPassBlurProgram());
        this.bloomRenderInstBlur.passMask = SMGPass.BLOOM_BLUR;

        this.bloomRenderInstBokeh = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom bokeh', new BloomPassBokehProgram());
        this.bloomRenderInstBokeh.passMask = SMGPass.BLOOM_BOKEH;

        this.bloomRenderInstCombine = makeFullscreenPassRenderInst(renderInstBuilder, 'bloom combine', new FullscreenCopyProgram());
        this.bloomRenderInstCombine.passMask = SMGPass.BLOOM_COMBINE;
        this.bloomRenderInstCombine.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        });

        renderInstBuilder.finish(device, this.viewRenderer);
    }

    private setZoneLayersVisible(zoneName: string, layerMask: number): void {
        for (let i = 0; i < 26; i++) {
            const visible = !!(layerMask & (1 << i));
            this.sceneGraph.forTag(getZoneLayerFilterTag(zoneName, i), (node) => {
                node.modelInstance.setVisible(visible);
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
        if (this.currentScenarioIndex === index)
            return;

        this.currentScenarioIndex = index;
        this.scenarioSelect.setHighlighted(this.currentScenarioIndex);
        this.onstatechanged();
        this.applyCurrentScenario();
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(TIME_OF_DAY_ICON, 'Scenario');

        const scenarioNames = this.scenarioData.records.map((record) => {
            return BCSV.getField<string>(this.scenarioData, record, 'ScenarioName');
        });
        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (index: number) => {
            this.setCurrentScenario(index);
        };
        this.scenarioSelect.selectItem(0);

        scenarioPanel.contents.appendChild(this.scenarioSelect.elem);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].modelInstance.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.sceneGraph.nodes.length; i++)
                this.sceneGraph.nodes[i].modelInstance.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [scenarioPanel, renderHacksPanel];
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.spawner.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.mainRenderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.opaqueSceneTexture.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.viewRenderer.prepareToRender(device);

        const skyboxPassRenderer = this.mainRenderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, SMGPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const opaquePassRenderer = this.mainRenderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, opaquePassRenderer, SMGPass.OPAQUE);

        let lastPassRenderer: GfxRenderPass;
        if (this.viewRenderer.hasAnyVisible(SMGPass.INDIRECT)) {
            opaquePassRenderer.endPass(this.opaqueSceneTexture.gfxTexture);
            device.submitPass(opaquePassRenderer);

            const textureOverride: TextureOverride = { gfxTexture: this.opaqueSceneTexture.gfxTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("IndDummy", textureOverride);

            const indTexPassRenderer = this.mainRenderTarget.createRenderPass(device, noClearRenderPassDescriptor);
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
            const bloomPassRenderer = bloomColorTargetScene.createRenderPass(device, bloomClearRenderPassDescriptor);
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
            const bloomDownsamplePassRenderer = bloomColorTargetDownsample.createRenderPass(device, noClearRenderPassDescriptor);
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
            const bloomBlurPassRenderer = bloomColorTargetBlur.createRenderPass(device, noClearRenderPassDescriptor);
            this.viewRenderer.executeOnPass(device, bloomBlurPassRenderer, SMGPass.BLOOM_BLUR);
            bloomBlurPassRenderer.endPass(bloomColorTextureBlur.gfxTexture);
            device.submitPass(bloomBlurPassRenderer);

            // TODO(jstpierre): Downsample blur / bokeh as well.

            // Bokeh-ify.
            // We can ditch the second render target now, so just reuse it.
            const bloomColorTargetBokeh = this.bloomScratch1ColorTarget;
            const bloomColorTextureBokeh = this.bloomScratch1ColorTexture;
            const bloomBokehPassRenderer = bloomColorTargetBokeh.createRenderPass(device, noClearRenderPassDescriptor);
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

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentScenarioIndex);
        return offs;
    }

    public deserializeSaveState(dst: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(dst);
        if (offs < byteLength)
            this.setCurrentScenario(view.getUint8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice): void {
        this.spawner.destroy(device);

        this.mainRenderTarget.destroy(device);
        this.opaqueSceneTexture.destroy(device);

        device.destroyProgram(this.bloomRenderInstBlur.gfxProgram);
        device.destroyProgram(this.bloomRenderInstBokeh.gfxProgram);
        device.destroyProgram(this.bloomRenderInstCombine.gfxProgram);
        device.destroyProgram(this.bloomRenderInstDownsample.gfxProgram);

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

interface Point {
    p0: vec3;
    p1: vec3;
    p2: vec3;
}

interface Path {
    l_id: number;
    name: string;
    type: string;
    closed: string;
    points: Point[];
}

interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    objArg1: number;
    rotateSpeed: number;
    rotateAccelType: number;
    modelMatrix: mat4;
    path: Path;
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

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function getPointLinear_3(dst: vec3, p0: vec3, p1: vec3, t: number): void {
    dst[0] = lerp(p0[0], p1[0], t);
    dst[1] = lerp(p0[1], p1[1], t);
    dst[2] = lerp(p0[2], p1[2], t);
}

function getPointBezier_3(dst: vec3, p0: vec3, c0: vec3, c1: vec3, p1: vec3, t: number): void {
    dst[0] = getPointBezier(p0[0], c0[0], c1[0], p1[0], t);
    dst[1] = getPointBezier(p0[1], c0[1], c1[1], p1[1], t);
    dst[2] = getPointBezier(p0[2], c0[2], c1[2], p1[2], t);
}

function interpPathPoints(dst: vec3, pt0: Point, pt1: Point, t: number): void {
    const p0 = pt0.p0;
    const c0 = pt0.p2;
    const c1 = pt1.p1;
    const p1 = pt1.p0;
    if (vec3.equals(p0, c0) && vec3.equals(c1, p1))
        getPointLinear_3(dst, p0, p1, t);
    else
        getPointBezier_3(dst, p0, c0, c1, p1, t);
}

class ModelCache {
    public promiseCache = new Map<string, Progressable<BMDModel>>();
    public archiveCache = new Map<string, RARC.RARC>();
    private models: BMDModel[] = [];
    private destroyed: boolean = false;

    public getModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, textureHolder: J3DTextureHolder, archivePath: string, modelFilename: string): Progressable<BMDModel> {
        if (this.promiseCache.has(archivePath))
            return this.promiseCache.get(archivePath);

        const p = fetchData(archivePath).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0) {
                console.warn(`Could not fetch archive ${archivePath}`);
                return null;
            }
            return Yaz0.decompress(buffer);
        }).then((buffer: ArrayBufferSlice) => {
            if (buffer === null)
                return null;
            if (this.destroyed)
                return null;
            const rarc = RARC.parse(buffer);
            const bmd = rarc.findFileData(modelFilename) !== null ? BMD.parse(rarc.findFileData(modelFilename)) : null;
            const bmdModel = new BMDModel(device, renderHelper, bmd, null);
            textureHolder.addJ3DTextures(device, bmd);
            this.archiveCache.set(archivePath, rarc);
            this.models.push(bmdModel);
            return bmdModel;
        });

        this.promiseCache.set(archivePath, p);
        return p;
    }

    public destroy(device: GfxDevice): void {
        this.destroyed = true;
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
    }
}

class SMGSpawner {
    public textureHolder = new J3DTextureHolder();
    public sceneGraph = new SceneGraph();
    private modelCache = new ModelCache();

    constructor(private pathBase: string, private renderHelper: GXRenderHelperGfx, private viewRenderer: GfxRenderInstViewRenderer, private planetTable: BCSV.Bcsv) {
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.sceneGraph.nodes.length; i++)
            this.sceneGraph.nodes[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public applyAnimations(node: Node, rarc: RARC.RARC, animOptions?: AnimOptions): void {
        const modelInstance = node.modelInstance;

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
                    brkFile = rarc.files.find((file) => file.name.endsWith('.brk') && file.name.toLowerCase() !== 'colorchange.brk') || null;
                    btkFile = rarc.files.find((file) => file.name.endsWith('.btk') && file.name.toLowerCase() !== 'texchange.btk') || null;
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
            // XXX(jstpierre): Some wait.bck animations are set to ONCE instead of REPEAT (e.g. Kinopio/Toad in SMG2)
            if (bckFile.name === 'wait.bck')
                bck.ank1.loopMode = LoopMode.REPEAT;
            modelInstance.bindANK1(bck.ank1);

            // Apply a random phase to the animation.
            modelInstance.animationController.phaseFrames += Math.random() * bck.ank1.duration;
        }
    }

    public bindChangeAnimation(node: Node, rarc: RARC.RARC, frame: number): void {
        const brkFile = rarc.findFile('colorchange.brk');
        const btkFile = rarc.findFile('texchange.btk');

        const animationController = new AnimationController();
        animationController.setTimeInFrames(frame);

        if (brkFile) {
            const brk = BRK.parse(brkFile.buffer);
            node.modelInstance.bindTRK1(brk.trk1, animationController);
        }

        if (btkFile) {
            const btk = BTK.parse(btkFile.buffer);
            node.modelInstance.bindTTK1(btk.ttk1, animationController);
        }
    }

    public spawnObject(device: GfxDevice, zoneLayerFilterTag: string, objinfo: ObjInfo, modelMatrixBase: mat4): void {
        const spawnGraph = (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            const arcPath = `${this.pathBase}/ObjectData/${arcName}.arc`;
            const modelFilename = `${arcName}.bdl`;
            return this.modelCache.getModel(device, this.renderHelper, this.textureHolder, arcPath, modelFilename).then((bmdModel): [Node, RARC.RARC] | null => {
                if (bmdModel === null)
                    return null;

                // Trickery.
                const rarc = this.modelCache.archiveCache.get(arcPath);

                const modelInstance = new BMDModelInstance(device, this.renderHelper, this.textureHolder, bmdModel, materialHacks);
                modelInstance.name = `${objinfo.objName} ${objinfo.objId}`;

                if (tag === SceneGraphTag.Skybox) {
                    // If we have a skybox, then shrink it down a bit.
                    const skyboxScale = 0.5;
                    mat4.scale(objinfo.modelMatrix, objinfo.modelMatrix, [skyboxScale, skyboxScale, skyboxScale]);
                    modelInstance.setIsSkybox(true);
                    modelInstance.passMask = SMGPass.SKYBOX;
                } else if (tag === SceneGraphTag.Indirect) {
                    modelInstance.passMask = SMGPass.INDIRECT;
                } else if (tag === SceneGraphTag.Bloom) {
                    modelInstance.passMask = SMGPass.BLOOM;
                } else {
                    modelInstance.passMask = SMGPass.OPAQUE;
                }

                const node = new Node(objinfo, modelInstance, modelMatrixBase, modelInstance.animationController);
                this.applyAnimations(node, rarc, animOptions);

                this.sceneGraph.addNode(node, [tag, zoneLayerFilterTag]);

                this.renderHelper.renderInstBuilder.constructRenderInsts(device, this.viewRenderer);
                return [node, rarc];
            });
        };

        const name = objinfo.objName;
        switch (objinfo.objName) {
        case 'FlagPeachCastleA':
        case 'FlagPeachCastleB':
        case 'FlagPeachCastleC':
            // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
            return;
        case 'ElectricRail':
            // Covers the path with the rail -- will require special spawn logic.
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
            // SignBoard has a single animation for falling over which we don't want to play.
            spawnGraph('SignBoard', SceneGraphTag.Normal, null);
            break;
        case 'Rabbit':
            spawnGraph('TrickRabbit');
            break;
        case 'Kinopio':
            spawnGraph('Kinopio', SceneGraphTag.Normal, { bck: 'wait.bck' });
            break;
        case 'Rosetta':
            spawnGraph(name, SceneGraphTag.Normal, { bck: 'waita.bck' });
            break;
        case 'Tico':
        case 'TicoAstro':
        case 'TicoRail':
            spawnGraph('Tico').then(([node, rarc]) => {
                this.bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;
    
        case 'SweetsDecoratePartsFork':
        case 'SweetsDecoratePartsSpoon':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                this.bindChangeAnimation(node, rarc, objinfo.objArg1);
            });
            break;
        case 'UFOKinoko':
            spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                this.bindChangeAnimation(node, rarc, objinfo.objArg0);
            });
            break;

        // Skyboxen.
        case 'BeyondSummerSky':
        case 'CloudSky':
        case 'HalfGalaxySky':
        case 'GalaxySky':
        case 'RockPlanetOrbitSky':
        case 'SummerSky':
        case 'VROrbit':
            spawnGraph(name, SceneGraphTag.Skybox);
            break;

        // SMG2
        case 'PlantC':
            spawnGraph(`PlantC00`);
            break;
        case 'PlantD':
            spawnGraph(`PlantD01`);
            break;
        case 'CareTakerHunter':
            spawnGraph(`CaretakerHunter`);
            break;
        case 'WorldMapSyncSky':
            // Presumably this uses the "current world map". I chose 04, because I like it.
            spawnGraph(`WorldMap03Sky`, SceneGraphTag.Skybox);
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

            for (const objinfo of layer.objinfo)
                this.spawnObject(device, zoneLayerFilterTag, objinfo, modelMatrixBase);

            for (const objinfo of layer.mappartsinfo)
                this.spawnObject(device, zoneLayerFilterTag, objinfo, modelMatrixBase);

            for (const zoneinfo of layer.stageobjinfo) {
                const subzone = zones.find((zone) => zone.name === zoneinfo.objName);
                const subzoneModelMatrix = mat4.create();
                mat4.mul(subzoneModelMatrix, modelMatrixBase, zoneinfo.modelMatrix);
                this.spawnZone(device, subzone, zones, subzoneModelMatrix);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
        this.sceneGraph.destroy(device);
        this.textureHolder.destroy(device);
        this.viewRenderer.destroy(device);
        this.renderHelper.destroy(device);
    }
}

export abstract class SMGSceneDescBase implements Viewer.SceneDesc {
    protected pathBase: string;

    constructor(public name: string, public galaxyName: string, public id: string = galaxyName) {
    }

    protected abstract getZoneMapFilename(zoneName: string): string;

    public parsePlacement(bcsv: BCSV.Bcsv, paths: Path[]): ObjInfo[] {
        return bcsv.records.map((record): ObjInfo => {
            const objId = BCSV.getField<number>(bcsv, record, 'l_id', -1);
            const objName = BCSV.getField<string>(bcsv, record, 'name', 'Unknown');
            const objArg0 = BCSV.getField<number>(bcsv, record, 'Obj_arg0', -1);
            const objArg1 = BCSV.getField<number>(bcsv, record, 'Obj_arg1', -1);
            const rotateSpeed = BCSV.getField<number>(bcsv, record, 'RotateSpeed', 0);
            const rotateAccelType = BCSV.getField<number>(bcsv, record, 'RotateAccelType', 0);
            const pathId: number = BCSV.getField<number>(bcsv, record, 'CommonPath_ID', -1);
            const path = paths.find((path) => path.l_id === pathId) || null;
            const modelMatrix = mat4.create();
            computeModelMatrixFromRecord(modelMatrix, bcsv, record);
            return { objId, objName, objArg0, objArg1, rotateSpeed, rotateAccelType, modelMatrix, path };
        });
    }
    
    public parsePaths(pathDir: RARC.RARCDir): Path[] {
        const commonPathInfo = BCSV.parse(RARC.findFileDataInDir(pathDir, 'commonpathinfo'));
        return commonPathInfo.records.map((record, i): Path => {
            const l_id = BCSV.getField<number>(commonPathInfo, record, 'l_id');
            const no = BCSV.getField<number>(commonPathInfo, record, 'no');
            assert(no === i);
            const name = BCSV.getField<string>(commonPathInfo, record, 'name');
            const type = BCSV.getField<string>(commonPathInfo, record, 'type');
            const closed = BCSV.getField<string>(commonPathInfo, record, 'closed', 'OPEN');
            const path_arg0 = BCSV.getField<string>(commonPathInfo, record, 'path_arg0');
            const path_arg1 = BCSV.getField<string>(commonPathInfo, record, 'path_arg1');
            const pointinfo = BCSV.parse(RARC.findFileDataInDir(pathDir, `commonpathpointinfo.${i}`));
            const points = pointinfo.records.map((record, i) => {
                const id = BCSV.getField<number>(pointinfo, record, 'id');
                assert(id === i);
                const pnt0_x = BCSV.getField<number>(pointinfo, record, 'pnt0_x');
                const pnt0_y = BCSV.getField<number>(pointinfo, record, 'pnt0_y');
                const pnt0_z = BCSV.getField<number>(pointinfo, record, 'pnt0_z');
                const pnt1_x = BCSV.getField<number>(pointinfo, record, 'pnt1_x');
                const pnt1_y = BCSV.getField<number>(pointinfo, record, 'pnt1_y');
                const pnt1_z = BCSV.getField<number>(pointinfo, record, 'pnt1_z');
                const pnt2_x = BCSV.getField<number>(pointinfo, record, 'pnt2_x');
                const pnt2_y = BCSV.getField<number>(pointinfo, record, 'pnt2_y');
                const pnt2_z = BCSV.getField<number>(pointinfo, record, 'pnt2_z');
                const p0 = vec3.fromValues(pnt0_x, pnt0_y, pnt0_z);
                const p1 = vec3.fromValues(pnt1_x, pnt1_y, pnt1_z);
                const p2 = vec3.fromValues(pnt2_x, pnt2_y, pnt2_z);
                return { p0, p1, p2 };
            });
            return { l_id, name, type, closed, points };
        });
    }

    public parseZone(name: string, buffer: ArrayBufferSlice): Zone {
        const rarc = RARC.parse(buffer);
        const layers: ZoneLayer[] = [];
        for (let i = -1; i < 26; i++) {
            const layerName = getLayerName(i);
            const placementDir = `jmp/placement/${layerName}`;
            const pathDir = `jmp/path`;
            const mappartsDir = `jmp/mapparts/${layerName}`;
            if (!rarc.findDir(placementDir))
                continue;
            const paths = this.parsePaths(rarc.findDir(pathDir));
            const objinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/objinfo`)), paths);
            const mappartsinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${mappartsDir}/mappartsinfo`)), paths);
            const stageobjinfo = this.parsePlacement(BCSV.parse(rarc.findFileData(`${placementDir}/stageobjinfo`)), paths);
            layers.push({ index: i, objinfo, mappartsinfo, stageobjinfo });
        }
        return { name, layers };
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const galaxyName = this.galaxyName;
        return Progressable.all([
            fetchData(`${this.pathBase}/ObjectData/PlanetMapDataTable.arc`, abortSignal),
            fetchData(`${this.pathBase}/StageData/${galaxyName}/${galaxyName}Scenario.arc`, abortSignal),
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

            return Progressable.all(zoneNames.map((zoneName) => fetchData(this.getZoneMapFilename(zoneName)))).then((buffers: ArrayBufferSlice[]) => {
                return Promise.all(buffers.map((buffer) => Yaz0.decompress(buffer)));
            }).then((zoneBuffers: ArrayBufferSlice[]): Viewer.SceneGfx => {
                const zones = zoneBuffers.map((zoneBuffer, i) => this.parseZone(zoneNames[i], zoneBuffer));
                const spawner = new SMGSpawner(this.pathBase, renderHelper, viewRenderer, planetTable);
                const modelMatrixBase = mat4.create();
                spawner.spawnZone(device, zones[0], zones, modelMatrixBase);
                return new SMGRenderer(device, spawner, viewRenderer, scenariodata, zoneNames);
            });
        });
    }
}
