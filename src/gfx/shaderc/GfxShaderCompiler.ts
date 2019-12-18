
import { assert } from "../../util";
import { GfxVendorInfo, GfxProgramDescriptorSimple } from "../platform/GfxPlatform";

// Shader preprocessor / compiler infrastructure for GLSL.

export function preprocessShader_GLSL(vendorInfo: GfxVendorInfo, type: 'vert' | 'frag', source: string, defines: Map<string, string> | null = null): string {
    // Garbage WebGL2 shader compiler until I get something better down the line...
    const lines = source.split('\n').map((n) => {
        // Remove comments.
        return n.replace(/[/][/].*$/, '');
    }).filter((n) => {
        // Filter whitespace.
        const isEmpty = !n || /^\s+$/.test(n);
        return !isEmpty;
    });

    let definesString: string = '';
    if (defines !== null)
        definesString = [... defines.entries()].map(([k, v]) => `#define ${k} ${v}`).join('\n');

    const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
    let rest = lines.filter((line) => !line.startsWith('precision')).join('\n');

    let outLayout = '';
    if (vendorInfo.explicitBindingLocations) {
        let set = 0, binding = 0, location = 0;

        rest = rest.replace(/layout\((.*)\)\s+uniform/g, (substr, layout) => {
            return `layout(${layout}, set = ${set}, binding = ${binding++}) uniform`;
        });

        assert(vendorInfo.separateSamplerTextures);
        rest = rest.replace(/uniform sampler2D (.*);/g, (substr, samplerName) => {
            // Can't have samplers in vertex for some reason.
            return type === 'frag' ? `
layout(set = ${set}, binding = ${binding++}) uniform texture2D T_${samplerName};
layout(set = ${set}, binding = ${binding++}) uniform sampler S_${samplerName};
` : '';
        });

        rest = rest.replace(/^varying/gm, (substr, layout) => {
            return `layout(location = ${location++}) varying`;
        });

        outLayout = 'layout(location = 0) ';
    }

    if (vendorInfo.separateSamplerTextures) {
        rest = rest.replace(/SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `sampler2D(T_${samplerName}, S_${samplerName})`;
        });
    } else {
        rest = rest.replace(/SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return samplerName;
        });
    }

        let matrixDefines: string;
        if (vendorInfo.bugQuirks.rowMajorMatricesBroken) {
            matrixDefines = `
struct Mat4x4 { vec4 _m[4]; };
struct Mat4x3 { vec4 _m[3]; };
struct Mat4x2 { vec4 _m[2]; };
vec4 Mul(Mat4x4 m, vec4 v) { return vec4(dot(m._m[0], v), dot(m._m[1], v), dot(m._m[2], v), dot(m._m[3], v)); }
vec3 Mul(Mat4x3 m, vec4 v) { return vec3(dot(m._m[0], v), dot(m._m[1], v), dot(m._m[2], v)); }
vec4 Mul(vec3 v, Mat4x3 m) { return vec4(
    dot(vec3(m._m[0].x, m._m[1].x, m._m[2].x), v),
    dot(vec3(m._m[0].y, m._m[1].y, m._m[2].y), v),
    dot(vec3(m._m[0].z, m._m[1].z, m._m[2].z), v),
    dot(vec3(m._m[0].w, m._m[1].w, m._m[2].w), v)
); }
vec2 Mul(Mat4x2 m, vec4 v) { return vec2(dot(m._m[0], v), dot(m._m[1], v)); }
void Fma(Mat4x3 d, Mat4x3 m, float s) { d._m[0] += m._m[0] * s; d._m[1] += m._m[1] * s; d._m[2] += m._m[2] * s; }
Mat4x4 _Mat4x4(Mat4x3 m) { Mat4x4 o; o._m[0] = m._m[0]; o._m[1] = m._m[1]; o._m[2] = m._m[2]; o._m[3] = vec4(0, 0, 0, 1); return o; }
Mat4x4 _Mat4x4(float n) { Mat4x4 o; o._m[0].x = n; o._m[1].y = n; o._m[2].z = n; o._m[3].w = n; return o; }
Mat4x3 _Mat4x3(Mat4x4 m) { Mat4x3 o; o._m[0] = m._m[0]; o._m[1] = m._m[1]; o._m[2] = m._m[2]; return o; }
Mat4x3 _Mat4x3(float n) { Mat4x3 o; o._m[0].x = n; o._m[1].y = n; o._m[2].z = n; return o; }
`;
        } else {
            matrixDefines = `
#define Mat4x4 mat4x4
#define Mat4x3 mat4x3
#define Mat4x2 mat4x2
#define _Mat4x4 mat4x4
#define _Mat4x3 mat4x3
#define Mul(A, B) (A * B)
#define Fma(D, M, S) (D += (M) * (S))
`;
        }

        return `
${vendorInfo.glslVersion}
${precision}
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
#define gl_FragColor o_color
${matrixDefines}
${definesString}
${type === 'frag' ? `${outLayout}out vec4 o_color;` : ''}
${rest}
`.trim();
}

export function preprocessProgram_GLSL(vendorInfo: GfxVendorInfo, vert: string, frag: string, defines: Map<string, string> | null = null): GfxProgramDescriptorSimple {
    const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', vert, defines);
    const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', frag, defines);
    return { preprocessedVert, preprocessedFrag };
}
