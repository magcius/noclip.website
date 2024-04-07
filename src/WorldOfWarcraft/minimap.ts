
import { WowBlp } from "../../rust/pkg";
import { clamp } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxProgram, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { assert, leftPad } from "../util.js";
import { WowCache } from "./data.js";
import { View } from "./scenes.js";
import { TextureCache } from "./tex.js";

const bindingLayouts = [
    { numSamplers: 1, numUniformBuffers: 1 },
];

class MinimapTileProgram extends DeviceProgram {
    public static a_Position = 0;
    public static ub_TileParam = 0;

    public override both = `
layout(std140) uniform ub_TileParam {
    vec4 u_ScaleBias;
    vec4 u_Misc[1];
};

uniform sampler2D u_Texture;

#define u_Alpha (u_Misc[0].x)

#if defined VERT
in vec2 a_Position;

out vec2 v_TexCoord;

void main() {
    v_TexCoord = a_Position.xy;
    gl_Position.xy = v_TexCoord * u_ScaleBias.xy + u_ScaleBias.zw;
    gl_Position.zw = vec2(1.0, 1.0);
}
#endif

#if defined FRAG
in vec2 v_TexCoord;
void main() {
    vec4 t_Color = texture(u_Texture, v_TexCoord);
    t_Color.a *= u_Alpha;
    gl_FragColor = t_Color;
}
#endif
`;
}

class MinimapTile {
    public state: 'unloaded' | 'loading' | 'loaded' | 'missing' = 'unloaded';
    public blp: WowBlp | null = null;
    public fileId: number | null = null;

    constructor(public x: number, public y: number) {
    }
}

class StaticQuad {
    private vertexBufferQuad: GfxBuffer;
    private indexBufferQuad: GfxBuffer;
    private vertexBufferDescriptorsQuad: GfxVertexBufferDescriptor[];
    private indexBufferDescriptorQuad: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;

    constructor(cache: GfxRenderCache) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MinimapTileProgram.a_Position,   bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 2*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferQuad = makeStaticDataBuffer(cache.device, GfxBufferUsage.Vertex, new Float32Array([
            0, 0,
            0, 1,
            1, 0,
            1, 1,
        ]).buffer);
        this.indexBufferQuad = makeStaticDataBuffer(cache.device, GfxBufferUsage.Index, new Uint16Array([
            0, 1, 2, 2, 1, 3,
        ]).buffer);

        this.vertexBufferDescriptorsQuad = [
            { buffer: this.vertexBufferQuad, byteOffset: 0 },
        ];
        this.indexBufferDescriptorQuad = { buffer: this.indexBufferQuad, byteOffset: 0 };
    }

    public setQuadOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptorsQuad, this.indexBufferDescriptorQuad);
        renderInst.setDrawCount(6);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBufferQuad);
        device.destroyBuffer(this.indexBufferQuad);
    }
}

export class MinimapDisplay {
    public visible = false;

    private tileCache = new Map<string, MinimapTile>();
    private alpha = 0.4;
    private scale = 1.0;
    private tileSizeInPixels = 256; // each .blp is 256x256
    private minimapProgram: GfxProgram;
    private staticQuad: StaticQuad;

    constructor(renderCache: GfxRenderCache, private cache: WowCache, public directory: string) {
        this.minimapProgram = renderCache.createProgram(new MinimapTileProgram());
        this.staticQuad = new StaticQuad(renderCache);
    }

    private getMapTileFilename(x: number, y: number): string {
        return `world/minimaps/${this.directory}/map${leftPad('' + x, 2)}_${leftPad('' + y, 2)}.blp`;
    }

    private getTileKey(x: number, y: number): string {
        return `${x}_${y}`;
    }

    private async loadMapTileInternal(tile: MinimapTile, cache: WowCache) {
        assert(tile.state === 'unloaded');
        tile.state = 'loading';

        const mapFilename = this.getMapTileFilename(tile.x, tile.y);

        let fileId: number;
        try {
            fileId = cache.getFileDataId(mapFilename);
        } catch(e) {
            tile.state = 'missing';
            return;
        }

        const blp = await cache.loadBlp(fileId);
        tile.state = 'loaded';
        tile.blp = blp;
        tile.fileId = fileId;
    }

    private getTileCoords(view: View): [number, number] {
        const [worldY, worldX, _] = view.cameraPos;
        const adt_dimension = 533.33;

        const x = clamp(32 - (worldX / adt_dimension), 0, 63);
        const y = clamp(32 - (worldY / adt_dimension), 0, 63);
        return [x, y];
    }

    private ensureTile(x: number, y: number): MinimapTile {
        const key = this.getTileKey(x, y);
        let tile = this.tileCache.get(key);
        if (tile === undefined) {
            tile = new MinimapTile(x, y);
            this.tileCache.set(key, tile);
        }
        return tile;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, textureCache: TextureCache, view: View, backbufferWidth: number, backbufferHeight: number): void {
        if (!this.visible)
            return;

        // Determine the visible map tiles at our current scale.
        const tilePixels = this.tileSizeInPixels * this.scale;
        const numTilesX = backbufferWidth / tilePixels;
        const numTilesY = backbufferHeight / tilePixels;

        const coords = this.getTileCoords(view);

        const x0 = Math.floor(coords[0] - numTilesX / 2);
        const y0 = Math.floor(coords[1] - numTilesY / 2);
        const x1 = Math.ceil(coords[0] + numTilesX / 2);
        const y1 = Math.ceil(coords[1] + numTilesY / 2);

        const scaleX = (tilePixels / backbufferWidth) * 2;
        const scaleY = (tilePixels / backbufferHeight) * 2;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.minimapProgram);
        template.setMegaStateFlags({ cullMode: GfxCullMode.None });
        setAttachmentStateSimple(template.getMegaStateFlags(), { blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha, blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha });
        this.staticQuad.setQuadOnRenderInst(template);

        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const tile = this.ensureTile(x, y);
                if (tile.state === 'unloaded')
                    this.loadMapTileInternal(tile, this.cache);

                const offsX = (x - coords[0]) * scaleX;
                const offsY = (y - coords[1]) * scaleY;

                if (tile.state === 'loaded') {
                    const renderInst = renderInstManager.newRenderInst();

                    let offs = renderInst.allocateUniformBuffer(MinimapTileProgram.ub_TileParam, 8);
                    const d = renderInst.mapUniformBufferF32(MinimapTileProgram.ub_TileParam);
                    offs += fillVec4(d, offs, scaleX, scaleY, offsX, offsY);
                    offs += fillVec4(d, offs, this.alpha);

                    const textureMapping = textureCache.getTextureMapping(tile.fileId!, tile.blp!, { wrapS: false, wrapT: false });
                    renderInst.setSamplerBindingsFromTextureMappings([textureMapping]);

                    renderInstManager.submitRenderInst(renderInst);
                }
            }
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.staticQuad.destroy(device);
    }
}
