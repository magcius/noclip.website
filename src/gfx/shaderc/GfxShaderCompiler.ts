
import { GfxVendorInfo, GfxProgramDescriptorSimple, GfxDevice, GfxViewportOrigin, GfxClipSpaceNearZ } from "../platform/GfxPlatform";
import { assert } from "../platform/GfxPlatformUtil";
import { GfxShaderLibrary } from "../helpers/GfxShaderLibrary";

// Shader preprocessor / compiler infrastructure for GLSL.

type DefineMap = Map<string, string>;

function defineStr(k: string, v: string): string {
    return `#define ${k} ${v}`;
}

function parseBinding(layout: string | undefined): number | null {
    if (layout === undefined)
        return null;

    const g = (/binding\s*=\s*(\d+)/).exec(layout);
    if (g !== null) {
        const bindingNum = parseInt(g[1], 10);
        if (!Number.isNaN(bindingNum))
            return bindingNum;
    }

    return null;
}

function getSeparateSamplerTypes(combinedSamplerType: string): [string, string] {
    let samplerType = ``, textureType = combinedSamplerType;
    if (combinedSamplerType.endsWith(`Shadow`)) {
        textureType = textureType.slice(0, -6);
        samplerType = `Shadow`;
    }
    return [textureType, samplerType];
}

