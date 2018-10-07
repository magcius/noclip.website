
import * as GX_Material from '../gx/gx_material';
import { GXTextureHolder, MaterialParams, GXRenderHelper, SceneParams, fillSceneParamsFromRenderState, GXShapeHelper, PacketParams, loadedDataCoalescer, ColorKind } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator, MaterialLayer } from './world';

import * as GX from '../gx/gx_enum';
import * as Viewer from '../viewer';
import { RenderState, RenderFlags, fullscreenFlags } from '../render';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import { mat4 } from 'gl-matrix';
import { assert, nArray } from '../util';
import AnimationController from '../AnimationController';
import { DeviceProgram } from '../Program';
import { GfxBuffer, GfxDevice, GfxBufferUsage, GfxBufferFrequencyHint, GfxSampler, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode } from '../gfx/platform/GfxPlatform';
import { BufferFillerHelper } from '../gfx/helpers/BufferHelpers';
import { TextureMapping, getGLTextureFromMapping, getGLSamplerFromMapping, bindGLTextureMappings } from '../TextureHolder';
import { getTransitionDeviceForWebGL2, getPlatformBuffer } from '../gfx/platform/GfxPlatformWebGL2';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(gl: WebGL2RenderingContext, tpl: TPL.TPL): void {
        this.addTextures(gl, tpl.textures);
    }
}

class BackgroundBillboardProgram extends DeviceProgram {
    public static ub_Params = 0;

    public vert: string = `
out vec2 v_TexCoord;

layout(row_major, std140) uniform ub_Params {
    vec4 u_ScaleOffset;
};

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;
}
`;

    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(u_Texture, v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;
}

class BackgroundBillboardRenderer {
    private program = new BackgroundBillboardProgram();
    private paramsBuffer: GfxBuffer;
    private bufferFiller: BufferFillerHelper;
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(device: GfxDevice, public textureHolder: TPLTextureHolder, public textureName: string) {
        const deviceLimits = device.queryLimits();
        const paramsWordCount = Math.max(4, deviceLimits.uniformBufferWordAlignment);
        this.paramsBuffer = device.createBuffer(paramsWordCount, GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);
        const gfxProgram = device.createProgram(this.program);
        const paramsLayout = device.queryProgram(gfxProgram).uniformBuffers[0];
        this.bufferFiller = new BufferFillerHelper(paramsLayout);
    }

    public render(device: GfxDevice, state: RenderState): void {
        // Extract yaw
        const o = Math.atan2(-state.view[2], state.view[0]) / (Math.PI * 2) * 4;
        const hostAccessPass = device.createHostAccessPass();
        this.bufferFiller.reset();
        this.bufferFiller.fillVec4(state.getAspect(), -1, o, 0);
        this.bufferFiller.endAndUpload(hostAccessPass, this.paramsBuffer);
        device.submitPass(hostAccessPass);

        const gl = state.gl;

        gl.bindBufferBase(gl.UNIFORM_BUFFER, BackgroundBillboardProgram.ub_Params, getPlatformBuffer(this.paramsBuffer));

        this.textureHolder.fillTextureMapping(this.textureMapping[0], this.textureName);
        bindGLTextureMappings(state, this.textureMapping);

        state.useProgram(this.program);
        state.useFlags(fullscreenFlags);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
}

function translateWrapMode(wrapMode: GX.WrapMode): GfxWrapMode {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return GfxWrapMode.CLAMP;
    case GX.WrapMode.MIRROR:
        return GfxWrapMode.MIRROR;
    case GX.WrapMode.REPEAT:
        return GfxWrapMode.REPEAT;
    }
}

class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();
    private gfxSamplers: GfxSampler[] = [];
    private materialAnimators: MaterialAnimator[] = [];

    constructor(gl: WebGL2RenderingContext, public material: Material) {
        const device = getTransitionDeviceForWebGL2(gl);

        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
        // Hack to let the surface cull mode go through.
        this.renderFlags.cullMode = undefined;

        this.gfxSamplers = this.material.samplers.map((sampler) => {
            return Command_Material.translateSampler(device, sampler);
        });
    }

    private static translateSampler(device: GfxDevice, sampler: Sampler): GfxSampler {
        return device.createSampler({
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.LINEAR,
            wrapS: translateWrapMode(sampler.wrapS),
            wrapT: translateWrapMode(sampler.wrapT),
            maxLOD: 100,
            minLOD: 0,
        });
    }

