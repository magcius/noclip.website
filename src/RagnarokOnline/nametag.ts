
// Floating name labels for Ragnarok Online entities.
//
// Each NPC (and optionally each monster) gets a small text label that hovers
// above its sprite and always faces the camera. The text is rasterized to an
// offscreen 2D canvas (font + a dark outline for readability over any terrain),
// uploaded once as an RGBA GfxTexture, and drawn as a camera-facing billboard
// quad. Textures are cached by string + style so the many entities that share a
// name (e.g. "Kafra Employee", "Poring") upload one texture each.
//
// Style: two presets — NPC (bold, yellow tint, larger) and Mob (regular,
// off-white, smaller) — establish a visual hierarchy so the human-facing NPCs
// read as more "important" than the ambient monster labels around them.
//
// Wrapping: long names are split across two lines on word boundaries so they
// stay roughly square instead of stretching off-screen (e.g. "Poring War
// Recruiter" -> "Poring War" / "Recruiter"). The split point is the one that
// minimises the longest resulting line.
//
// Anchoring: the label's bottom sits a small margin above the TOP of the
// sprite's current frame (queried from the actor's world-space frame size), so
// tall NPCs and tiny mobs both get a label that hugs the head — not a fixed
// world offset.
//
// Occlusion: intentionally naive. Labels do a standard per-pixel depth test
// against the scene depth buffer (no depth write) — 3D geometry occludes the
// text, including when geometry above an NPC's head happens to overlap the
// label's screen pixels. Trying to do a proper per-sprite visibility check
// (depth-buffer sampling, occlusion queries) added a lot of pipeline plumbing
// for marginal benefit; the naive depth test is good enough.
//
// The billboard is screen-stable: it spans the camera's right/up axes so the
// label keeps a constant on-screen size regardless of orbit/pitch (unlike the
// sprite billboards, which stay world-vertical). Labels draw in the
// transparent pass over the opaque scene.

