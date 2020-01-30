
import { HSD_TObj, HSD_MObj, HSD_DObj, HSD_JObj, HSD_JObjRoot, HSD_PEFlags, HSD__TexImageData, HSD_JObjFlags, HSD_TObjFlags, HSD_AnimJointRoot, HSD_MatAnimJointRoot, HSD_ShapeAnimJointRoot, HSD_AnimJoint, HSD_MatAnimJoint, HSD_ShapeAnimJoint, HSD_AObj, HSD_FObj, HSD_FObj__JointTrackType, HSD_AObjFlags } from "./SYSDOLPHIN";
import { GXShapeHelperGfx, loadedDataCoalescerComboGfx, GXMaterialHelperGfx, PacketParams, loadTextureFromMipChain, MaterialParams, translateTexFilterGfx, translateWrapModeGfx } from "../gx/gx_render";
import { GfxDevice, GfxTexture, GfxSampler } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from "../gfx/helpers/BufferHelpers";
import { LoadedVertexData } from "../gx/gx_displaylist";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput, Texture } from "../viewer";
import { vec3, mat4 } from "gl-matrix";
import { computeModelMatrixSRT, lerp } from "../MathHelpers";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from "../gx/gx_enum";
import { TextureMapping } from "../TextureHolder";
import { calcMipChain } from "../gx/gx_texture";
import { assert } from "../util";
import { Camera } from "../Camera";
import { getPointHermite } from "../Spline";

class HSD_TObj_Data {
    public texImage: HSD__TexImageData_Data;
    public gfxSampler: GfxSampler;

    constructor(device: GfxDevice, cache: GfxRenderCache, public tobj: HSD_TObj, texImageData: HSD__TexImageData_Data[]) {
        this.texImage = texImageData[this.tobj.texImageIdx];

        const [minFilter, mipFilter] = translateTexFilterGfx(this.tobj.minFilt);
        const [magFilter]            = translateTexFilterGfx(this.tobj.magFilt);
    
        this.gfxSampler = cache.createSampler(device, {
            wrapS: translateWrapModeGfx(this.tobj.wrapS),
            wrapT: translateWrapModeGfx(this.tobj.wrapT),
            minFilter, mipFilter, magFilter,
            minLOD: this.tobj.minLOD,
            maxLOD: this.tobj.maxLOD,
        });
    }

    public fillTextureMapping(m: TextureMapping): void {
        this.texImage.fillTextureMapping(m);
        m.gfxSampler = this.gfxSampler;
        // m.lodBias = this.tobj.lodBias;
    }
}

class HSD_MObj_Data {
    public tobj: HSD_TObj_Data[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public mobj: HSD_MObj, texImageData: HSD__TexImageData_Data[]) {
        for (let i = 0; i < this.mobj.tobj.length; i++)
            this.tobj.push(new HSD_TObj_Data(device, cache, this.mobj.tobj[i], texImageData));
    }
}

class HSD_DObj_Data {
    public shapeHelpers: GXShapeHelperGfx[] = [];
    public mobj: HSD_MObj_Data | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, coalescedBuffers: GfxCoalescedBuffersCombo[], public dobj: HSD_DObj, texImageData: HSD__TexImageData_Data[]) {
        if (this.dobj.mobj !== null)
            this.mobj = new HSD_MObj_Data(device, cache, this.dobj.mobj, texImageData);

        for (let i = 0; i < this.dobj.pobj.length; i++) {
            const pobj = this.dobj.pobj[i];
            this.shapeHelpers.push(new GXShapeHelperGfx(device, cache, coalescedBuffers.shift()!, pobj.loadedVertexLayout, pobj.loadedVertexData));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeHelpers.length; i++)
            this.shapeHelpers[i].destroy(device);
    }
}

