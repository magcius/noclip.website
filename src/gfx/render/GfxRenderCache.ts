
import { GfxBindingsDescriptor, GfxBindings, GfxDevice, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxProgram, GfxInputLayoutDescriptor, GfxInputLayout, GfxSamplerDescriptor, GfxSampler, GfxProgramDescriptor, GfxProgramDescriptorSimple, GfxBindingLayoutDescriptor, GfxMegaStateDescriptor, GfxColor, GfxAttachmentState, GfxChannelBlendState, GfxComputeProgramDescriptor } from "../platform/GfxPlatform";
import { gfxBindingsDescriptorCopy, gfxRenderPipelineDescriptorCopy, gfxBindingsDescriptorEquals, gfxRenderPipelineDescriptorEquals, gfxInputLayoutDescriptorEquals, gfxSamplerDescriptorEquals, gfxInputLayoutDescriptorCopy } from '../platform/GfxPlatformUtil';
import { HashMap, nullHashFunc, hashCodeNumberFinish, hashCodeNumberUpdate } from "../../HashMap";
import { assert } from "../platform/GfxPlatformUtil";

function gfxProgramDescriptorSimpleEquals(a: GfxProgramDescriptorSimple, b: GfxProgramDescriptorSimple): boolean {
    assert(a.preprocessedVert !== '' && b.preprocessedVert !== '');
    assert(a.preprocessedFrag !== '' && b.preprocessedFrag !== '');
    return a.preprocessedVert === b.preprocessedVert && a.preprocessedFrag === b.preprocessedFrag;
}

function gfxProgramDescriptorSimpleCopy(a: GfxProgramDescriptorSimple): GfxProgramDescriptorSimple {
    const preprocessedVert = a.preprocessedVert;
    const preprocessedFrag = a.preprocessedFrag;
    return { preprocessedVert, preprocessedFrag };
}

function gfxRenderBindingLayoutHash(hash: number, a: GfxBindingLayoutDescriptor): number {
    hash = hashCodeNumberUpdate(hash, a.numUniformBuffers);
    hash = hashCodeNumberUpdate(hash, a.numSamplers);
    return hash;
}

function gfxBlendStateHash(hash: number, a: GfxChannelBlendState): number {
    hash = hashCodeNumberUpdate(hash, a.blendMode);
    hash = hashCodeNumberUpdate(hash, a.blendSrcFactor);
    hash = hashCodeNumberUpdate(hash, a.blendDstFactor);
    return hash;
}

function gfxAttachmentStateHash(hash: number, a: GfxAttachmentState): number {
    hash = gfxBlendStateHash(hash, a.rgbBlendState);
    hash = gfxBlendStateHash(hash, a.alphaBlendState);
    hash = hashCodeNumberUpdate(hash, a.channelWriteMask);
    return hash;
}

function gfxColorHash(hash: number, a: GfxColor): number {
    hash = hashCodeNumberUpdate(hash, (a.r << 24) | (a.g << 16) | (a.b << 8) | a.a);
    return hash;
}

function gfxMegaStateDescriptorHash(hash: number, a: GfxMegaStateDescriptor): number {
    for (let i = 0; i < a.attachmentsState.length; i++)
        hash = gfxAttachmentStateHash(hash, a.attachmentsState[i]);
    hash = gfxColorHash(hash, a.blendConstant);
    hash = hashCodeNumberUpdate(hash, a.depthCompare);
    hash = hashCodeNumberUpdate(hash, a.depthWrite ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.stencilCompare);
    hash = hashCodeNumberUpdate(hash, a.stencilPassOp);
    hash = hashCodeNumberUpdate(hash, a.stencilWrite ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.cullMode);
    hash = hashCodeNumberUpdate(hash, a.frontFace ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.polygonOffset ? 1 : 0);
    return hash;
}

function gfxRenderPipelineDescriptorHash(a: GfxRenderPipelineDescriptor): number {
    let hash = 0;
    hash = hashCodeNumberUpdate(hash, a.program.ResourceUniqueId);
    if (a.inputLayout !== null)
        hash = hashCodeNumberUpdate(hash, a.inputLayout.ResourceUniqueId);
    for (let i = 0; i < a.bindingLayouts.length; i++)
        hash = gfxRenderBindingLayoutHash(hash, a.bindingLayouts[i]);
    hash = gfxMegaStateDescriptorHash(hash, a.megaStateDescriptor);
    for (let i = 0; i < a.colorAttachmentFormats.length; i++)
        hash = hashCodeNumberUpdate(hash, a.colorAttachmentFormats[i] || 0);
    hash = hashCodeNumberUpdate(hash, a.depthStencilAttachmentFormat || 0);
    return hashCodeNumberFinish(hash);
}

