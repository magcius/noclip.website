
import { GXTextureHolder, MaterialParams, PacketParams, ColorKind, translateWrapModeGfx, loadedDataCoalescerComboGfx, ub_SceneParams, fillSceneParamsData, u_SceneParamsBufferSize, SceneParams, fillSceneParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GXMaterialHelperGfx, GXShapeHelperGfx, BasicGXRendererHelper } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator, MaterialLayer, DrawModeFlags, CollisionFlags } from './world';

import * as Viewer from '../viewer';
import { mat4 } from 'gl-matrix';
import { assert, nArray } from '../util';
import AnimationController from '../AnimationController';
import { DeviceProgram } from '../Program';
import { GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxHostAccessPass, GfxProgram, GfxMegaStateDescriptor, GfxCullMode } from '../gfx/platform/GfxPlatform';
import { fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxCoalescedBuffersCombo, GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKey, makeSortKeyOpaque, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera';
import { AABB } from '../Geometry';
import { colorCopy, White, Color, colorNewCopy, colorFromRGBA } from '../Color';
import * as UI from '../ui';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GXMaterialHacks } from '../gx/gx_material';
import * as GX from '../gx/gx_enum';
import { projectionMatrixD3DFromOpenGL, projectionMatrixOpenGLFromD3D } from '../gfx/helpers/ProjectionHelpers';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';

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
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
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

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();
        renderInst.drawPrimitives(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setInputLayoutAndState(null, null);
        renderInst.setBindingLayouts(backgroundBillboardBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.allocateUniformBuffer(BackgroundBillboardProgram.ub_Params, 4);

        // Set our texture bindings.
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = renderInst.getUniformBufferOffset(BackgroundBillboardProgram.ub_Params);
        const d = renderInst.mapUniformBufferF32(BackgroundBillboardProgram.ub_Params);

        // Extract yaw
        const view = renderInput.camera.viewMatrix;
        const o = Math.atan2(-view[2], view[0]) / (Math.PI * 2) * 4;
        const aspect = renderInput.backbufferWidth / renderInput.backbufferHeight;

        offs += fillVec4(d, offs, aspect, -1, o, 0);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

const materialParams = new MaterialParams();
class MaterialInstance {
    private materialAnimators: MaterialAnimator[] = [];
    private gfxSamplers: GfxSampler[] = [];
    public materialHelper: GXMaterialHelperGfx;
    public konst0 = colorNewCopy(White);
    public isTranslucent: boolean;

    constructor(device: GfxDevice, cache: GfxRenderCache, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(this.material.gxMaterial);
        // Cull mode is set by the node
        this.materialHelper.megaStateFlags.cullMode = undefined;
        this.materialHelper.cacheProgram(device, cache);

        this.gfxSamplers = this.material.samplers.map((sampler) => {
            return MaterialInstance.translateSampler(device, cache, sampler);
        });

        this.isTranslucent = material.materialLayer === MaterialLayer.BLEND;

        this.materialHelper.megaStateFlags.polygonOffset = material.materialLayer === MaterialLayer.ALPHA_TEST;
    }

    public setMaterialHacks(materialHacks: GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(materialHacks);
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

    private static translateSampler(device: GfxDevice, cache: GfxRenderCache, sampler: Sampler): GfxSampler {
        return cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
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
        colorCopy(materialParams.u_Color[ColorKind.K0], this.konst0);
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

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst, textureHolder: TPLTextureHolder): void {
        // Set up the program.
        this.materialHelper.setOnRenderInst(device, cache, renderInst);

        const offs = this.materialHelper.allocateMaterialParams(renderInst);
        this.fillMaterialParams(materialParams, textureHolder);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInst.setMegaStateFlags(this.materialHelper.megaStateFlags);

        const layer = this.getRendererLayer(this.material.materialLayer);
        renderInst.sortKey = makeSortKey(layer, this.materialHelper.programKey);
    }
}

class BatchInstance {
    private shapeHelper: GXShapeHelperGfx;
    private packetParams = new PacketParams();

    constructor(device: GfxDevice, cache: GfxRenderCache, public materialInstance: MaterialInstance, private nodeInstance: NodeInstance, private batch: Batch, private coalescedBuffers: GfxCoalescedBuffersCombo) {
        this.shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.nodeInstance.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textureHolder: TPLTextureHolder, materialInstanceOverride: MaterialInstance | null = null): void {
        const renderInst = this.shapeHelper.pushRenderInst(renderInstManager);
        const materialInstance = materialInstanceOverride !== null ? materialInstanceOverride : this.materialInstance;
        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst, textureHolder);
        this.computeModelView(this.packetParams.u_PosMtx[0], viewerInput.camera);
        this.shapeHelper.fillPacketParams(this.packetParams, renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
    }
}

function fillDebugColorFromCollisionFlags(dst: Color, flags: CollisionFlags): void {
    if (!!(flags & CollisionFlags.WALK_SLOW)) {
        colorFromRGBA(dst, 0.0, 0.0, 1.0);
    } else if (!!(flags & CollisionFlags.HAZARD_RESPAWN_ENABLED)) {
        colorFromRGBA(dst, 0.0, 1.0, 0.0);
    } else if (!!(flags & 0x200000)) {
        colorFromRGBA(dst, 1.0, 0.0, 1.0);
    } else if (flags !== 0) {
        colorFromRGBA(dst, 1.0, 0.0, 0.0);
    } else {
        colorFromRGBA(dst, 1.0, 1.0, 1.0);
    }

    dst.a = 0.25;
}

const sceneParams = new SceneParams();
const bboxScratch = new AABB();
class NodeInstance {
    public visible: boolean = true;
    public children: NodeInstance[] = [];
    public modelMatrix: mat4 = mat4.create();
    public meshAnimator: MeshAnimator | null = null;
    public batchInstances: BatchInstance[] = [];
    public namePath: string;
    public isDecal: boolean;
    private showCollisionAttrib: boolean = false;
    private collisionMaterialInstance: MaterialInstance | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(public node: SceneGraphNode, parentNamePath: string, private childIndex: number) {
        this.namePath = `${parentNamePath}/${node.nameStr}`;
        this.isDecal = !!(node.drawModeFlags & DrawModeFlags.IS_DECAL);
        this.megaStateFlags = Object.assign({}, this.node.renderFlags);
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textureHolder: TPLTextureHolder): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.node.bbox, this.modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

        for (let i = 0; i < this.children.length; i++) {
            this.children[i].updateModelMatrix(this.modelMatrix);
            this.children[i].prepareToRender(device, renderInstManager, viewerInput, textureHolder);
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.setMegaStateFlags(this.megaStateFlags);

        if (this.isDecal) {
            // The game will actually adjust the projection matrix based on the child index, if the decal flag
            // is set. This happens in _mapDispMapObj.
            //
            //      proj[5] = proj[5] * (1.0 + (indexBias * -2.0 * pCam->far * pCam->near) /
            //                          (1.0 * (pCam->far + pCam->near) * (1.0 + indexBias)));

            const indexBias = this.childIndex * 0.01;
            const frustum = viewerInput.camera.frustum, far = frustum.far, near = frustum.near;
            const depthBias = 1.0 + (indexBias * -2 * far * near) / (far + near) * (1.0 + indexBias);

            // TODO(jstpierre): Figure out what's wrong with this
            if (false && depthBias !== 1.0) {
                let offs = template.allocateUniformBuffer(ub_SceneParams, u_SceneParamsBufferSize);
                const d = template.mapUniformBufferF32(ub_SceneParams);
                fillSceneParams(sceneParams, viewerInput.camera, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

                projectionMatrixD3DFromOpenGL(sceneParams.u_Projection);
                sceneParams.u_Projection[10] *= depthBias;
                projectionMatrixOpenGLFromD3D(sceneParams.u_Projection);
                fillSceneParamsData(d, offs, sceneParams);
            }
        }

        const materialInstanceOverride = this.getMaterialInstanceOverride(device, renderInstManager.gfxRenderCache);

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(device, renderInstManager, viewerInput, textureHolder, materialInstanceOverride);

        renderInstManager.popTemplateRenderInst();
    }

    private createCollisionMaterialInstance(device: GfxDevice, cache: GfxRenderCache): void {
        const mb = new GXMaterialBuilder('Collision');
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LESS, false);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.KONST);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.KONST);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0_A);

        const collisionMaterial: Material = {
            index: -1,
            samplers: [],
            texMtx: [],
            matColorReg: White,
            materialLayer: MaterialLayer.BLEND,
            name: "Collision",
            gxMaterial: mb.finish(),
        };
        this.collisionMaterialInstance = new MaterialInstance(device, cache, collisionMaterial);
        this.collisionMaterialInstance.materialHelper.megaStateFlags.polygonOffset = true;
        this.collisionMaterialInstance.materialHelper.megaStateFlags.cullMode = GfxCullMode.NONE;
        fillDebugColorFromCollisionFlags(this.collisionMaterialInstance.konst0, this.node.collisionFlags);
    }

    private getMaterialInstanceOverride(device: GfxDevice, cache: GfxRenderCache): MaterialInstance | null {
        if (this.showCollisionAttrib) {
            if (this.collisionMaterialInstance === null)
                this.createCollisionMaterialInstance(device, cache);
            return this.collisionMaterialInstance;
        } else {
            return null;
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

    public setShowCollisionAttrib(v: boolean): void {
        this.showCollisionAttrib = v;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].setShowCollisionAttrib(v);
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        const m = bindMeshAnimator(animationController, animation, this.node.nameStr);
        if (m)
            this.meshAnimator = m;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].playAnimation(animationController, animation);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
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
    private animationController = new AnimationController(60);
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
        viewerInput.camera.setClipPlanes(1, 32768);

        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        fillSceneParamsDataOnTemplate(template, viewerInput);

        this.rootNode.updateModelMatrix(this.rootMatrix);
        this.rootNode.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.textureHolder);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setMaterialHacks({ disableVertexColors: !enableVertexColorsCheckbox.checked });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setMaterialHacks({ disableTextures: !enableTextures.checked });
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableANode = new UI.Checkbox('Enable Collision', false);
        enableANode.onchanged = () => {
            const aNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.aNodeStr)!;
            aNodeInst.setVisible(enableANode.checked);
        };
        renderHacksPanel.contents.appendChild(enableANode.elem);
        const enableAAttrib = new UI.Checkbox('Show Collision Attributes', false);
        enableAAttrib.onchanged = () => {
            const aNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.aNodeStr)!;
            aNodeInst.setShowCollisionAttrib(enableAAttrib.checked);
        };
        renderHacksPanel.contents.appendChild(enableAAttrib.elem);
        const enableSNode = new UI.Checkbox('Enable Render Root', true);
        enableSNode.onchanged = () => {
            const sNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.sNodeStr)!;
            sNodeInst.setVisible(enableSNode.checked);
        };
        renderHacksPanel.contents.appendChild(enableSNode.elem);
        const otherNodes = this.rootNode.children.filter((nodeInstance) => nodeInstance.node.nameStr !== this.d.information.aNodeStr && nodeInstance.node.nameStr !== this.d.information.sNodeStr);
        if (otherNodes.length > 0) {
            const enableOtherNodes = new UI.Checkbox('Enable Other Root Nodes', false);
            enableOtherNodes.onchanged = () => {
                otherNodes.forEach((nodeInstance) => nodeInstance.setVisible(enableOtherNodes.checked));
            };
            renderHacksPanel.contents.appendChild(enableOtherNodes.elem);
        }
        return [renderHacksPanel];
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.bufferCoalescer.destroy(device);
        this.batchInstances.forEach((cmd) => cmd.destroy(device));
        this.textureHolder.destroy(device);
        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.destroy(device);
        this.rootNode.destroy(device);
    }

    private translatePart(device: GfxDevice, nodeInstance: NodeInstance, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const materialInstance = this.materialInstances[part.material.index];
        const cache = this.getCache();
        const batchInstance = new BatchInstance(device, cache, materialInstance, nodeInstance, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        nodeInstance.batchInstances.push(batchInstance);
        this.batchInstances.push(batchInstance);
    }

    private translateSceneGraph(device: GfxDevice, node: SceneGraphNode, parentPath: string = '', childIndex: number = 0): NodeInstance {
        const nodeInstance = new NodeInstance(node, parentPath, childIndex);
        for (let i = 0; i < node.parts.length; i++)
            this.translatePart(device, nodeInstance, node.parts[i]);
        for (let i = 0; i < node.children.length; i++) {
            const childInstance = this.translateSceneGraph(device, node.children[i], nodeInstance.namePath, i);
            if (nodeInstance.isDecal)
                childInstance.isDecal = true;
            nodeInstance.children.push(childInstance);
        }
        return nodeInstance;
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, d: TTYDWorld): void {
        this.materialInstances = d.materials.map((material) => {
            return new MaterialInstance(device, this.renderHelper.renderInstManager.gfxRenderCache, material);
        });

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