class HSD_JObj_Data {
    public dobj: HSD_DObj_Data[] = [];
    public children: HSD_JObj_Data[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, coalescedBuffers: GfxCoalescedBuffersCombo[], public jobj: HSD_JObj, texImageData: HSD__TexImageData_Data[]) {
        if (this.jobj.kind === 'DObj')
            for (let i = 0; i < this.jobj.dobj.length; i++)
                this.dobj.push(new HSD_DObj_Data(device, cache, coalescedBuffers, this.jobj.dobj[i], texImageData));

        for (let i = 0; i < this.jobj.children.length; i++)
            this.children.push(new HSD_JObj_Data(device, cache, coalescedBuffers, this.jobj.children[i], texImageData));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.dobj.length; i++)
            this.dobj[i].destroy(device);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

class HSD__TexImageData_Data {
    private gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    constructor(device: GfxDevice, cache: GfxRenderCache, public data: HSD__TexImageData) {
        const mipChain = calcMipChain(this.data, this.data.mipCount);
        const { viewerTexture, gfxTexture } = loadTextureFromMipChain(device, mipChain);
        this.gfxTexture = gfxTexture;
        this.viewerTexture = viewerTexture;
    }

    public fillTextureMapping(m: TextureMapping): boolean {
        m.gfxTexture = this.gfxTexture;
        m.width = this.data.width;
        m.height = this.data.height;
        return true;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class HSD_JObjRoot_Data {
    public coalescedBuffers: GfxBufferCoalescerCombo;
    public rootData: HSD_JObj_Data;
    public texImageData: HSD__TexImageData_Data[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public root: HSD_JObjRoot) {
        const loadedVertexDatas: LoadedVertexData[] = [];

        function collectDObj(dobj: HSD_DObj): void {
            for (let i = 0; i < dobj.pobj.length; i++)
                loadedVertexDatas.push(dobj.pobj[i].loadedVertexData);
        }

        function collectJObj(jobj: HSD_JObj): void {
            if (jobj.kind === 'DObj')
                for (let i = 0; i < jobj.dobj.length; i++)
                    collectDObj(jobj.dobj[i]);
            for (let i = 0; i < jobj.children.length; i++)
                collectJObj(jobj.children[i]);
        }

        collectJObj(this.root.jobj);

        this.coalescedBuffers = loadedDataCoalescerComboGfx(device, loadedVertexDatas);

        for (let i = 0; i < this.root.texImageDatas.length; i++)
            this.texImageData.push(new HSD__TexImageData_Data(device, cache, this.root.texImageDatas[i]));

        const coalescedBuffers = this.coalescedBuffers.coalescedBuffers.slice();
        this.rootData = new HSD_JObj_Data(device, cache, coalescedBuffers, this.root.jobj, this.texImageData);
    }

    public destroy(device: GfxDevice): void {
        this.coalescedBuffers.destroy(device);
        this.rootData.destroy(device);
        for (let i = 0; i < this.texImageData.length; i++)
            this.texImageData[i].destroy(device);
    }
}

class HSD_TObj_Instance {
    public textureMatrix = mat4.create();
    public texMapID: GX.TexMapID = GX.TexMapID.TEXMAP_NULL;
    public texMtxID: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
    public texCoordID: GX.TexCoordID = GX.TexCoordID.TEXCOORD_NULL;

    constructor(public data: HSD_TObj_Data) {
    }

    public calcMtx(): void {
    }

    public fillTexMtx(materialParams: MaterialParams): void {
        const flags = this.data.tobj.flags, coord = flags & HSD_TObjFlags.COORD_MASK;
        if (coord === HSD_TObjFlags.COORD_REFLECTION) {
            // TODO(jstpierre)
        } else if (coord === HSD_TObjFlags.COORD_HILIGHT) {
            // TODO(jstpierre)
        } else if (coord === HSD_TObjFlags.COORD_SHADOW) {
            // TODO(jstpierre)
        } else if (!!(flags & HSD_TObjFlags.BUMP)) {
            mat4.copy(materialParams.u_TexMtx[9], this.textureMatrix);
        } else {
            mat4.copy(materialParams.u_PostTexMtx[this.texMapID], this.textureMatrix);
        }
    }

    public fillTextureMapping(m: TextureMapping): void {
        this.data.fillTextureMapping(m);
    }
}

const materialParams = new MaterialParams();

class HSD_MObj_Instance {
    private materialHelper: GXMaterialHelperGfx;
    private tobj: HSD_TObj_Instance[] = [];

    constructor(public data: HSD_MObj_Data) {
        for (let i = 0; i < this.data.tobj.length; i++)
            this.tobj.push(new HSD_TObj_Instance(this.data.tobj[i]));

        // Assign TObj resources.
        let texID: number = 0;
        let texCoordID: GX.TexCoordID = GX.TexCoordID.TEXCOORD0;
        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i], flags = tobj.data.tobj.flags;
            const coord = (flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_TOON) {
                // Toon is special.
            } else if (coord === HSD_TObjFlags.BUMP) {
                // Bump is special.
            } else {
                const tobjID = texID++;
                tobj.texMapID = GX.TexMapID.TEXMAP0 + tobjID;
                tobj.texMtxID = GX.PostTexGenMatrix.PTTEXMTX0 + (tobjID * 3);

                // Reflection/Hilight/Shadow get assigned first (??)
                if (coord === HSD_TObjFlags.COORD_REFLECTION || coord === HSD_TObjFlags.COORD_HILIGHT || coord === HSD_TObjFlags.COORD_SHADOW)
                    tobj.texCoordID = texCoordID++;
            }
        }

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            const coord = (tobj.data.tobj.flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_UV)
                tobj.texCoordID = texCoordID++;
        }

