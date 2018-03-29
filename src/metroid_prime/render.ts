
//

import { mat3, mat4 } from 'gl-matrix';

import { MREA, Material, Geometry, Surface, vtxAttrFormats, MaterialFlags } from './mrea';
import { TXTR } from './txtr';
import * as GX_Texture from '../j3d/gx_texture';
import * as GX_Material from '../j3d/gx_material';

import * as Viewer from '../viewer';
import { RenderPass, RenderState, RenderFlags, CoalescedBuffers, BufferCoalescer } from '../render';
import { align } from '../util';

const sceneParamsData = new Float32Array(4*4 + 4*4 + 4*4 + 4);
const attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));
// Cheap bad way to do a scale up.
attrScaleData[0] = 10.0;

const textureScratch = new Int32Array(8);

export class Scene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;

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

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const data = texture.data;
            const dataStart = texture.dataStart + offs;
            const surface = { format, width, height, data, dataStart };
            const decodedTexture = GX_Texture.decodeTexture(surface, !!ext_compressed_texture_s3tc);

            if (decodedTexture.type === 'RGBA') {
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
            } else if (decodedTexture.type === 'S3TC') {
                gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
            }

            const size = GX_Texture.calcTextureSize(format, width, height);
            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    private coalesceSurfaces(): Surface[] {
        // XXX(jstpierre): TODO: Coalesce surfaces with the same material ID
        // into the same draw call. Seems to happen quite a lot, actually.
        const surfaces = [];
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

        const vertexDatas: ArrayBuffer[] = [];
        const indexDatas: ArrayBuffer[] = [];

        const surfaces = this.coalesceSurfaces();

        surfaces.forEach((surface) => {
            vertexDatas.push(surface.packedData.buffer);
            indexDatas.push(surface.indexData.buffer);
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
            const data = texture.data;
            const dataStart = texture.dataStart;
            const surface = { format, width, height, data, dataStart };
            const rgbaTexture = GX_Texture.decodeTexture(surface, false);
            // Should never happen.
            if (rgbaTexture.type === 'S3TC')
                throw "whoops";

            const canvas = document.createElement('canvas');
            canvas.width = rgbaTexture.width;
            canvas.height = rgbaTexture.height;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
            surfaces.push(canvas);

            const size = GX_Texture.calcTextureSize(format, width, height);
            offs += size;
            width /= 2;
            height /= 2;
        }

        return { name, surfaces };
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
        sceneParamsData.set(state.updateModelView(), offs);
        offs += 4*4;
        sceneParamsData.set(attrScaleData, offs);
        offs += 4*4;
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
    }

    public exec(state: RenderState) {
        const gl = state.gl;
        const prog = (<GX_Material.GX_Program> state.currentProgram);

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

const materialParamsSize = 4*2 + 4*8 + 4*3*10;
const packetParamsOffs = align(materialParamsSize, 64);
const packetParamsSize = 16*10;
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

        for (let i = 0; i < 8; i++) {
            let fallbackColor: GX_Material.Color;
            if (i >= 4)
                fallbackColor = this.material.gxMaterial.colorRegisters[i - 4];
            else
                fallbackColor = this.material.gxMaterial.colorConstants[i];

            const color = fallbackColor;

            const offs = 4*2 + 4*i;
            paramsData[offs+0] = color.r;
            paramsData[offs+1] = color.g;
            paramsData[offs+2] = color.b;
            paramsData[offs+3] = color.a;
        }

        // XXX(jstpierre): UV animations.
        const matrixScratch = Command_Material.matrixScratch;
        for (let i = 0; i < 10; i++) {
            const offs = 4*2 + 4*8 + 12*i;
            const finalMatrix = matrixScratch;
            paramsData[offs +  0] = finalMatrix[0];
            paramsData[offs +  1] = finalMatrix[1];
            paramsData[offs +  2] = finalMatrix[2];
            paramsData[offs +  4] = finalMatrix[3];
            paramsData[offs +  5] = finalMatrix[4];
            paramsData[offs +  6] = finalMatrix[5];
            paramsData[offs +  8] = finalMatrix[6];
            paramsData[offs +  9] = finalMatrix[7];
            paramsData[offs + 10] = finalMatrix[8];
        }

        // Position matrix.
        paramsData.set(fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong, packetParamsOffs);

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