import { mat4, vec3 } from "gl-matrix";
import { GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";

// Visual style for a label: font + outline + fill. NPCs and mobs each get
// their own style so the renderer can be reused for both kinds.
export interface LabelStyle {
    // CSS font string used on the 2D canvas (e.g. "bold 22px sans-serif").
    font: string;
    // Outline (stroke) width in canvas pixels; 0 disables the outline.
    outlinePx: number;
    // RGBA fill / stroke colours as CSS strings.
    fillStyle: string;
    strokeStyle: string;
    // Wrap threshold in canvas pixels: a single line wider than this is split
    // into two lines on a word boundary. Picked per style so 22px and 16px
    // both wrap around the same on-screen width.
    wrapPx: number;
    // World units per canvas pixel — drives the billboard's apparent size at
    // unit distance from the camera.
    worldScale: number;
    // Extra world units between the top of the sprite and the bottom of the
    // label. A few units of breathing room so the text doesn't graze the head.
    marginAboveSprite: number;
}

// Preset styles. Tunable — verify visually.
export const NPC_LABEL_STYLE: LabelStyle = {
    font: "bold 22px sans-serif",
    outlinePx: 4,
    fillStyle: "rgba(255, 244, 196, 1.0)", // RO's warm name-label tint
    strokeStyle: "rgba(0, 0, 0, 0.85)",
    wrapPx: 160,
    worldScale: 0.09,
    marginAboveSprite: 1.5,
};

export const MOB_LABEL_STYLE: LabelStyle = {
    font: "16px sans-serif",
    outlinePx: 3,
    fillStyle: "rgba(235, 235, 235, 1.0)", // off-white, less prominent than NPCs
    strokeStyle: "rgba(0, 0, 0, 0.80)",
    wrapPx: 130,
    worldScale: 0.09,
    marginAboveSprite: 1.0,
};

// Line spacing factor: visible glyph height on canvas is roughly the font's px
// size; we lay successive lines on a baseline-to-baseline distance of font*this.
const LINE_HEIGHT_FACTOR = 1.1;
// Padding around the multi-line text block on the canvas (per side).
const LABEL_PADDING = 4;

// One placed label: a worldPos reference (mobs pass their live vec3 so the
// label follows them) and a per-instance height above worldPos.y at which the
// label's bottom sits — derived from the entity's sprite height so tall NPCs
// and small mobs both look right.
export interface LabelInstance {
    text: string;
    worldPos: vec3;
    heightAbove: number;
}

// A rasterized label: its uploaded texture and pixel dimensions.
interface LabelTexture {
    texture: GfxTexture;
    width: number;
    height: number;
}

// 3 floats world pos + 2 floats uv = 20 bytes.
const LABEL_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4;
const LABEL_FLOATS_PER_VERTEX = 5;

class LabelProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;

    public static ub_SceneParams = 0;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

uniform sampler2D u_LabelTexture;

varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = ${LabelProgram.a_Position}) in vec3 a_Position;
layout(location = ${LabelProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_LabelTexture), v_TexCoord);
    if (t_Color.a < 0.02)
        discard;
    gl_FragColor = t_Color;
}
`;
}

// Picks a balanced 2-line word split for `text` if the rendered single line
// exceeds `wrapPx`. Returns the array of lines (1 or 2). Single-word strings
// never wrap — there's nowhere to break.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, wrapPx: number): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= 1)
        return [text];
    const singleWidth = ctx.measureText(text).width;
    if (singleWidth <= wrapPx)
        return [text];

    // Try each possible split between two adjacent words; pick the split that
    // minimises the max line width (most balanced wrap).
    let bestIdx = 1;
    let bestMax = Infinity;
    for (let i = 1; i < words.length; i++) {
        const left = words.slice(0, i).join(" ");
        const right = words.slice(i).join(" ");
        const lw = ctx.measureText(left).width;
        const rw = ctx.measureText(right).width;
        const m = Math.max(lw, rw);
        if (m < bestMax) {
            bestMax = m;
            bestIdx = i;
        }
    }
    return [words.slice(0, bestIdx).join(" "), words.slice(bestIdx).join(" ")];
}

// Rasterizes one label string (possibly wrapped to two lines) to an RGBA
// Uint8Array + dimensions using a 2D canvas. The text is drawn with a dark
// stroke under a bright fill so it stays readable over any background; alpha
// is straight (not premultiplied), so the shader does src-alpha-over.
function rasterizeLabel(text: string, style: LabelStyle): { rgba: Uint8Array, width: number, height: number } | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null)
        return null;

    ctx.font = style.font;
    const lines = wrapLines(ctx, text, style.wrapPx);

    // Per-line width (post-wrap); the canvas width tracks the widest line.
    // For line height, fall back to a font-size approximation if the bounding
    // box is missing (some browsers don't fill it for ASCII-only strings).
    let maxLineW = 0;
    for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxLineW) maxLineW = w;
    }
    const fontPx = parseFloat(style.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
    const lineHeight = fontPx * LINE_HEIGHT_FACTOR;
    const textBlockH = Math.ceil(lineHeight * lines.length);
    const textBlockW = Math.ceil(maxLineW);

    const pad = LABEL_PADDING + style.outlinePx;
    const width = textBlockW + pad * 2;
    const height = textBlockH + pad * 2;
    if (width <= 0 || height <= 0)
        return null;
    canvas.width = width;
    canvas.height = height;

    // measureText reset the context state on resize; restore the font.
    ctx.font = style.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = style.outlinePx;
    ctx.strokeStyle = style.strokeStyle;
    ctx.fillStyle = style.fillStyle;

    const cx = width / 2;
    // First line baseline: top of text block + half a line; subsequent lines
    // step down by one full line height.
    const blockTop = pad;
    for (let i = 0; i < lines.length; i++) {
        const cy = blockTop + lineHeight * (i + 0.5);
        if (style.outlinePx > 0)
            ctx.strokeText(lines[i], cx, cy);
        ctx.fillText(lines[i], cx, cy);
    }

    const img = ctx.getImageData(0, 0, width, height);
    return { rgba: new Uint8Array(img.data.buffer.slice(0)), width, height };
}

// Owns the GPU resources for one styled name-label pass: a per-string texture
// cache and the shared billboard pipeline. Labels are registered once at
// setup; each frame, prepare rebuilds the camera-facing quad geometry against
// the live camera axes (reading each label's worldPos by reference so mob
// labels follow them as they walk) and submits one draw per unique texture.
export class NameLabelRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private device: GfxDevice;
    private style: LabelStyle;

    // One texture per distinct string (entities commonly share names).
    private textureCache = new Map<string, LabelTexture | null>();
    private labels: LabelInstance[] = [];

    private vertexBuffer: GfxIndexBufferDescriptor["buffer"] | null = null;
    private vertexCapacityVerts = 0;

    private scratchRight = vec3.create();
    private scratchUp = vec3.create();

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], style: LabelStyle) {
        this.device = device;
        this.style = style;
        this.program = cache.createProgram(new LabelProgram());

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: LabelProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: LabelProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: LABEL_VERTEX_STRIDE_BYTES, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: null,
        });

        // Bilinear so the text antialiases smoothly as the label scales with
        // distance; clamp at the edges.
        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    // Registers a label to draw. The string's texture is rasterized + uploaded
    // on first sight and cached for reuse.
    public addLabel(label: LabelInstance): void {
        if (label.text.length === 0)
            return;
        if (!this.textureCache.has(label.text))
            this.textureCache.set(label.text, this.buildTexture(label.text));
        this.labels.push(label);
    }

    private buildTexture(text: string): LabelTexture | null {
        const r = rasterizeLabel(text, this.style);
        if (r === null)
            return null;
        const texture = this.device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: r.width,
            height: r.height,
            depthOrArrayLayers: 1,
            numLevels: 1,
            dimension: GfxTextureDimension.n2D,
            usage: GfxTextureUsage.Sampled,
        });
        this.device.uploadTextureData(texture, 0, [r.rgba]);
        return { texture, width: r.width, height: r.height };
    }

    public get hasLabels(): boolean {
        return this.labels.length > 0;
    }

    // Rebuilds the camera-facing label quads and submits one draw per unique
    // label texture (labels sharing a string bind the texture once). Call
    // inside the renderer's prepare cycle in the transparent pass.
    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, cameraWorldMatrix: mat4): void {
        if (this.labels.length === 0)
            return;
        const renderInstManager = renderHelper.renderInstManager;
        const worldScale = this.style.worldScale;
        const margin = this.style.marginAboveSprite;

        // Camera right/up axes (world-to-camera columns 0 and 1) so the quad
        // faces the camera squarely from any angle.
        vec3.set(this.scratchRight, cameraWorldMatrix[0], cameraWorldMatrix[1], cameraWorldMatrix[2]);
        vec3.set(this.scratchUp, cameraWorldMatrix[4], cameraWorldMatrix[5], cameraWorldMatrix[6]);

        // Group labels by their texture so we emit each texture's quads
        // contiguously and bind it once. Drop labels whose texture failed.
        const byTexture = new Map<LabelTexture, LabelInstance[]>();
        for (const l of this.labels) {
            const tex = this.textureCache.get(l.text);
            if (tex === undefined || tex === null)
                continue;
            let list = byTexture.get(tex);
            if (list === undefined) {
                list = [];
                byTexture.set(tex, list);
            }
            list.push(l);
        }
        if (byTexture.size === 0)
            return;

        let totalQuads = 0;
        for (const list of byTexture.values())
            totalQuads += list.length;

        const vertexCount = totalQuads * 6;
        const data = new ArrayBuffer(vertexCount * LABEL_VERTEX_STRIDE_BYTES);
        const f = new Float32Array(data);

        const rx = this.scratchRight, uy = this.scratchUp;
        let vi = 0;
        // Each texture's draw range in the flattened vertex buffer.
        const ranges: { tex: LabelTexture, start: number, count: number }[] = [];

        const emit = (px: number, py: number, pz: number, u: number, v: number): void => {
            const o = vi * LABEL_FLOATS_PER_VERTEX;
            f[o + 0] = px; f[o + 1] = py; f[o + 2] = pz;
            f[o + 3] = u; f[o + 4] = v;
            vi++;
        };

        for (const [tex, list] of byTexture) {
            const start = vi;
            const halfW = tex.width * 0.5 * worldScale;
            const fullH = tex.height * worldScale;
            for (const l of list) {
                // Lift the label's bottom edge to sit a small margin above the
                // top of the sprite (l.heightAbove is the sprite's visible
                // height; world +Y is up, so the head is at larger Y than the
                // feet). Using world-up rather than camera-up keeps the label
                // a fixed height above the sprite regardless of camera pitch.
                const baseX = l.worldPos[0];
                const baseY = l.worldPos[1] + l.heightAbove + margin;
                const baseZ = l.worldPos[2];

                // Corners: TL, TR, BL, BR around the anchored bottom-center.
                const tlx = baseX - rx[0] * halfW + uy[0] * fullH;
                const tly = baseY - rx[1] * halfW + uy[1] * fullH;
                const tlz = baseZ - rx[2] * halfW + uy[2] * fullH;
                const trx = baseX + rx[0] * halfW + uy[0] * fullH;
                const try_ = baseY + rx[1] * halfW + uy[1] * fullH;
                const trz = baseZ + rx[2] * halfW + uy[2] * fullH;
                const blx = baseX - rx[0] * halfW;
                const bly = baseY - rx[1] * halfW;
                const blz = baseZ - rx[2] * halfW;
                const brx = baseX + rx[0] * halfW;
                const bry = baseY + rx[1] * halfW;
                const brz = baseZ + rx[2] * halfW;

                // UV v=0 at top of the texture, v=1 at the bottom.
                emit(tlx, tly, tlz, 0, 0);
                emit(trx, try_, trz, 1, 0);
                emit(blx, bly, blz, 0, 1);
                emit(trx, try_, trz, 1, 0);
                emit(brx, bry, brz, 1, 1);
                emit(blx, bly, blz, 0, 1);
            }
            ranges.push({ tex, start, count: vi - start });
        }

        if (vertexCount > this.vertexCapacityVerts) {
            if (this.vertexBuffer !== null)
                this.device.destroyBuffer(this.vertexBuffer);
            this.vertexBuffer = this.device.createBuffer(vertexCount * LABEL_VERTEX_STRIDE_BYTES, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
            this.vertexCapacityVerts = vertexCount;
        }
        if (this.vertexBuffer === null)
            return;
        this.device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(data));

        const vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setVertexInput(this.inputLayout, vertexBufferDescriptors, null);
        // TRANSLUCENT, sorted after particles/portals/weather (+ 1 layer bit) so
        // the labels always read over every other transparent overlay.
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);

        let offs = template.allocateUniformBuffer(LabelProgram.ub_SceneParams, 16);
        const mapped = template.mapUniformBufferF32(LabelProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, clipFromWorld);

        // Two-sided; depth test against the scene (default LessEqual) but no
        // depth write — 3D geometry occludes the text per-pixel, and labels
        // don't write depth themselves so they never occlude each other.
        // Straight src-alpha-over for the soft text edges.
        const megaState = template.setMegaStateFlags({
            cullMode: GfxCullMode.None,
            depthWrite: false,
        });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        // One draw per texture (each covers all labels sharing that string).
        for (const r of ranges) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setSamplerBindingsFromTextureMappings([{ gfxTexture: r.tex.texture, gfxSampler: this.sampler }]);
            renderInst.setDrawCount(r.count, r.start);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (const t of this.textureCache.values())
            if (t !== null)
                device.destroyTexture(t.texture);
        if (this.vertexBuffer !== null)
            device.destroyBuffer(this.vertexBuffer);
    }
}
