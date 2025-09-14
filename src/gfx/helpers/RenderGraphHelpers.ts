
import { GfxColor, GfxFormat } from "../platform/GfxPlatform.js";
import { colorNewFromRGBA, OpaqueBlack } from "../../Color.js";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers.js";
import { GfxrAttachmentClearDescriptor, GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../render/GfxRenderGraph.js";
import { FXAA } from "../passes/FXAA.js";
import { GfxRenderHelper } from "../render/GfxRenderHelper.js";

export function makeAttachmentClearDescriptor(clearColor: Readonly<GfxColor> | 'load'): GfxrAttachmentClearDescriptor {
    return {
        clearColor: clearColor,
        clearDepth: reverseDepthForClearValue(1.0),
        clearStencil: 0.0,
    }
}

export const standardFullClearRenderPassDescriptor = makeAttachmentClearDescriptor(colorNewFromRGBA(0.88, 0.88, 0.88, 1.0));
export const opaqueBlackFullClearRenderPassDescriptor = makeAttachmentClearDescriptor(OpaqueBlack);

export enum AntialiasingMode {
    None, FXAA, MSAAx4,
}

interface RenderInput {
    backbufferWidth: number;
    backbufferHeight: number;
    antialiasingMode: AntialiasingMode;
}

function selectFormatSimple(slot: GfxrAttachmentSlot): GfxFormat {
    if (slot === GfxrAttachmentSlot.Color0)
        return GfxFormat.U8_RGBA_RT;
    else if (slot === GfxrAttachmentSlot.DepthStencil)
        return GfxFormat.D24;
    else
        throw "whoops";
}

function selectSampleCount(renderInput: RenderInput): number {
    if (renderInput.antialiasingMode === AntialiasingMode.MSAAx4)
        return 4;
    else
        return 1;
}

export function setBackbufferDescSimple(desc: GfxrRenderTargetDescription, renderInput: RenderInput): void {
    const sampleCount = selectSampleCount(renderInput);
    desc.setDimensions(renderInput.backbufferWidth, renderInput.backbufferHeight, sampleCount);
}

export function makeBackbufferDescSimple(slot: GfxrAttachmentSlot, renderInput: RenderInput, clearDescriptor: GfxrAttachmentClearDescriptor): GfxrRenderTargetDescription {
    const pixelFormat = selectFormatSimple(slot);
    const desc = new GfxrRenderTargetDescription(pixelFormat);

    setBackbufferDescSimple(desc, renderInput);

    if (clearDescriptor !== null) {
        desc.clearColor = clearDescriptor.clearColor;
        desc.clearDepth = clearDescriptor.clearDepth;
        desc.clearStencil = clearDescriptor.clearStencil;
    }

    return desc;
}

export class AntialiasingSupport {
    private fxaa: FXAA | null = null;

    constructor(private renderHelper: GfxRenderHelper) {
    }

    public pushPasses(builder: GfxrGraphBuilder, renderInput: RenderInput, mainColorTargetID: GfxrRenderTargetID): void {
        if (renderInput.antialiasingMode === AntialiasingMode.FXAA) {
            if (this.fxaa === null)
                this.fxaa = new FXAA(this.renderHelper.renderCache);

            this.fxaa.pushPasses(builder, this.renderHelper, mainColorTargetID);
        }
    }
}