export function preprocessShader_GLSL(vendorInfo: GfxVendorInfo, type: 'vert' | 'frag', source: string, defines: DefineMap | null = null): string {
    // Garbage WebGL2 shader compiler until I get something better down the line...
    const lines = source.split('\n').map((n) => {
        // Remove comments.
        return n.replace(/\s*[/][/].*$/, '');
    }).filter((n) => {
        // Filter whitespace.
        const isEmpty = !n || /^\s+$/.test(n);
        return !isEmpty;
    });

    let definesString: string = '';
    if (defines !== null)
        definesString = [... defines.entries()].map(([k, v]) => defineStr(k, v)).join('\n');

    let precision = lines.filter((line) => line.startsWith('precision')).join('\n') || 'precision mediump float;';
    let rest = lines.filter((line) => !line.startsWith('precision')).join('\n');
    let extraDefines = '';

    if (vendorInfo.viewportOrigin === GfxViewportOrigin.UpperLeft)
        extraDefines += `${defineStr(`GFX_VIEWPORT_ORIGIN_TL`, `1`)}\n`;
    if (vendorInfo.clipSpaceNearZ === GfxClipSpaceNearZ.Zero)
        extraDefines += `${defineStr(`GFX_CLIPSPACE_NEAR_ZERO`, `1`)}\n`;

    let outLayout = '';
    if (vendorInfo.explicitBindingLocations) {
        let set = 0, implicitBinding = 0, location = 0;

        rest = rest.replace(/^(layout\((.*)\))?\s*uniform(.+{)$/gm, (substr, cap, layout, rest) => {
            const layout2 = layout ? `${layout}, ` : ``;
            return `layout(${layout2}set = ${set}, binding = ${implicitBinding++}) uniform ${rest}`;
        });

        // XXX(jstpierre): WebGPU now binds UBOs and textures in different sets as a porting hack, hrm...
        set++;
        implicitBinding = 0;

        assert(vendorInfo.separateSamplerTextures);
        rest = rest.replace(/^(layout\((.*)\))?\s*uniform sampler(\w+) (.*);/gm, (substr, cap, layout, combinedSamplerType, samplerName) => {
            let binding = parseBinding(layout);
            if (binding === null)
                binding = implicitBinding++;

            const [textureType, samplerType] = getSeparateSamplerTypes(combinedSamplerType);
            return type === 'frag' ? `
layout(set = ${set}, binding = ${(binding * 2) + 0}) uniform texture${textureType} T_${samplerName};
layout(set = ${set}, binding = ${(binding * 2) + 1}) uniform sampler${samplerType} S_${samplerName};`.trim() : '';
        });

        rest = rest.replace(type === 'frag' ? /^\b(varying|in)\b/gm : /^\b(varying|out)\b/gm, (substr, tok) => {
            return `layout(location = ${location++}) ${tok}`;
        });

        outLayout = 'layout(location = 0) ';

        extraDefines += `${defineStr(`gl_VertexID`, `gl_VertexIndex`)}\n`;
        extraDefines += `${defineStr(`gl_InstanceID`, `gl_InstanceIndex`)}\n`;

        // Workaround for Naga
        // https://github.com/gfx-rs/naga/issues/1353
        precision = precision.replace(/^precision (.*) sampler(.*);$/gm, '');
    } else {
        let implicitBinding = 0;
        rest = rest.replace(/^(layout\((.*)\))?\s*uniform sampler(\w+) (.*);/gm, (substr, cap, layout, combinedSamplerType, samplerName) => {
            let binding = parseBinding(layout);
            if (binding === null)
                binding = implicitBinding++;

            return `uniform sampler${combinedSamplerType} ${samplerName}; // BINDING=${binding}`;
        });
    }

    rest = rest.replace(/\bPU_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
        return `SAMPLER_${combinedSamplerType}(P_${samplerName})`;
    });

    rest = rest.replace(/\bPF_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
        return `PP_SAMPLER_${combinedSamplerType}(P_${samplerName})`;
    });

    rest = rest.replace(/\bPU_TEXTURE\((.*?)\)/g, (substr, samplerName) => {
        return `TEXTURE(P_${samplerName})`;
    });

    if (vendorInfo.separateSamplerTextures) {
        rest = rest.replace(/\bPD_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            const [textureType, samplerType] = getSeparateSamplerTypes(combinedSamplerType);
            return `texture${textureType} T_P_${samplerName}, sampler${samplerType} S_P_${samplerName}`;
        });

        rest = rest.replace(/\bPP_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            return `T_${samplerName}, S_${samplerName}`;
        });

        rest = rest.replace(/\bSAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            return `sampler${combinedSamplerType}(T_${samplerName}, S_${samplerName})`;
        });

        rest = rest.replace(/\bTEXTURE\((.*?)\)/g, (substr, samplerName) => {
            return `T_${samplerName}`;
        });
    } else {
        rest = rest.replace(/\bPD_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            return `sampler${combinedSamplerType} P_${samplerName}`;
        });

        rest = rest.replace(/\bPP_SAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            return samplerName;
        });

        rest = rest.replace(/\bSAMPLER_(\w+)\((.*?)\)/g, (substr, combinedSamplerType, samplerName) => {
            return samplerName;
        });

        rest = rest.replace(/\bTEXTURE\((.*?)\)/g, (substr, samplerName) => {
            return samplerName;
        });
    }

    const hasFragColor = rest.includes('gl_FragColor');

    let concat = `
${vendorInfo.glslVersion}
${precision}
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
${extraDefines}
${hasFragColor ? `
#define gl_FragColor o_color
${type === 'frag' ? `out vec4 o_color;` : ''}
` : ``}
${GfxShaderLibrary.mat4}
${definesString}
${rest}
`.trim();

    if (vendorInfo.explicitBindingLocations && type === 'frag') {
        concat = concat.replace(/^\b(out)\b/gm, (substr, tok) => {
            return `layout(location = 0) ${tok}`;
        });
    }

    return concat;
}

interface GfxProgramDescriptorSimpleWithOrig extends GfxProgramDescriptorSimple {
    vert: string;
    frag: string;
}

export function preprocessProgram_GLSL(vendorInfo: GfxVendorInfo, vert: string, frag: string, defines: DefineMap | null = null): GfxProgramDescriptorSimpleWithOrig {
    const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', vert, defines);
    const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', frag, defines);
    return { vert, frag, preprocessedVert, preprocessedFrag };
}

export interface GfxProgramObjBag {
    both?: string;
    vert: string;
    frag: string;
    defines?: DefineMap;
}

export function preprocessProgramObj_GLSL(device: GfxDevice, obj: GfxProgramObjBag): GfxProgramDescriptorSimpleWithOrig {
    const defines = obj.defines !== undefined ? obj.defines : null;
    const vert = obj.both !== undefined ? obj.both + obj.vert : obj.vert;
    const frag = obj.both !== undefined ? obj.both + obj.frag : obj.frag;
    return preprocessProgram_GLSL(device.queryVendorInfo(), vert, frag, defines);
}
