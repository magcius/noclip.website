
import { GXTextureHolder, MaterialParams, PacketParams, ColorKind, translateWrapModeGfx, ub_MaterialParams, loadedDataCoalescerComboGfx } from '../gx/gx_render';
import { GXRenderHelperGfx, GXMaterialHelperGfx, GXShapeHelperGfx, BasicGXRendererHelper } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator, MaterialLayer } from './world';

import * as Viewer from '../viewer';
import { mat4 } from 'gl-matrix';
import { assert, nArray } from '../util';
import AnimationController from '../AnimationController';
import { DeviceProgram } from '../Program';
import { GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxProgram } from '../gfx/platform/GfxPlatform';
import { fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxCoalescedBuffersCombo, GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { GfxRendererLayer, makeSortKey, makeSortKeyOpaque, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera';
import { AABB } from '../Geometry';
import { colorCopy } from '../Color';
import * as UI from '../ui';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderer2';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(device: GfxDevice, tpl: TPL.TPL): void {
        this.addTextures(device, tpl.textures);
    }
}

class BackgroundBillboardProgram extends DeviceProgram {
    public static ub_Params = 0;

    public both: string = `
layout(row_major, std140) uniform ub_Params {
    vec4 u_ScaleOffset;
};

uniform sampler2D u_Texture;
`;