        const mobj = this.data.mobj;

        const mb = new GXMaterialBuilder();

        // setupTextureCoordGen
        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i], flags = tobj.data.tobj.flags;
            const coord = (flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_SHADOW)
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, tobj.texMtxID);
            else if (coord === HSD_TObjFlags.COORD_REFLECTION || coord === HSD_TObjFlags.COORD_HILIGHT)
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX3x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX0, true, tobj.texMtxID);
            else if (!!(flags & HSD_TObjFlags.BUMP))
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX2x4, tobj.data.tobj.src, GX.TexGenMatrix.TEXMTX9);
            else
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX2x4, tobj.data.tobj.src, GX.TexGenMatrix.IDENTITY, false, tobj.texMtxID);
        }

        // TODO(jstpierre): TExp
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // PE.
        mb.setAlphaCompare(mobj.alphaComp0, mobj.alphaRef0, mobj.alphaOp, mobj.alphaComp1, mobj.alphaRef1);
        mb.setBlendMode(mobj.type, mobj.srcFactor, mobj.dstFactor, mobj.logicOp);
        mb.setZMode(!!(mobj.peFlags & HSD_PEFlags.ENABLE_COMPARE), mobj.zComp, !!(mobj.peFlags & HSD_PEFlags.ENABLE_ZUPDATE));

        // TODO(jstpierre): per-pobj cull overrides.
        mb.setCullMode(GX.CullMode.NONE);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public calcMtx(): void {
        for (let i = 0; i < this.tobj.length; i++)
            this.tobj[i].calcMtx();
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        for (let i = 0; i < 8; i++)
            materialParams.m_TextureMapping[i].reset();

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            tobj.fillTextureMapping(materialParams.m_TextureMapping[i]);
            tobj.fillTexMtx(materialParams);
        }

        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        const offs = this.materialHelper.allocateMaterialParams(renderInst);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }
}

const packetParams = new PacketParams();

function findSkeleton(jobj: HSD_JObj_Instance): HSD_JObj_Instance {
    while (!(jobj.data.jobj.flags & (HSD_JObjFlags.SKELETON_ROOT | HSD_JObjFlags.SKELETON)))
        jobj = jobj.parent!;
    return jobj;
}

