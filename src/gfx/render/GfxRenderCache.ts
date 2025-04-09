
import { hashCodeNumberFinish, hashCodeNumberUpdate, HashMap, nullHashFunc } from "../../HashMap.js";
import { GfxAttachmentState, GfxBindingLayoutDescriptor, GfxBindings, GfxBindingsDescriptor, GfxChannelBlendState, GfxColor, GfxDevice, GfxInputLayout, GfxInputLayoutDescriptor, GfxMegaStateDescriptor, GfxProgram, GfxRenderProgramDescriptor, GfxRenderPipeline, GfxRenderPipelineDescriptor, GfxSampler, GfxSamplerDescriptor, GfxVendorInfo } from "../platform/GfxPlatform.js";
import { gfxBindingsDescriptorCopy, gfxBindingsDescriptorEquals, gfxInputLayoutDescriptorCopy, gfxInputLayoutDescriptorEquals, gfxRenderPipelineDescriptorCopy, gfxRenderPipelineDescriptorEquals, gfxSamplerDescriptorEquals } from '../platform/GfxPlatformObjUtil.js';
import { assert } from "../platform/GfxPlatformUtil.js";

interface GfxProgramDescriptorPreproc extends GfxRenderProgramDescriptor {
    ensurePreprocessed(vendorInfo: GfxVendorInfo): void;
    associate(device: GfxDevice, program: GfxProgram): void;
}

function gfxProgramDescriptorEquals(a: GfxRenderProgramDescriptor, b: GfxRenderProgramDescriptor): boolean {
    assert(a.preprocessedVert !== '' && b.preprocessedVert !== '');
    assert(a.preprocessedFrag !== '' && b.preprocessedFrag !== '');
    return a.preprocessedVert === b.preprocessedVert && a.preprocessedFrag === b.preprocessedFrag;
}

function gfxProgramDescriptorCopy(a: GfxRenderProgramDescriptor): GfxRenderProgramDescriptor {
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

function gfxMegaStateDescriptorHash(hash: number, a: GfxMegaStateDescriptor): number {
    for (let i = 0; i < a.attachmentsState.length; i++)
        hash = gfxAttachmentStateHash(hash, a.attachmentsState[i]);
    hash = hashCodeNumberUpdate(hash, a.depthCompare);
    hash = hashCodeNumberUpdate(hash, a.depthWrite ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.stencilCompare);
    hash = hashCodeNumberUpdate(hash, a.stencilPassOp);
    hash = hashCodeNumberUpdate(hash, a.stencilWrite ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.cullMode);
    hash = hashCodeNumberUpdate(hash, a.frontFace ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.polygonOffset ? 1 : 0);
    hash = hashCodeNumberUpdate(hash, a.wireframe ? 1 : 0);
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

interface Expiry {
    expireFrameNum: number;
}

interface ExpiryBindings extends GfxBindings, Expiry {}

export class GfxRenderCache {
    private gfxBindingsCache = new HashMap<GfxBindingsDescriptor, ExpiryBindings>(gfxBindingsDescriptorEquals, gfxBindingsDescriptorHash);
    private gfxRenderPipelinesCache = new HashMap<GfxRenderPipelineDescriptor, GfxRenderPipeline>(gfxRenderPipelineDescriptorEquals, gfxRenderPipelineDescriptorHash);
    private gfxInputLayoutsCache = new HashMap<GfxInputLayoutDescriptor, GfxInputLayout>(gfxInputLayoutDescriptorEquals, nullHashFunc);
    private gfxProgramCache = new HashMap<GfxRenderProgramDescriptor, GfxProgram>(gfxProgramDescriptorEquals, nullHashFunc);
    private gfxSamplerCache = new HashMap<GfxSamplerDescriptor, GfxSampler>(gfxSamplerDescriptorEquals, nullHashFunc);

    constructor(public device: GfxDevice) {
    }

    public createBindings(descriptor: GfxBindingsDescriptor): GfxBindings {
        let bindings = this.gfxBindingsCache.get(descriptor);
        if (bindings === null) {
            const descriptorCopy = gfxBindingsDescriptorCopy(descriptor);
            bindings = this.device.createBindings(descriptorCopy) as ExpiryBindings;
            this.gfxBindingsCache.add(descriptorCopy, bindings);
        }
        bindings.expireFrameNum = 4;
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

    public createProgramSimple(descriptor: GfxRenderProgramDescriptor): GfxProgram {
        let program = this.gfxProgramCache.get(descriptor);
        if (program === null) {
            const descriptorCopy = gfxProgramDescriptorCopy(descriptor);
            program = this.device.createProgram(descriptorCopy);
            this.gfxProgramCache.add(descriptorCopy, program);

            // TODO(jstpierre): Ugliness
            if ('associate' in (descriptor as any)) {
                const p = descriptor as GfxProgramDescriptorPreproc;
                p.associate(this.device, program);
                (descriptorCopy as any).orig = p;
            }
        }

        return program;
    }

    public createProgram(descriptor: GfxRenderProgramDescriptor): GfxProgram {
        // TODO(jstpierre): Remove the ensurePreprocessed here... this should be done by higher-level code.
        const p = descriptor as GfxProgramDescriptorPreproc;
        p.ensurePreprocessed(this.device.queryVendorInfo());
        return this.createProgramSimple(descriptor);
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

    public prepareToRender(): void {
        for (const [key, value] of this.gfxBindingsCache.items()) {
            if (--value.expireFrameNum <= 0) {
                this.gfxBindingsCache.delete(key);
                this.device.destroyBindings(value);
            }
        }
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
