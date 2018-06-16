
//

import { mat3, mat4 } from 'gl-matrix';

import { MREA, Material, Geometry, Surface, vtxAttrFormats, MaterialFlags } from './mrea';
import { TXTR } from './txtr';
import * as GX_Texture from 'gx/gx_texture';
import * as GX_Material from 'gx/gx_material';
import { AttributeFormat } from 'gx/gx_displaylist';
import { SceneParams, MaterialParams, PacketParams, GXShapeHelper, GXRenderHelper, fillSceneParamsFromRenderState, TextureMapping } from 'gx/gx_render';

import * as Viewer from '../viewer';
import { RenderState, RenderFlags } from '../render';
import { align, assert, nArray } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';

const fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

// Cheap way to scale up.
const posScale = 10;
const posMtx = mat4.create();
mat4.multiplyScalar(posMtx, fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong, posScale);

const textureMappingScratch: TextureMapping[] = nArray(8, () => new TextureMapping());

export class Scene implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    public glTextures: WebGLTexture[] = [];
    private bufferCoalescer: BufferCoalescer;
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];
    private renderHelper: GXRenderHelper;
    private sceneParams: SceneParams = new SceneParams();
    private packetParams: PacketParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext, public mrea: MREA) {
        this.renderHelper = new GXRenderHelper(gl);
        const textureSet = this.mrea.materialSet.textures;
        this.glTextures = textureSet.map((txtr, i) => Scene.translateTexture(gl, `Texture${i}`, txtr));
        this.translateModel(gl);
        this.textures = textureSet.map((txtr, i) => this.translateTXTRToViewer(`Texture${i}`, txtr));
    }

    private static translateTexture(gl: WebGL2RenderingContext, name: string, texture: TXTR): WebGLTexture {
        const texId = gl.createTexture();
        (<any> texId).name = name;
        gl.bindTexture(gl.TEXTURE_2D, texId);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, texture.mipCount - 1);

        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const name = "";
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.subarray(offs, size);
            const surface = { name, format, width, height, data };
            GX_Texture.decodeTexture(surface).then((rgbaTexture) => {
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, surface.width, surface.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaTexture.pixels);
            });
            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    private coalesceSurfaces(): Surface[] {
        const surfaces: Surface[] = [];
        this.mrea.worldModels.forEach((worldModel) => {
            worldModel.surfaces.forEach((surface) => {
                surfaces.push(surface);
            });
        });
        return surfaces;
    }

    private translateModel(gl: WebGL2RenderingContext) {
        // Pull out the first material of each group, which should be identical except for textures.
        const groupMaterials: Material[] = [];
        for (let i = 0; i < this.mrea.materialSet.materials.length; i++) {
            const material = this.mrea.materialSet.materials[i];
            if (!groupMaterials[material.groupIndex])
                groupMaterials[material.groupIndex] = material;
        }

        this.materialCommands = groupMaterials.map((material) => {
            return new Command_Material(gl, material);
        });

        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        const surfaces = this.coalesceSurfaces();

        surfaces.forEach((surface) => {
            vertexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.packedVertexData));
            indexDatas.push(new ArrayBufferSlice(surface.loadedVertexData.indexData));
        });

        this.bufferCoalescer = new BufferCoalescer(gl, vertexDatas, indexDatas);

        let i = 0;
        surfaces.forEach((surface) => {
            this.surfaceCommands.push(new Command_Surface(gl, this, surface, this.bufferCoalescer.coalescedBuffers[i]));
            ++i;
        });
    }

    private translateTXTRToViewer(name: string, texture: TXTR): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.subarray(offs, size);
            const surface = { name, format, width, height, data };
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            GX_Texture.decodeTexture(surface).then((rgbaTexture) => {
                const ctx = canvas.getContext('2d');
                const imgData = new ImageData(surface.width, surface.height);
                imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
                ctx.putImageData(imgData, 0, 0);
            });
            surfaces.push(canvas);

            offs += size;
            width /= 2;
            height /= 2;
        }

        return { name: `${name}`, surfaces };
    }

    public render(state: RenderState) {
        const gl = state.gl;

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.computeModelView(this.packetParams.u_ModelView, state);
        this.renderHelper.bindPacketParams(state, this.packetParams);

        let currentMaterialIndex = -1;
        let currentGroupIndex = -1;

        const surfaces = this.surfaceCommands;
        surfaces.forEach((surfaceCmd, i) => {
            const materialIndex = surfaceCmd.surface.materialIndex;
            const material = this.mrea.materialSet.materials[materialIndex];

            // Don't render occluder meshes.
            if (material.flags & MaterialFlags.OCCLUDER)
                return;

            if (currentMaterialIndex !== materialIndex) {
                const groupIndex = this.mrea.materialSet.materials[materialIndex].groupIndex;
                const materialCommand = this.materialCommands[groupIndex];

                if (groupIndex !== currentGroupIndex) {
                    materialCommand.exec(state, this.renderHelper);
                    currentGroupIndex = groupIndex;
                }

                this.bindTextures(state, material, materialCommand.program);
                currentMaterialIndex = materialIndex;
            }

            surfaceCmd.exec(state, this.renderHelper);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(gl));
        this.bufferCoalescer.destroy(gl);
    }

    private fillTextureMapping(textureMapping: TextureMapping[], material: Material): void {
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const glTexture = this.glTextures[this.mrea.materialSet.textureRemapTable[textureIndex]];
            textureMapping[i].glTexture = glTexture;
        }
    }

    private bindTextures(state: RenderState, material: Material, program: GX_Material.GX_Program): void {
        this.fillTextureMapping(textureMappingScratch, material);
        this.renderHelper.bindMaterialTextureMapping(state, textureMappingScratch, program);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(dst, state.updateModelView(false, posMtx));
    }
}

class Command_Surface {
    private shapeHelper: GXShapeHelper;

    constructor(gl: WebGL2RenderingContext, public scene: Scene, public surface: Surface, private coalescedBuffers: CoalescedBuffers) {
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, surface.loadedVertexLayout, surface.loadedVertexData);
    }

    public exec(state: RenderState, renderHelper: GXRenderHelper) {
        const gl = state.gl;
        this.shapeHelper.drawSimple(gl);
        state.drawCallCount++;
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.shapeHelper.destroy(gl);
    }
}

class Command_Material {
    private renderFlags: RenderFlags;
    public program: GX_Material.GX_Program;
    public materialParams = new MaterialParams();

    constructor(gl: WebGL2RenderingContext, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
        this.fillMaterialParamsData(this.materialParams);
    }

    public exec(state: RenderState, renderHelper: GXRenderHelper) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        renderHelper.bindMaterialParams(state, this.materialParams);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }

    private fillMaterialParamsData(materialParams: MaterialParams): void {
        for (let i = 0; i < 4; i++)
            materialParams.u_Color[i].copy(this.material.gxMaterial.colorRegisters[i]);
        for (let i = 0; i < 4; i++)
            materialParams.u_KonstColor[i].copy(this.material.gxMaterial.colorConstants[i]);
    }
}