function mkEnvelopeModelNodeMtx(dst: mat4, jobj: HSD_JObj_Instance): void {
    const flags = jobj.data.jobj.flags;

    if (!!(flags & HSD_JObjFlags.SKELETON_ROOT)) {
        mat4.identity(dst);
    } else {
        const skeleton = findSkeleton(jobj);
        if (skeleton === jobj) {
            mat4.invert(dst, skeleton.data.jobj.inverseBindPose);
        } else if (!!(skeleton.data.jobj.flags & HSD_JObjFlags.SKELETON_ROOT)) {
            mat4.invert(dst, jobj.jointMtx);
            mat4.mul(dst, skeleton.jointMtx, dst);
        } else {
            mat4.invert(dst, jobj.jointMtx);
            mat4.mul(dst, skeleton.data.jobj.inverseBindPose, dst);
            mat4.mul(dst, skeleton.jointMtx, dst);
        }
    }
}

const scratchMatrixEnv = mat4.create();
const scratchMatrixNd = mat4.create();

class HSD_DObj_Instance {
    private mobj: HSD_MObj_Instance | null = null;

    public visible: boolean = true;

    constructor(public data: HSD_DObj_Data) {
        if (this.data.mobj !== null)
            this.mobj = new HSD_MObj_Instance(this.data.mobj);
    }

