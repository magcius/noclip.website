
import * as GX_Material from '../gx/gx_material';
import { GXTextureHolder, MaterialParams, GXRenderHelper, SceneParams, fillSceneParamsFromRenderState, GXShapeHelper, PacketParams, loadedDataCoalescer, translateTexFilter, translateWrapMode, ColorKind } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator } from './world';

import * as Viewer from '../viewer';
import { RenderState, RenderFlags } from '../render';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';
import { mat4 } from 'gl-matrix';
import { assert, nArray } from '../util';
import AnimationController from '../AnimationController';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(gl: WebGL2RenderingContext, tpl: TPL.TPL): void {
        this.addTextures(gl, tpl.textures);
    }
}

class Command_Material {
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private materialParams = new MaterialParams();
    private glSamplers: WebGLSampler[] = [];
    private materialAnimators: MaterialAnimator[] = [];

    constructor(gl: WebGL2RenderingContext, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.glSamplers = this.material.samplers.map((sampler) => {
            return Command_Material.translateSampler(gl, sampler);
        });
    }

    private static translateSampler(gl: WebGL2RenderingContext, sampler: Sampler): WebGLSampler {
        const glSampler = gl.createSampler();
        gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));
        return glSampler;
    }

    public fillMaterialParams(materialParams: MaterialParams, textureHolder: TPLTextureHolder): void {
        for (let i = 0; i < this.material.samplers.length; i++) {
            const sampler = this.material.samplers[i];

            const texMapping = materialParams.m_TextureMapping[i];
            textureHolder.fillTextureMapping(texMapping, sampler.textureName);
            texMapping.glSampler = this.glSamplers[i];

            if (this.materialAnimators[i]) {
                this.materialAnimators[i].calcTexMtx(materialParams.u_TexMtx[i]);
            } else {
                mat4.copy(materialParams.u_TexMtx[i], this.material.texMtx[i]);
            }
        }

        materialParams.u_Color[ColorKind.MAT0].copy(this.material.matColorReg);
    }

    public bindAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        for (let i = 0; i < this.material.samplers.length; i++) {
            const m = bindMaterialAnimator(animationController, animation, this.material.name, i);
            if (m)
                this.materialAnimators[i] = m;
        }
    }

    public bindMaterial(state: RenderState, renderHelper: GXRenderHelper, textureHolder: TPLTextureHolder) {
        state.useProgram(this.program);
        state.useFlags(this.renderFlags);
        this.fillMaterialParams(this.materialParams, textureHolder);
        renderHelper.bindMaterialParams(state, this.materialParams);
        renderHelper.bindMaterialTextures(state, this.materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
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

    public bindAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        const m = bindMeshAnimator(animationController, animation, this.node.nameStr);
        if (m)
            this.meshAnimator = m;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].bindAnimation(animationController, animation);
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
    private sceneParams = new SceneParams();
    private animationController = new AnimationController();

    constructor(gl: WebGL2RenderingContext, private d: TTYDWorld, public textureHolder: TPLTextureHolder) {
        this.translateModel(gl, d);
        this.renderHelper = new GXRenderHelper(gl);

        // Bind all the animations b/c why not.
        for (let i = 0; i < d.animations.length; i++)
            this.bindAnimation(d.animations[i]);

        const rootScale = 10;
        mat4.fromScaling(this.rootMatrix, [rootScale, rootScale, rootScale]);
    }

    public bindAnimation(animation: AnimationEntry): void {
        if (animation.materialAnimation !== null)
            for (let i = 0; i < this.materialCommands.length; i++)
                this.materialCommands[i].bindAnimation(this.animationController, animation);

        if (animation.meshAnimation !== null)
            this.rootNode.bindAnimation(this.animationController, animation);
    }

    public bindAnimationName(animationName: string): void {
        const animation = this.d.animations.find((a) => a.name === animationName);
        if (animation)
            this.bindAnimation(animation);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public render(state: RenderState): void {
        if (!this.visible)
            return;

        state.setClipPlanes(10, 5000);

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
            if (node.isTranslucent === isTranslucent)
                for (let i = 0; i < node.parts.length; i++)
                    renderPart(node.parts[i]);
            for (let i = 0; i < nodeCommand.children.length; i++)
                renderNode(nodeCommand.children[i], isTranslucent);
        };

        // Dumb sorting.
        renderNode(this.rootNode, false);
        renderNode(this.rootNode, true);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.renderHelper.destroy(gl);
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
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