    public vert: string = `
out vec2 v_TexCoord;

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
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(u_Texture, v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;
}

const backgroundBillboardBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

class BackgroundBillboardRenderer {
    private program = new BackgroundBillboardProgram();
    private gfxProgram: GfxProgram;
    private textureMappings = nArray(1, () => new TextureMapping());

    constructor(device: GfxDevice, public textureHolder: TPLTextureHolder, public textureName: string) {
        this.gfxProgram = device.createProgram(this.program);
        // Fill texture mapping.
        this.textureHolder.fillTextureMapping(this.textureMappings[0], this.textureName);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.drawPrimitives(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setInputState(device, null);
        renderInst.setBindingLayouts(backgroundBillboardBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.allocateUniformBuffer(BackgroundBillboardProgram.ub_Params, 4);

        // Set our texture bindings.
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        // Upload new buffer data.
        let offs = renderInst.getUniformBufferOffset(BackgroundBillboardProgram.ub_Params);
        const d = renderInst.mapUniformBufferF32(BackgroundBillboardProgram.ub_Params);

        // Extract yaw
        const view = renderInput.camera.viewMatrix;
        const o = Math.atan2(-view[2], view[0]) / (Math.PI * 2) * 4;
        const aspect = renderInput.viewportWidth / renderInput.viewportHeight;

        offs += fillVec4(d, offs, aspect, -1, o, 0);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

class MaterialInstance {
    private materialParams = new MaterialParams();
    private materialHelper: GXMaterialHelperGfx;
    private materialAnimators: MaterialAnimator[] = [];
    private gfxSamplers: GfxSampler[] = [];
    public materialParamsBlockOffs: number = 0;
    public isTranslucent: boolean;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(this.material.gxMaterial);
        this.materialHelper.cacheProgram(device, renderHelper.renderInstManager.gfxRenderCache);

        this.gfxSamplers = this.material.samplers.map((sampler) => {
            return MaterialInstance.translateSampler(device, sampler);
        });

        this.isTranslucent = material.materialLayer === MaterialLayer.BLEND;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.materialHelper.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.materialHelper.setTexturesEnabled(v);
    }

    public setUseTextureCoords(v: boolean): void {
        this.materialHelper.setUseTextureCoords(v);
    }

    private getRendererLayer(materialLayer: MaterialLayer): GfxRendererLayer {
        switch (materialLayer) {
        case MaterialLayer.OPAQUE:
            return GfxRendererLayer.OPAQUE;
        case MaterialLayer.OPAQUE_PUNCHTHROUGH:
            return GfxRendererLayer.OPAQUE + 1;
        case MaterialLayer.ALPHA_TEST:
            return GfxRendererLayer.ALPHA_TEST;
        case MaterialLayer.ALPHA_TEST_PUNCHTHROUGH:
            return GfxRendererLayer.ALPHA_TEST + 1;
        case MaterialLayer.BLEND:
            return GfxRendererLayer.TRANSLUCENT;
        }
    }

    private static translateSampler(device: GfxDevice, sampler: Sampler): GfxSampler {
        return device.createSampler({
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.LINEAR,
            wrapS: translateWrapModeGfx(sampler.wrapS),
            wrapT: translateWrapModeGfx(sampler.wrapT),
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

        colorCopy(materialParams.u_Color[ColorKind.MAT0], this.material.matColorReg);
    }

    public stopAnimation(): void {
        for (let i = 0; i < this.material.samplers.length; i++)
            delete this.materialAnimators[i];
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

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        // Set up the program.
        this.materialHelper.setOnRenderInst(device, cache, renderInst);

        renderInst.setUniformBufferOffset(ub_MaterialParams, this.materialParamsBlockOffs, this.materialHelper.materialParamsBufferSize);
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        const layer = this.getRendererLayer(this.material.materialLayer);
        renderInst.sortKey = makeSortKey(layer, this.materialHelper.programKey);
        const megaStateFlags = renderInst.getMegaStateFlags();
        megaStateFlags.polygonOffset = this.material.materialLayer === MaterialLayer.ALPHA_TEST;
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, textureHolder: TPLTextureHolder): void {
        assert(this.materialParamsBlockOffs === 0);
        this.materialParamsBlockOffs = this.materialHelper.allocateMaterialParamsBlock(renderHelper);

        this.fillMaterialParams(this.materialParams, textureHolder);
        this.materialHelper.fillMaterialParamsData(renderHelper, this.materialParamsBlockOffs, this.materialParams);
    }

    public destroy(device: GfxDevice) {
        this.materialHelper.destroy(device);
        this.gfxSamplers.forEach((sampler) => device.destroySampler(sampler));
    }
}

class BatchInstance {
    private shapeHelper: GXShapeHelperGfx;
    private packetParams = new PacketParams();

    constructor(device: GfxDevice, cache: GfxRenderCache, private materialInstance: MaterialInstance, private nodeInstance: NodeInstance, private batch: Batch, private coalescedBuffers: GfxCoalescedBuffersCombo) {
        this.shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.nodeInstance.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, renderInput: Viewer.ViewerRenderInput): void {
        if (!this.nodeInstance.visible)
            return;

        const renderInst = this.shapeHelper.pushRenderInst(renderHelper.renderInstManager);
        this.materialInstance.setOnRenderInst(device, renderHelper.renderInstManager.gfxRenderCache, renderInst);
        renderInst.setMegaStateFlags(this.nodeInstance.node.renderFlags);
        this.computeModelView(this.packetParams.u_PosMtx[0], renderInput.camera);
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, this.nodeInstance.depth);
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
    }
}

const bboxScratch = new AABB();
class NodeInstance {
    public visible: boolean = true;
    public children: NodeInstance[] = [];
    public modelMatrix: mat4 = mat4.create();
    public meshAnimator: MeshAnimator | null = null;
    public depth: number = 0;
    public namePath: string;

    constructor(public node: SceneGraphNode, parentNamePath: string) {
        this.namePath = `${parentNamePath}/${node.nameStr}`;
    }

    public updateModelMatrix(parentMatrix: mat4): void {
        if (this.meshAnimator !== null) {
            this.meshAnimator.calcModelMtx(this.modelMatrix);
            mat4.mul(this.modelMatrix, this.node.modelMatrix, this.modelMatrix);
            mat4.mul(this.modelMatrix, parentMatrix, this.modelMatrix);
        } else {
            mat4.mul(this.modelMatrix, parentMatrix, this.node.modelMatrix);
        }
    }

    public prepareToRender(camera: Camera): void {
        // Compute depth from camera.
        if (this.visible) {
            bboxScratch.transform(this.node.bbox, this.modelMatrix);
            this.depth = computeViewSpaceDepthFromWorldSpaceAABB(camera, bboxScratch);
        }
    }

    public stopAnimation(): void {
        this.meshAnimator = null;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].stopAnimation();
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisible(visible);
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        const m = bindMeshAnimator(animationController, animation, this.node.nameStr);
        if (m)
            this.meshAnimator = m;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].playAnimation(animationController, animation);
    }
}

export class WorldRenderer extends BasicGXRendererHelper {
    public name: string;

    private bufferCoalescer: GfxBufferCoalescerCombo;
    private batches: Batch[];

    private batchInstances: BatchInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private rootNode: NodeInstance;
    private rootMatrix: mat4 = mat4.create();

    private backgroundRenderer: BackgroundBillboardRenderer | null = null;
    private animationController = new AnimationController();
    public animationNames: string[];

    constructor(device: GfxDevice, private d: TTYDWorld, public textureHolder: TPLTextureHolder, backgroundTextureName: string | null) {
        super(device);

        this.translateModel(device, d);

        const rootScale = 75;
        mat4.fromScaling(this.rootMatrix, [rootScale, rootScale, rootScale]);

        this.animationNames = this.d.animations.map((a) => a.name);

        // Play all animations b/c why not.
        this.playAllAnimations();

        if (backgroundTextureName !== null)
            this.backgroundRenderer = new BackgroundBillboardRenderer(device, textureHolder, backgroundTextureName);
    }

    public playAllAnimations(): void {
        for (let i = 0; i < this.d.animations.length; i++)
            this.playAnimation(this.d.animations[i]);
    }

    public playAnimation(animation: AnimationEntry): void {
        if (animation.materialAnimation !== null)
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].playAnimation(this.animationController, animation);

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
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].stopAnimation();

        this.rootNode.stopAnimation();
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.fillSceneParams(viewerInput, template);

        // Recursively update node model matrices.
        const updateNode = (nodeInstance: NodeInstance, parentMatrix: mat4) => {
            nodeInstance.updateModelMatrix(parentMatrix);
            nodeInstance.prepareToRender(viewerInput.camera);
            for (let i = 0; i < nodeInstance.children.length; i++)
                updateNode(nodeInstance.children[i], nodeInstance.modelMatrix);
        };

        updateNode(this.rootNode, this.rootMatrix);

        // First, go through materials and reset their material params blocks...
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].prepareToRender(this.renderHelper, this.textureHolder);

        // Update shapes
        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(device, this.renderHelper, viewerInput);

        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].materialParamsBlockOffs = 0;

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const showTextureCoords = new UI.Checkbox('Show Texture Coordinates', false);
        showTextureCoords.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setUseTextureCoords(showTextureCoords.checked);
        };
        renderHacksPanel.contents.appendChild(showTextureCoords.elem);
        const enableANode = new UI.Checkbox('Enable Collision', false);
        enableANode.onchanged = () => {
            const aNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.aNodeStr);
            aNodeInst.setVisible(enableANode.checked);
        };
        renderHacksPanel.contents.appendChild(enableANode.elem);
        const enableSNode = new UI.Checkbox('Enable Render Root', true);
        enableSNode.onchanged = () => {
            const sNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.sNodeStr);
            sNodeInst.setVisible(enableSNode.checked);
        };
        renderHacksPanel.contents.appendChild(enableSNode.elem);
        return [renderHacksPanel];
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.bufferCoalescer.destroy(device);
        this.materialInstances.forEach((cmd) => cmd.destroy(device));
        this.batchInstances.forEach((cmd) => cmd.destroy(device));
        this.textureHolder.destroy(device);
        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.destroy(device);
    }

    private translatePart(device: GfxDevice, nodeInstance: NodeInstance, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const materialInstance = this.materialInstances[part.material.index];
        const cache = this.getCache();
        const batchInstance = new BatchInstance(device, cache, materialInstance, nodeInstance, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        this.batchInstances.push(batchInstance);
    }

    private translateSceneGraph(device: GfxDevice, node: SceneGraphNode, parentPath: string = ''): NodeInstance {
        const nodeInstance = new NodeInstance(node, parentPath);
        for (const part of node.parts)
            this.translatePart(device, nodeInstance, part);
        for (const child of node.children)
            nodeInstance.children.push(this.translateSceneGraph(device, child, nodeInstance.namePath));
        return nodeInstance;
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, d: TTYDWorld): void {
        this.materialInstances = d.materials.map((material) => new MaterialInstance(device, this.renderHelper, material));

        const rootNode = d.rootNode;

        this.batches = [];
        this.collectBatches(this.batches, rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.batches.map((batch) => batch.loadedVertexData));

        this.rootNode = this.translateSceneGraph(device, rootNode);

        for (let i = 0; i < this.rootNode.children.length; i++) {
            const nodeInstance = this.rootNode.children[i];
            if (nodeInstance.node.nameStr !== d.information.sNodeStr)
                nodeInstance.setVisible(false);
        }
    }
}