    public calcMtx(): void {
        if (this.mobj !== null)
            this.mobj.calcMtx();
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, jobj: HSD_JObj_Instance, root: HSD_JObjRoot_Instance): void {
        // TODO(jstpierre): What to do?
        if (this.mobj === null)
            return;

        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        this.mobj.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        for (let i = 0; i < this.data.dobj.pobj.length; i++) {
            const pobj = this.data.dobj.pobj[i];
            const shapeHelper = this.data.shapeHelpers[i];

            // Calculate the draw matrices.

            if (pobj.kind === 'Rigid') {
                // TODO(jstpierre): Shared vtx.
                assert(pobj.jointReference === 0);

                mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, jobj.jointMtx);
            } else if (pobj.kind === 'Envelope') {
                mkEnvelopeModelNodeMtx(scratchMatrixNd, jobj);

                for (let i = 0; i < pobj.envelopeDesc.length; i++) {
                    const mtxEnv = pobj.envelopeDesc[i];

                    const dst = packetParams.u_PosMtx[i];
                    dst.fill(0);

                    if (mtxEnv.length === 1) {
                        const env = mtxEnv[0];
                        assert(env.weight === 1.0);
                        const envJObj = root.findJObjByJointReferenceID(env.jointReference);

                        if (!!(jobj.data.jobj.flags & HSD_JObjFlags.SKELETON_ROOT)) {
                            // Rigid vertices are stored in bone-local space if stored on the skeleton root.
                            mat4.copy(dst, envJObj.jointMtx);
                        } else {
                            // Transform into the space of the bind pose of the skeleton root.
                            mat4.mul(dst, envJObj.jointMtx, envJObj.data.jobj.inverseBindPose);
                        }
                    } else {
                        // Enveloped matrices are stored in bind pose space.
                        for (let j = 0; j < mtxEnv.length; j++) {
                            const env = mtxEnv[j];
                            assert(env.weight < 1.0);
                            const envJObj = root.findJObjByJointReferenceID(env.jointReference);
                            mat4.mul(scratchMatrixEnv, envJObj.jointMtx, envJObj.data.jobj.inverseBindPose);
                            mat4.multiplyScalarAndAdd(dst, dst, scratchMatrixEnv, env.weight);
                        }
                    }

                    mat4.mul(dst, dst, scratchMatrixNd);
                    mat4.mul(dst, viewerInput.camera.viewMatrix, dst);
                }
            } else if (pobj.kind === 'ShapeAnim') {
                throw "whoops";
            }

            const renderInst = shapeHelper.pushRenderInst(renderInstManager);
            shapeHelper.fillPacketParams(packetParams, renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

class HSD_AObj_Instance {
    public framerate: number = 1.0;
    public currFrame: number = 0;

    constructor(public aobj: HSD_AObj) {
    }

    private calcFObj<T>(fobj: HSD_FObj, callback: (trackType: number, value: number, obj: T) => void, obj: T): void {
        const time = this.currFrame;

        let i = 0;
        for (; i < fobj.keyframes.length; i++) {
            if (time < fobj.keyframes[i].time)
                break;
        }

        if (i > 0)
            i--;

        const k0 = fobj.keyframes[i];
        if (k0.kind === 'Constant') {
            callback(fobj.type, k0.p0, obj);
        } else if (k0.kind === 'Linear') {
            const t = (time - k0.time) / k0.duration;
            callback(fobj.type, lerp(k0.p0, k0.p1, t), obj);
        } else if (k0.kind === 'Hermite') {
            const t = (time - k0.time) / k0.duration;
            callback(fobj.type, getPointHermite(k0.p0, k0.p1, k0.d0, k0.d1, t), obj);
        }
    }

    public calcAnim<T>(deltaTimeInFrames: number, callback: (trackType: number, value: number, obj: T) => void, obj: T): void {
        this.currFrame += this.framerate * deltaTimeInFrames;

        if (!!(this.aobj.flags & HSD_AObjFlags.ANIM_LOOP)) {
            while (this.currFrame >= this.aobj.endFrame) {
                // TODO(jstpierre): Rewind Frame
                this.currFrame -= this.aobj.endFrame;
            }
        }

        for (let i = 0; i < this.aobj.fobj.length; i++)
            this.calcFObj(this.aobj.fobj[i], callback, obj);
    }
}

class HSD_JObj_Instance {
    private dobj: HSD_DObj_Instance[] = [];
    private aobj: HSD_AObj_Instance | null = null;
    public children: HSD_JObj_Instance[] = [];
    public jointMtx = mat4.create();

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.create();

    public visible: boolean = true;

    constructor(public data: HSD_JObj_Data, public parent: HSD_JObj_Instance | null = null) {
        for (let i = 0; i < this.data.dobj.length; i++)
            this.dobj.push(new HSD_DObj_Instance(this.data.dobj[i]));
        for (let i = 0; i < this.data.children.length; i++)
            this.children.push(new HSD_JObj_Instance(this.data.children[i], this));

        const jobj = this.data.jobj;
        vec3.copy(this.translation, jobj.translation);
        vec3.copy(this.rotation, jobj.rotation);
        vec3.copy(this.scale, jobj.scale);
        this.visible = !(jobj.flags & HSD_JObjFlags.HIDDEN);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setVisibleAll(v: boolean): void {
        this.visible = v;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisibleAll(v);
    }

    public addAnim(animJoint: HSD_AnimJoint | null, matAnimJoint: HSD_MatAnimJoint | null, shapeAnimJoint: HSD_ShapeAnimJoint | null): void {
        if (animJoint !== null && animJoint.aobj !== null)
            this.aobj = new HSD_AObj_Instance(animJoint.aobj);
    }

    public addAnimAll(animJoint: HSD_AnimJoint | null, matAnimJoint: HSD_MatAnimJoint | null, shapeAnimJoint: HSD_ShapeAnimJoint | null): void {
        this.addAnim(animJoint, matAnimJoint, shapeAnimJoint);

        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            child.addAnimAll(
                animJoint !== null ? animJoint.children[i] : null,
                matAnimJoint !== null ? matAnimJoint.children[i] : null,
                shapeAnimJoint !== null ? shapeAnimJoint.children[i] : null,
            );
        }
    }

    private static updateAnim(trackType: HSD_FObj__JointTrackType, value: number, jobj: HSD_JObj_Instance): void {
        if (trackType === HSD_FObj__JointTrackType.HSD_A_J_ROTX) {
            jobj.rotation[0] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_ROTY) {
            jobj.rotation[1] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_ROTZ) {
            jobj.rotation[2] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_PATH) {
            // TODO
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_TRAX) {
            jobj.translation[0] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_TRAY) {
            jobj.translation[1] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_TRAZ) {
            jobj.translation[2] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_SCAX) {
            jobj.scale[0] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_SCAY) {
            jobj.scale[1] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_SCAZ) {
            jobj.scale[2] = value;
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_NODE) {
            jobj.setVisible(value >= 0.5);
        } else if (trackType === HSD_FObj__JointTrackType.HSD_A_J_BRANCH) {
            jobj.setVisibleAll(value >= 0.5);
        } else {
            debugger;
        }
    }

    public calcAnim(deltaTimeInFrames: number): void {
        if (this.aobj !== null)
            this.aobj.calcAnim(deltaTimeInFrames, HSD_JObj_Instance.updateAnim, this);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].calcAnim(deltaTimeInFrames);
    }

    public calcMtx(parentJointMtx: mat4 | null = null): void {
        // TODO(jstpierre): CLASSIC_SCALE
        computeModelMatrixSRT(this.jointMtx,
            this.scale[0], this.scale[1], this.scale[2],
            this.rotation[0], this.rotation[1], this.rotation[2],
            this.translation[0], this.translation[1], this.translation[2]);

        if (parentJointMtx !== null)
            mat4.mul(this.jointMtx, parentJointMtx, this.jointMtx);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].calcMtx(this.jointMtx);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, root: HSD_JObjRoot_Instance): void {
        if (this.visible)
            for (let i = 0; i < this.dobj.length; i++)
                this.dobj[i].draw(device, renderInstManager, viewerInput, this, root);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].draw(device, renderInstManager, viewerInput, root);
    }
}

