import * as RDP from '../Common/N64/RDP';

//TODO: verify these 
let colorA = [
    "COMBINED",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "1",
    "NOISE",
    "0","0","0","0","0","0","0","0",
];

let colorB = [
    "COMBINED",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "CENTER",
    "K4",
    "0","0","0","0","0","0","0","0",
];

let colorC = [
    "COMBINED",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "SCALE",
    "COMBINED_ALPHA",
    "TEXEL0_ALPHA",
    "TEXEL1_ALPHA",
    "PRIMITIVE_ALPHA",
    "SHADE_ALPHA",
    "ENV_ALPHA",
    "LOD_FRACTION",
    "PRIM_LOD_FRAC",
    "K5",
    "0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0"
];

let colorD = [
    "COMBINED",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "1",
    "0"
];

let alphaABD = [
    "COMBINED",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "1",
    "0"
];

let alphaC = [
    "LOD_FRACTION",
    "TEXEL0",
    "TEXEL1",
    "PRIMITIVE",
    "SHADE",
    "ENVIRONMENT",
    "PRIM_LOD_FRAC",
    "0"
];

function ccString(a: string, b: string, c: string, d: string) {
    return `(${a} - ${b}) * ${c} + ${d}`;
}

export function humanReadableCombineParams(combineParams: RDP.CombineParams) {
    let c0 = ccString(
        colorA[combineParams.c0.a],
        colorB[combineParams.c0.b],
        colorC[combineParams.c0.c],
        colorD[combineParams.c0.d],
    );
    let c1 = ccString(
        colorA[combineParams.c1.a],
        colorB[combineParams.c1.b],
        colorC[combineParams.c1.c],
        colorD[combineParams.c1.d],
    )
    let a0 = ccString(
        alphaABD[combineParams.a0.a],
        alphaABD[combineParams.a0.b],
        alphaC[combineParams.a0.c],
        alphaABD[combineParams.a0.d],
    )
    let a1 = ccString(
        alphaABD[combineParams.a1.a],
        alphaABD[combineParams.a1.b],
        alphaC[combineParams.a1.c],
        alphaABD[combineParams.a1.d],
    );
    return `Cycle 0:
    Color: ${c0}
    Alpha: ${a0}
Cycle 1:
   Color: ${c1}
   Alpha: ${a1}
`;
}