    public fillMaterialParams(materialParams: MaterialParams, textureHolder: TPLTextureHolder): void {
        for (let i = 0; i < this.material.samplers.length; i++) {
            const sampler = this.material.samplers[i];

            const texMapping = materialParams.m_TextureMapping[i];
            textureHolder.fillTextureMapping(texMapping, sampler.textureName);
            texMapping.gfxSampler = this.gfxSamplers[i];

            if (this.materialAnimators[i]) {
                this.materialAnimators[i].calcTexMtx(materialParams.u_TexMtx[i]);
            } else {
                mat4.copy(materialParams.u_TexMtx[i], this.material.texMtx[i]);
            }
        }

        materialParams.u_Color[ColorKind.MAT0].copy(this.material.matColorReg);
    }

    public stopAnimation(): void {
        for (let i = 0; i < this.material.samplers.length; i++)
            this.materialAnimators[i] = null;
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): boolean {
        let hasAnimation = false;
        for (let i = 0; i < this.material.samplers.length; i++) {
            const m = bindMaterialAnimator(animationController, animation, this.material.name, i);
            if (m) {
                this.materialAnimators[i] = m;
                hasAnimation = true;
            }
        }
        return hasAnimation;
    }

    public bindMaterial(state: RenderState, renderHelper: GXRenderHelper, textureHolder: TPLTextureHolder) {
        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        // Polygon offset isn't in RenderFlags, have to do this manually.
        const gl = state.gl;
        if (this.material.materialLayer === MaterialLayer.ALPHA_TEST) {
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(-0.5, -0.5);
        } else {
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }

        this.fillMaterialParams(this.materialParams, textureHolder);
        renderHelper.bindMaterialParams(state, this.materialParams);
        renderHelper.bindMaterialTextures(state, this.materialParams);
    }

    public destroy(device: GfxDevice) {
        this.gfxSamplers.forEach((sampler) => device.destroySampler(sampler));
    }
}

class Command_Batch {
    private shapeHelper: GXShapeHelper;
    private packetParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext, private nodeCommand: Command_Node, private batch: Batch, private coalescedBuffers: CoalescedBuffers) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(false, this.nodeCommand.modelMatrix));
    }

    public draw(state: RenderState, renderHelper: GXRenderHelper): void {
        this.computeModelView(this.packetParams.u_PosMtx[0], state);
        renderHelper.bindPacketParams(state, this.packetParams);
        this.shapeHelper.draw(state);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.shapeHelper.destroy(gl);
    }
}

class Command_Node {
    constructor(public node: SceneGraphNode) {}
    public children: Command_Node[] = [];
    public modelMatrix: mat4 = mat4.create();
    public meshAnimator: MeshAnimator | null = null;

    public updateModelMatrix(parentMatrix: mat4): void {
        if (this.meshAnimator !== null) {
            this.meshAnimator.calcModelMtx(this.modelMatrix);
            mat4.mul(this.modelMatrix, this.node.modelMatrix, this.modelMatrix);
            mat4.mul(this.modelMatrix, parentMatrix, this.modelMatrix);
        } else {
            mat4.mul(this.modelMatrix, parentMatrix, this.node.modelMatrix);
        }
    }

    public stopAnimation(): void {
        this.meshAnimator = null;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].stopAnimation();
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        const m = bindMeshAnimator(animationController, animation, this.node.nameStr);
        if (m)
            this.meshAnimator = m;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].playAnimation(animationController, animation);
    }
}

export class WorldRenderer implements Viewer.MainScene {
    public name: string;

    private bufferCoalescer: BufferCoalescer;
    private batches: Batch[];

    private batchCommands: Command_Batch[] = [];
    private materialCommands: Command_Material[] = [];
    private rootNode: Command_Node;
    private rootMatrix: mat4 = mat4.create();

    public visible: boolean = true;

    public renderHelper: GXRenderHelper;
    private backgroundRenderer: BackgroundBillboardRenderer | null = null;
    private sceneParams = new SceneParams();
    private animationController = new AnimationController();
    public animationNames: string[];