export class HSD_JObjRoot_Instance {
    private rootInst: HSD_JObj_Instance;
    private allJObjsByID = new Map<number, HSD_JObj_Instance>();

    constructor(public data: HSD_JObjRoot_Data) {
        this.rootInst = new HSD_JObj_Instance(this.data.rootData);

        // Traverse and register the JObjs.
        const registerJObj = (inst: HSD_JObj_Instance): void => {
            this.allJObjsByID.set(inst.data.jobj.jointReferenceID, inst);

            for (let i = 0; i < inst.children.length; i++)
                registerJObj(inst.children[i]);
        };

        registerJObj(this.rootInst);
    }

    public addAnimAll(animJoint: HSD_AnimJointRoot | null, matAnimJoint: HSD_MatAnimJointRoot | null, shapeAnimJoint: HSD_ShapeAnimJointRoot | null): void {
        this.rootInst.addAnimAll(
            animJoint !== null ? animJoint.root : null,
            matAnimJoint !== null ? matAnimJoint.root : null,
            shapeAnimJoint !== null ? shapeAnimJoint.root : null,
        );
    }

    public findJObjByJointReferenceID(jointReferenceID: number): HSD_JObj_Instance {
        return this.allJObjsByID.get(jointReferenceID)!;
    }

    public calcAnim(deltaTimeInFrames: number): void {
        this.rootInst.calcAnim(deltaTimeInFrames);
    }

    public calcMtx(viewerInput: ViewerRenderInput): void {
        this.rootInst.calcMtx(null);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.rootInst.draw(device, renderInstManager, viewerInput, this);

        this.drawBoneHierarchy(this.rootInst, viewerInput.camera);
    }

    private drawBoneHierarchy(jobj: HSD_JObj_Instance, camera: Camera, depth: number = 0, idx: number = 0, highlight: boolean = false): number {
        /*
        const ctx = getDebugOverlayCanvas2D();
        vec3.transformMat4(scratchVec3b, [0, 0, 0], jobj.jointMtx);

        if (highlight) {
            drawWorldSpacePoint(ctx, camera, scratchVec3b, Red, 6);
            if (idx < 10)
                drawWorldSpaceText(ctx, camera, scratchVec3b, '' + idx);
        }

        if (jobj.parent !== null) {
            vec3.transformMat4(scratchVec3a, [0, 0, 0], jobj.parent.jointMtx);
            const color = colorNewCopy(Red);
            if (highlight)
                colorCopy(color, Yellow);
            drawWorldSpaceLine(ctx, camera, scratchVec3a, scratchVec3b, color);
        }

        for (let i = 0; i < jobj.children.length; i++)
            idx = this.drawBoneHierarchy(jobj.children[i], camera, depth + 1, ++idx, highlight || jobj.highlight);

        return idx;
        */

        return 0;
    }
}
