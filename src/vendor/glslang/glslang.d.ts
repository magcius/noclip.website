declare type ShaderStage = 'vertex' | 'fragment' | 'compute';

declare interface ResultZeroCopy {
    readonly data: Uint32Array;
    free(): void;
}

declare interface Glslang {
    compileGLSLZeroCopy(glsl: string, shader_stage: ShaderStage, gen_debug: boolean): ResultZeroCopy;
    compileGLSL(glsl: string, shader_type: ShaderStage, gen_debug: boolean): Uint32Array;
}

export default function(wasmPath: string): Promise<Glslang>;