function gfxBindingsDescriptorHash(a: GfxBindingsDescriptor): number {
    let hash: number = 0;
    for (let i = 0; i < a.samplerBindings.length; i++) {
        const binding = a.samplerBindings[i];
        if (binding !== null && binding.gfxTexture !== null)
            hash = hashCodeNumberUpdate(hash, binding.gfxTexture.ResourceUniqueId);
    }
    for (let i = 0; i < a.uniformBufferBindings.length; i++) {
        const binding = a.uniformBufferBindings[i];
        if (binding !== null && binding.buffer !== null) {
            hash = hashCodeNumberUpdate(hash, binding.buffer.ResourceUniqueId);
            hash = hashCodeNumberUpdate(hash, binding.wordCount);
        }
    }
    return hashCodeNumberFinish(hash);
}

export class GfxRenderCache {
    private gfxBindingsCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, gfxBindingsDescriptorHash);
    private gfxRenderPipelinesCache = new HashMap<GfxRenderPipelineDescriptor, GfxRenderPipeline>(gfxRenderPipelineDescriptorEquals, gfxRenderPipelineDescriptorHash);
    private gfxInputLayoutsCache = new HashMap<GfxInputLayoutDescriptor, GfxInputLayout>(gfxInputLayoutDescriptorEquals, nullHashFunc);
    private gfxProgramCache = new HashMap<GfxProgramDescriptorSimple, GfxProgram>(gfxProgramDescriptorSimpleEquals, nullHashFunc);
    private gfxSamplerCache = new HashMap<GfxSamplerDescriptor, GfxSampler>(gfxSamplerDescriptorEquals, nullHashFunc);

    constructor(public device: GfxDevice) {
    }

    public createBindings(descriptor: GfxBindingsDescriptor): GfxBindings {
        let bindings = this.gfxBindingsCache.get(descriptor);
        if (bindings === null) {
            const descriptorCopy = gfxBindingsDescriptorCopy(descriptor);
            bindings = this.device.createBindings(descriptorCopy);
            this.gfxBindingsCache.add(descriptorCopy, bindings);
        }
        return bindings;
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        let renderPipeline = this.gfxRenderPipelinesCache.get(descriptor);
        if (renderPipeline === null) {
            const descriptorCopy = gfxRenderPipelineDescriptorCopy(descriptor);
            renderPipeline = this.device.createRenderPipeline(descriptorCopy);
            this.gfxRenderPipelinesCache.add(descriptorCopy, renderPipeline);
        }
        return renderPipeline;
    }

    public createInputLayout(descriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        let inputLayout = this.gfxInputLayoutsCache.get(descriptor);
        if (inputLayout === null) {
            const descriptorCopy = gfxInputLayoutDescriptorCopy(descriptor);
            inputLayout = this.device.createInputLayout(descriptorCopy);
            this.gfxInputLayoutsCache.add(descriptorCopy, inputLayout);
        }
        return inputLayout;
    }

    public createProgramSimple(gfxProgramDescriptorSimple: GfxProgramDescriptorSimple): GfxProgram {
        let program = this.gfxProgramCache.get(gfxProgramDescriptorSimple);
        if (program === null) {
            const descriptorCopy = gfxProgramDescriptorSimpleCopy(gfxProgramDescriptorSimple);
            program = this.device.createProgramSimple(descriptorCopy);
            this.gfxProgramCache.add(descriptorCopy, program);

            // TODO(jstpierre): Ugliness
            if ('associate' in (gfxProgramDescriptorSimple as any)) {
                const gfxProgramDescriptor = gfxProgramDescriptorSimple as GfxProgramDescriptor;
                gfxProgramDescriptor.associate(this.device, program);
                (descriptorCopy as any).orig = gfxProgramDescriptor;
            }
        }

        return program;
    }

    public createProgram(gfxProgramDescriptor: GfxProgramDescriptor): GfxProgram {
        // TODO(jstpierre): Remove the ensurePreprocessed here... this should be done by higher-level code.
        gfxProgramDescriptor.ensurePreprocessed(this.device.queryVendorInfo());
        return this.createProgramSimple(gfxProgramDescriptor);
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        let sampler = this.gfxSamplerCache.get(descriptor);
        if (sampler === null) {
            sampler = this.device.createSampler(descriptor);
            this.gfxSamplerCache.add(descriptor, sampler);
        }
        return sampler;
    }

    public numBindings(): number {
        return this.gfxBindingsCache.size();
    }

    public destroy(): void {
        for (const bindings of this.gfxBindingsCache.values())
            this.device.destroyBindings(bindings);
        for (const renderPipeline of this.gfxRenderPipelinesCache.values())
            this.device.destroyRenderPipeline(renderPipeline);
        for (const inputLayout of this.gfxInputLayoutsCache.values())
            this.device.destroyInputLayout(inputLayout);
        for (const program of this.gfxProgramCache.values())
            this.device.destroyProgram(program);
        for (const sampler of this.gfxSamplerCache.values())
            this.device.destroySampler(sampler);
        this.gfxBindingsCache.clear();
        this.gfxRenderPipelinesCache.clear();
        this.gfxInputLayoutsCache.clear();
        this.gfxProgramCache.clear();
        this.gfxSamplerCache.clear();
    }
}
