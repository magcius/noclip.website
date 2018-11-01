
import * as GX_Material from '../gx/gx_material';
import { GXTextureHolder, MaterialParams, PacketParams, ColorKind, loadedDataCoalescerGfx, GXShapeHelperGfx, GXRenderHelperGfx } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator } from './world';

import * as GX from '../gx/gx_enum';
import * as Viewer from '../viewer';
import { mat4 } from 'gl-matrix';
import { assert, nArray } from '../util';
import AnimationController from '../AnimationController';
import { DeviceProgram } from '../Program';
import { GfxDevice, GfxSampler, GfxTexFilterMode, GfxWrapMode, GfxMipFilterMode, GfxRenderPass, GfxBufferUsage, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxProgram, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BufferFillerHelper } from '../gfx/helpers/UniformBufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxBufferCoalescer, GfxCoalescedBuffers } from '../gfx/helpers/BufferHelpers';
import { GfxRenderInst, GfxRenderInstBuilder, makeSortKey, GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fullscreenFlags } from '../gfx/helpers/RenderFlagsHelpers';
import { Camera, computeViewMatrix } from '../Camera';
import { BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(device: GfxDevice, tpl: TPL.TPL): void {
        this.addTexturesGfx(device, tpl.textures);
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
    private bufferFiller: BufferFillerHelper;
    private paramsBuffer: GfxRenderBuffer;
    private paramsBufferOffset: number;
    private renderInst: GfxRenderInst;
    private textureMappings = nArray(1, () => new TextureMapping());

    constructor(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer, public textureHolder: TPLTextureHolder, public textureName: string) {
        const gfxProgram = device.createProgram(this.program);
        const programReflection = device.queryProgram(gfxProgram);
        const paramsLayout = programReflection.uniformBufferLayouts[0];
        this.bufferFiller = new BufferFillerHelper(paramsLayout);
        this.paramsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

        const renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, [ this.paramsBuffer ]);
        this.renderInst = renderInstBuilder.newRenderInst();
        this.renderInst.name = 'BackgroundBillboardRenderer';
        this.renderInst.drawTriangles(3);
        this.renderInst.sortKey = makeSortKey(0, 0, programReflection.uniqueKey);
        // No input state, we don't use any vertex buffers for full-screen passes.
        this.renderInst.inputState = null;
        this.renderInst.gfxProgram = gfxProgram;
        this.renderInst.renderFlags = fullscreenFlags;
        this.renderInst.samplerBindings = [null];
        this.paramsBufferOffset = renderInstBuilder.newUniformBufferInstance(this.renderInst, 0);
        renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareForRender(hostAccessPass: GfxHostAccessPass, renderInput: Viewer.ViewerRenderInput): void {
        // Set our texture bindings.
        this.textureHolder.fillTextureMapping(this.textureMappings[0], this.textureName);
        this.renderInst.fillBindingsFromTextureMappings(this.textureMappings);

        // Upload new buffer data.

        // Extract yaw
        const view = renderInput.camera.viewMatrix;
        const o = Math.atan2(-view[2], view[0]) / (Math.PI * 2) * 4;
        this.bufferFiller.reset();
        const aspect = renderInput.viewportWidth / renderInput.viewportHeight;
        this.bufferFiller.fillVec4(aspect, -1, o, 0);
        this.bufferFiller.endAndUpload(hostAccessPass, this.paramsBuffer, this.paramsBufferOffset);
        this.paramsBuffer.prepareToRender(hostAccessPass);
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
    private gfxProgram: GfxProgram;
    private materialParams = new MaterialParams();
    private gfxSamplers: GfxSampler[] = [];
    private materialAnimators: MaterialAnimator[] = [];
    private materialParamsBufferOffset: number;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public material: Material) {
        const program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.gfxProgram = device.createProgram(program);

        this.gfxSamplers = this.material.samplers.map((sampler) => {
            return Command_Material.translateSampler(device, sampler);
        });

        this.templateRenderInst = renderHelper.renderInstBuilder.newTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        this.templateRenderInst.samplerBindings = nArray(8, () => null);
        this.templateRenderInst.sortKey = makeSortKey(10 + material.materialLayer, 0, device.queryProgram(this.gfxProgram).uniqueKey);
        GX_Material.translateRenderFlagsGfx(this.templateRenderInst.renderFlags, this.material.gxMaterial);
        // Allocate our material buffer slot.
        this.materialParamsBufferOffset = renderHelper.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, 1);
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

    private fillMaterialParams(materialParams: MaterialParams, textureHolder: TPLTextureHolder): void {
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

    public prepareToRender(hostAccessPass: GfxHostAccessPass, renderHelper: GXRenderHelperGfx, textureHolder: TPLTextureHolder): void {
        this.fillMaterialParams(this.materialParams, textureHolder);
        renderHelper.fillMaterialParams(this.materialParams, this.materialParamsBufferOffset);
        this.templateRenderInst.fillBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
    }

    public destroy(device: GfxDevice) {
        this.gfxSamplers.forEach((sampler) => device.destroySampler(sampler));
    }
}

class Command_Batch {
    private shapeHelper: GXShapeHelperGfx;
    private renderInst: GfxRenderInst;
    private packetParams = new PacketParams();
    private hasTextures: boolean = false;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private nodeCommand: Command_Node, private batch: Batch, private coalescedBuffers: GfxCoalescedBuffers) {
        this.shapeHelper = new GXShapeHelperGfx(device, renderHelper.renderInstBuilder, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
        this.renderInst = this.shapeHelper.renderInst;
        this.renderInst.name = nodeCommand.node.nameStr;
        // Pull in the node's cull mode.
        this.renderInst.renderFlags.cullMode = nodeCommand.node.renderFlags.cullMode;
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.nodeCommand.modelMatrix);
    }

    public prepareForRender(hostAccessPass: GfxHostAccessPass, renderHelper: GXRenderHelperGfx, renderInput: Viewer.ViewerRenderInput): void {
        this.renderInst.visible = !(this.nodeCommand.node.visible === false);

        if (this.renderInst.visible) {
            this.computeModelView(this.packetParams.u_PosMtx[0], renderInput.camera);
            this.shapeHelper.fillPacketParams(this.packetParams, renderHelper);

            if (!this.hasTextures && this.renderInst.samplerBindings[0] !== null) {
                this.renderInst.samplerBindingsDirty = true;
                this.hasTextures = true;
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
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

export class WorldRenderer implements Viewer.Scene_Device {
    public name: string;

    private bufferCoalescer: GfxBufferCoalescer;
    private batches: Batch[];

    private batchCommands: Command_Batch[] = [];
    private materialCommands: Command_Material[] = [];
    private rootNode: Command_Node;
    private rootMatrix: mat4 = mat4.create();

    public visible: boolean = true;

    private renderHelper: GXRenderHelperGfx;
    public viewRenderer: GfxRenderInstViewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    private backgroundRenderer: BackgroundBillboardRenderer | null = null;
    private animationController = new AnimationController();
    public animationNames: string[];

    constructor(device: GfxDevice, private d: TTYDWorld, public textureHolder: TPLTextureHolder, backgroundTextureName: string | null) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.translateModel(device, d);

        const rootScale = 10;
        mat4.fromScaling(this.rootMatrix, [rootScale, rootScale, rootScale]);

        this.animationNames = this.d.animations.map((a) => a.name);

        // Play all animations b/c why not.
        this.playAllAnimations();

        if (backgroundTextureName !== null)
            this.backgroundRenderer = new BackgroundBillboardRenderer(device, this.viewRenderer, textureHolder, backgroundTextureName);
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

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        if (!this.visible)
            return null;

        this.animationController.updateTime(viewerInput.time);

        const hostAccessPass = device.createHostAccessPass();

        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.prepareForRender(hostAccessPass, viewerInput);

        this.renderHelper.fillSceneParams(viewerInput);

        // Update models.
        for (let i = 0; i < this.materialCommands.length; i++)
            this.materialCommands[i].prepareToRender(hostAccessPass, this.renderHelper, this.textureHolder);

        // Recursively update node model matrices.
        const updateNode = (nodeCommand: Command_Node, parentMatrix: mat4) => {
            nodeCommand.updateModelMatrix(parentMatrix);
            for (let i = 0; i < nodeCommand.children.length; i++)
                updateNode(nodeCommand.children[i], nodeCommand.modelMatrix);
        };

        updateNode(this.rootNode, this.rootMatrix);

        // Update shapes
        for (let i = 0; i < this.batchCommands.length; i++)
            this.batchCommands[i].prepareForRender(hostAccessPass, this.renderHelper, viewerInput);

        this.renderHelper.prepareToRender(hostAccessPass);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.executeOnPass(device, passRenderer);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.materialCommands.forEach((cmd) => cmd.destroy(device));
        this.batchCommands.forEach((cmd) => cmd.destroy(device));
    }

    private translatePart(device: GfxDevice, nodeCommand: Command_Node, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const materialCommand = this.materialCommands[part.material.index];
        this.renderHelper.renderInstBuilder.pushTemplateRenderInst(materialCommand.templateRenderInst);
        const batchCommand = new Command_Batch(device, this.renderHelper, nodeCommand, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        this.renderHelper.renderInstBuilder.popTemplateRenderInst();
        this.batchCommands.push(batchCommand);
    }

    private translateSceneGraph(device: GfxDevice, node: SceneGraphNode): Command_Node {
        const nodeCommand = new Command_Node(node);
        for (const part of node.parts)
            this.translatePart(device, nodeCommand, part);
        for (const child of node.children)
            nodeCommand.children.push(this.translateSceneGraph(device, child));
        return nodeCommand;
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, d: TTYDWorld): void {
        this.materialCommands = d.materials.map((material) => new Command_Material(device, this.renderHelper, material));

        const rootNode = d.sNode;

        this.batches = [];
        this.collectBatches(this.batches, rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescerGfx(device, this.batches.map((batch) => batch.loadedVertexData));

        this.rootNode = this.translateSceneGraph(device, rootNode);
        this.renderHelper.renderInstBuilder.finish(device, this.viewRenderer);
    }
}