    constructor(gl: WebGL2RenderingContext, private d: TTYDWorld, public textureHolder: TPLTextureHolder, backgroundTextureName: string | null) {
        this.translateModel(gl, d);
        this.renderHelper = new GXRenderHelper(gl);

        const rootScale = 10;
        mat4.fromScaling(this.rootMatrix, [rootScale, rootScale, rootScale]);

        this.animationNames = this.d.animations.map((a) => a.name);

        // Play all animations b/c why not.
        this.playAllAnimations();

        if (backgroundTextureName !== null) {
            const device = getTransitionDeviceForWebGL2(gl);
            this.backgroundRenderer = new BackgroundBillboardRenderer(device, textureHolder, backgroundTextureName);
        }
    }

    public playAllAnimations(): void {
        for (let i = 0; i < this.d.animations.length; i++)
            this.playAnimation(this.d.animations[i]);
    }

    public playAnimation(animation: AnimationEntry): void {
        if (animation.materialAnimation !== null)
            for (let i = 0; i < this.materialCommands.length; i++)
                this.materialCommands[i].playAnimation(this.animationController, animation);

        if (animation.meshAnimation !== null)
            this.rootNode.playAnimation(this.animationController, animation);
    }

    public playAnimationName(animationName: string): boolean {
        this.stopAllAnimations();

        const animation = this.d.animations.find((a) => a.name === animationName);
        if (animation) {
            this.playAnimation(animation);
            return true;
        } else {
            return false;
        }
    }

    public stopAllAnimations(): void {
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].stopAnimation();

        this.rootNode.stopAnimation();
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        state.setClipPlanes(10, 5000);

        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.render(getTransitionDeviceForWebGL2(state.gl), state);

        this.animationController.updateTime(state.time);
        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        // Update nodes.
        const updateNode = (nodeCommand: Command_Node, parentMatrix: mat4) => {
            nodeCommand.updateModelMatrix(parentMatrix);
            for (let i = 0; i < nodeCommand.children.length; i++)
                updateNode(nodeCommand.children[i], nodeCommand.modelMatrix);
        };

        updateNode(this.rootNode, this.rootMatrix);

        const renderPart = (part: SceneGraphPart) => {
            const materialIndex = part.material.index;
            this.materialCommands[materialIndex].bindMaterial(state, this.renderHelper, this.textureHolder);
            const batchIndex = this.batches.indexOf(part.batch);
            this.batchCommands[batchIndex].draw(state, this.renderHelper);
        };

        const renderNode = (nodeCommand: Command_Node, isTranslucent: boolean) => {
            const node = nodeCommand.node;
            if (node.visible === false)
                return;

            if (node.isTranslucent === isTranslucent && node.parts.length > 0) {
                state.useFlags(node.renderFlags);
                for (let i = 0; i < node.parts.length; i++)
                    renderPart(node.parts[i]);
            }

            for (let i = 0; i < nodeCommand.children.length; i++)
                renderNode(nodeCommand.children[i], isTranslucent);
        };

        // Dumb sorting.
        renderNode(this.rootNode, false);
        renderNode(this.rootNode, true);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        const device = getTransitionDeviceForWebGL2(gl);
        this.renderHelper.destroy(gl);
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((cmd) => cmd.destroy(device));
        this.batchCommands.forEach((cmd) => cmd.destroy(gl));
    }

    private translatePart(gl: WebGL2RenderingContext, nodeCommand: Command_Node, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const batchCommand = new Command_Batch(gl, nodeCommand, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        this.batchCommands.push(batchCommand);
    }

    private translateSceneGraph(gl: WebGL2RenderingContext, node: SceneGraphNode): Command_Node {
        const nodeCommand = new Command_Node(node);
        for (const part of node.parts)
            this.translatePart(gl, nodeCommand, part);
        for (const child of node.children)
            nodeCommand.children.push(this.translateSceneGraph(gl, child));
        return nodeCommand;
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(gl: WebGL2RenderingContext, d: TTYDWorld): void {
        this.materialCommands = d.materials.map((material) => new Command_Material(gl, material));

        const rootNode = d.sNode;

        this.batches = [];
        this.collectBatches(this.batches, rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescer(gl, this.batches.map((batch) => batch.loadedVertexData));

        this.rootNode = this.translateSceneGraph(gl, rootNode);
    }
}
