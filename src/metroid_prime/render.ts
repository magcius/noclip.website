
//

import { mat3, mat4 } from 'gl-matrix';

import { MREA, Material, Geometry, Surface, vtxAttrFormats, MaterialFlags } from './mrea';
import { TXTR } from './txtr';
import * as GX_Texture from 'gx/gx_texture';
import * as GX_Material from 'gx/gx_material';

import * as Viewer from '../viewer';
import { RenderState, RenderFlags } from '../render';
import { align } from '../util';
import ArrayBufferSlice from 'ArrayBufferSlice';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';

const sceneParamsData = new Float32Array(4*4 + GX_Material.scaledVtxAttributes.length + 4);
const attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));
// Cheap bad way to do a scale up.
attrScaleData[0] = 10.0;

const textureScratch = new Int32Array(8);

export class Scene implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    public glTextures: WebGLTexture[] = [];
    private bufferCoalescer: BufferCoalescer;
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];

    public sceneParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, public mrea: MREA) {
        const textureSet = this.mrea.materialSet.textures;
        this.glTextures = textureSet.map((txtr) => Scene.translateTexture(gl, txtr));
        this.translateModel(gl);
        this.sceneParamsBuffer = gl.createBuffer();
        this.textures = textureSet.map((txtr, i) => this.translateTXTRToViewer(`Texture${i}`, txtr));
    }

    private static translateTexture(gl: WebGL2RenderingContext, texture: TXTR) {
        const texId = gl.createTexture();
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
            return new Command_Material(gl, this, material);
        });

        const vertexDatas: ArrayBufferSlice[] = [];
        const indexDatas: ArrayBufferSlice[] = [];

        const surfaces = this.coalesceSurfaces();

        surfaces.forEach((surface) => {
            vertexDatas.push(new ArrayBufferSlice(surface.packedData.buffer));
            indexDatas.push(new ArrayBufferSlice(surface.indexData.buffer));
        });

        this.bufferCoalescer = new BufferCoalescer(gl, vertexDatas, indexDatas);

        let i = 0;
        surfaces.forEach((surface) => {
            this.surfaceCommands.push(new Command_Surface(gl, surface, this.bufferCoalescer.coalescedBuffers[i]));
            ++i;
        });
    }

    private translateTXTRToViewer(name: string, texture: TXTR): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const name = "";
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

    private bindTextures(state: RenderState, material: Material) {
        const gl = state.gl;
        const prog = (<GX_Material.GX_Program> state.currentProgram);
        // Bind textures.
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const textureIndex = material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const texture = this.glTextures[this.mrea.materialSet.textureRemapTable[textureIndex]];
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            textureScratch[i] = i;
        }
        gl.uniform1iv(prog.u_Texture, textureScratch);
    }

    public render(state: RenderState) {
        const gl = state.gl;

        // Update our SceneParams UBO.
        let offs = 0;
        sceneParamsData.set(state.projection, offs);
        offs += 4*4;
        sceneParamsData.set(attrScaleData, offs);
        offs += GX_Material.scaledVtxAttributes.length;
        sceneParamsData[offs++] = GX_Material.getTextureLODBias(state);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneParamsData, gl.DYNAMIC_DRAW);

        let currentMaterialIndex = -1;
        let currentGroupIndex = -1;

        const surfaces = this.surfaceCommands;
        surfaces.forEach((surfaceCmd) => {
            const materialIndex = surfaceCmd.surface.materialIndex;
            const material = this.mrea.materialSet.materials[materialIndex];

            // Don't render occluder meshes.
            if (material.flags & MaterialFlags.OCCLUDER)
                return;

            if (currentMaterialIndex !== materialIndex) {
                const groupIndex = this.mrea.materialSet.materials[materialIndex].groupIndex;

                if (groupIndex !== currentGroupIndex) {
                    const materialCommand = this.materialCommands[groupIndex];
                    materialCommand.exec(state);
                    currentGroupIndex = groupIndex;
                }

                this.bindTextures(state, material);
                currentMaterialIndex = materialIndex;
            }

            surfaceCmd.exec(state);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(gl));
        this.bufferCoalescer.destroy(gl);
        gl.deleteBuffer(this.sceneParamsBuffer);
    }
}

