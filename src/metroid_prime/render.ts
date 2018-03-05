
//

import { mat3, mat4 } from 'gl-matrix';

import { MREA, Material, Geometry, Surface, vtxAttrFormats, MaterialFlags } from './mrea';
import { TXTR } from './txtr';
import * as GX_Texture from '../j3d/gx_texture';
import * as GX_Material from '../j3d/gx_material';

import * as Viewer from '../viewer';
import { RenderPass, RenderState, RenderFlags } from '../render';

export class Scene implements Viewer.MainScene {
    public cameraController = Viewer.FPSCameraController;

    public renderPasses = [ RenderPass.OPAQUE ];
    public textures: Viewer.Texture[] = [];

    public glTextures: WebGLTexture[] = [];
    private materialCommands: Command_Material[] = [];
    private surfaceCommands: Command_Surface[] = [];

    constructor(gl: WebGL2RenderingContext, public mrea: MREA) {
        const textureSet = this.mrea.materialSet.textures;
        this.glTextures = textureSet.map((txtr) => Scene.translateTexture(gl, txtr));
        this.translateModel(gl);
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
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.slice(offs, offs + size);
            const surface = { name, format, width, height, data };
            const decodedTexture = GX_Texture.decodeTexture(surface, !!ext_compressed_texture_s3tc);

            if (decodedTexture.type === 'RGBA') {
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
            } else if (decodedTexture.type === 'S3TC') {
                gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
            }

            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    private translateModel(gl: WebGL2RenderingContext) {
        this.materialCommands = this.mrea.materialSet.materials.map((material) => {
            return new Command_Material(gl, this, material);
        });
        this.mrea.worldModels.map((worldModel) => {
            worldModel.surfaces.forEach((surface) => {
                this.surfaceCommands.push(new Command_Surface(gl, surface));
            });
        });
    }

    private translateTXTRToViewer(name: string, texture: TXTR): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.slice(offs, offs + size);
            const surface = { name, format, width, height, data };
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
        
            width /= 2;
            height /= 2;
            offs += size;
        }

        return { name, surfaces };
    }

    public render(renderState: RenderState) {
        let currentMaterialIndex = -1;

        const surfaces = this.surfaceCommands;
        surfaces.forEach((surfaceCmd) => {
            const materialIndex = surfaceCmd.surface.materialIndex;

            if (currentMaterialIndex !== materialIndex) {
                const materialCommand = this.materialCommands[materialIndex];

                // Don't render occluder meshes.
                if (materialCommand.material.flags & MaterialFlags.OCCLUDER)
                    return;

                materialCommand.exec(renderState);
                currentMaterialIndex = materialIndex;
            }

            surfaceCmd.exec(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textures.forEach((texture) => gl.deleteTexture(texture));
        this.materialCommands.forEach((cmd) => cmd.destroy(gl));
        this.surfaceCommands.forEach((cmd) => cmd.destroy(gl));
    }
}

class Command_Surface {
    private vao: WebGLVertexArrayObject;
    private vertexBuffer: WebGLBuffer;
    private indexBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, public surface: Surface) {
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.surface.packedData, gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.surface.indexData, gl.STATIC_DRAW);

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
                offset,
            );

            offset += 4 * attrib.compCount;
        }
    }

    public exec(state: RenderState) {
        const gl = state.gl;
        const prog = (<GX_Material.GX_Program> state.currentProgram);

        gl.bindVertexArray(this.vao);
        gl.drawElements(gl.TRIANGLES, this.surface.numTriangles * 3, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteBuffer(this.indexBuffer);
        gl.deleteBuffer(this.vertexBuffer);
        gl.deleteVertexArray(this.vao);
    }
}

const fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong = mat4.fromValues(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

class Command_Material {
    static attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));
    static texMtxTableScratch = new Float32Array(9 * 10);
    static texMtxScratch = mat3.create();
    static posMtxTableScratch = new Float32Array(9 * 10);
    static posMtxScratch = mat4.create();
    static textureScratch = new Int32Array(8);
    static colorScratch = new Float32Array(4 * 8);

    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;

    constructor(gl: WebGL2RenderingContext, public scene: Scene, public material: Material) {
        this.program = new GX_Material.GX_Program(this.material.gxMaterial);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.bindModelView();
        state.useFlags(this.renderFlags);

        // LOD Bias.
        const width = state.viewport.canvas.width;
        const height = state.viewport.canvas.height;
        // GC's internal EFB is sized at 640x528. Bias our mips so that it's like the user
        // is rendering things in that resolution.
        const bias = Math.log2(Math.min(width / 640, height / 528));
        gl.uniform1f(this.program.u_TextureLODBias, bias);

        Command_Material.attrScaleData[0] = 10.0;
        gl.uniform1fv(this.program.u_AttrScale, Command_Material.attrScaleData, 0, 0);

        // Bind our texture matrices.
        const texMtxScratch = Command_Material.texMtxScratch;
        const texMtxTableScratch = Command_Material.texMtxTableScratch;

        // XXX(jstpierre): Bind texture matrices.
        for (let i = 0; i < 1; i++) {
            const finalMatrix = texMtxScratch;
            texMtxTableScratch.set(finalMatrix, i * 9);
        }
        gl.uniformMatrix3fv(this.program.u_TexMtx, false, texMtxTableScratch);

        const posMtxScratch = Command_Material.posMtxScratch;
        const posMtxTableScratch = Command_Material.posMtxTableScratch;
        for (let i = 0; i < 1; i++) {
            const finalMatrix = posMtxScratch;
            mat4.copy(finalMatrix, fixPrimeUsingTheWrongConventionYesIKnowItsFromMayaButMayaIsStillWrong);
            posMtxTableScratch.set(finalMatrix, i * 9);
        }
        gl.uniformMatrix4fv(this.program.u_PosMtx, false, posMtxScratch);

        const textureScratch = Command_Material.textureScratch;
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const textureIndex = this.material.textureIndexes[i];
            if (textureIndex === -1)
                continue;

            const texture = this.scene.glTextures[this.scene.mrea.materialSet.textureRemapTable[textureIndex]];
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            textureScratch[i] = i;
        }
        gl.uniform1iv(this.program.u_Texture, textureScratch);

        const colorScratch = Command_Material.colorScratch;
        for (let i = 0; i < 8; i++) {
            let fallbackColor: GX_Material.Color;
            if (i >= 4)
                fallbackColor = this.material.gxMaterial.colorRegisters[i - 4];
            else
                fallbackColor = this.material.gxMaterial.colorConstants[i];

            let color: GX_Material.Color = fallbackColor;
            let alpha: number = fallbackColor.a;

            colorScratch[i*4+0] = color.r;
            colorScratch[i*4+1] = color.g;
            colorScratch[i*4+2] = color.b;
            colorScratch[i*4+3] = alpha;
        }
        gl.uniform4fv(this.program.u_KonstColor, colorScratch);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }}