class Command_Surface {
    private vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, public surface: Surface, private coalescedBuffers: CoalescedBuffers) {
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, coalescedBuffers.vertexBuffer.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coalescedBuffers.indexBuffer.buffer);

        let offset = 0;
        for (const attrib of vtxAttrFormats) {
            if (!(this.surface.vtxAttrFormat & attrib.mask))
                continue;

            const attribLocation = GX_Material.getVertexAttribLocation(attrib.vtxAttrib);
            gl.enableVertexAttribArray(attribLocation);

            gl.vertexAttribPointer(
                attribLocation,
                attrib.compCount,
                gl.FLOAT, false,
                4 * this.surface.packedVertexSize,
                coalescedBuffers.vertexBuffer.offset + offset,
            );

            offset += 4 * attrib.compCount;
        }
        gl.bindVertexArray(null);
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.surface.numTriangles * 3, gl.UNSIGNED_SHORT, this.coalescedBuffers.indexBuffer.offset);
        gl.bindVertexArray(null);

        state.drawCallCount++;
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
    }
}

const fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

const materialParamsSize = 4*2 + 4*2 + 4*8 + 4*3*10 + 4*3*20 + 4*2*3 + 4*8;
const packetParamsOffs = align(materialParamsSize, 64);
const packetParamsSize = 11*16;
const paramsData = new Float32Array(packetParamsOffs + packetParamsSize);
class Command_Material {
    static attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));
    static matrixScratch = mat3.create();
    static colorScratch = new Float32Array(4 * 8);

    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;
    private paramsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, public scene: Scene, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
        this.paramsBuffer = gl.createBuffer();
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        let offs = 0;

        // color mat regs not used.
        offs += 4*2;
        // amb mat regs not used.
        offs += 4*2;

        for (let i = 0; i < 8; i++) {
            let fallbackColor: GX_Material.Color;
            if (i >= 4)
                fallbackColor = this.material.gxMaterial.colorRegisters[i - 4];
            else
                fallbackColor = this.material.gxMaterial.colorConstants[i];

            const color = fallbackColor;

            paramsData[offs + 4*i + 0] = color.r;
            paramsData[offs + 4*i + 1] = color.g;
            paramsData[offs + 4*i + 2] = color.b;
            paramsData[offs + 4*i + 3] = color.a;
        }
        offs += 4*8;

        // TODO(jstpierre): UV animations.
        const matrixScratch = Command_Material.matrixScratch;
        for (let i = 0; i < 10; i++) {
            const finalMatrix = matrixScratch;
            paramsData[offs + i*12 +  0] = finalMatrix[0];
            paramsData[offs + i*12 +  1] = finalMatrix[3];
            paramsData[offs + i*12 +  2] = finalMatrix[6];
            paramsData[offs + i*12 +  3] = 0;
            paramsData[offs + i*12 +  4] = finalMatrix[1];
            paramsData[offs + i*12 +  5] = finalMatrix[4];
            paramsData[offs + i*12 +  6] = finalMatrix[7];
            paramsData[offs + i*12 +  7] = 0;
            paramsData[offs + i*12 +  8] = finalMatrix[2];
            paramsData[offs + i*12 +  9] = finalMatrix[5];
            paramsData[offs + i*12 + 10] = finalMatrix[8];
            paramsData[offs + i*12 + 11] = 0;
        }
        offs += 4*3*10;

        for (let i = 0; i < 20; i++) {
            const finalMatrix = matrixScratch;
            paramsData[offs + i*12 +  0] = finalMatrix[0];
            paramsData[offs + i*12 +  1] = finalMatrix[3];
            paramsData[offs + i*12 +  2] = finalMatrix[6];
            paramsData[offs + i*12 +  3] = 0;
            paramsData[offs + i*12 +  4] = finalMatrix[1];
            paramsData[offs + i*12 +  5] = finalMatrix[4];
            paramsData[offs + i*12 +  6] = finalMatrix[7];
            paramsData[offs + i*12 +  7] = 0;
            paramsData[offs + i*12 +  8] = finalMatrix[2];
            paramsData[offs + i*12 +  9] = finalMatrix[5];
            paramsData[offs + i*12 + 10] = finalMatrix[8];
            paramsData[offs + i*12 + 11] = 0;
        }
        offs += 4*3*20;

        // IndTexMtx. Indirect texturing isn't used.
        offs += 4*3*2;

        // Texture parameters. SizeX/SizeY are only used for indtex, and LodBias is always 0.
        // We can leave this blank.
        offs += 4*8;

        // MV matrix.
        offs = packetParamsOffs;
        paramsData.set(state.updateModelView(), offs);
        offs += 4*4;

        // Position matrix.
        paramsData.set(fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong, offs);
        offs += 4*4;

        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_SceneParams, this.scene.sceneParamsBuffer);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.paramsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, paramsData, gl.DYNAMIC_DRAW);

        gl.bindBufferRange(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_MaterialParams, this.paramsBuffer, 0, materialParamsSize * 4);
        gl.bindBufferRange(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, this.paramsBuffer, packetParamsOffs * 4, packetParamsSize * 4);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        gl.deleteBuffer(this.paramsBuffer);
    }
}
