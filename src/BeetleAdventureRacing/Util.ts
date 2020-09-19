import * as RDP from '../Common/N64/RDP';


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

//TODO: replace this with the version in RDP.ts
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
    Color: ${c0} (${combineParams.c0.a}, ${combineParams.c0.b}, ${combineParams.c0.c}, ${combineParams.c0.d})
    Alpha: ${a0} (${combineParams.a0.a}, ${combineParams.a0.b}, ${combineParams.a0.c}, ${combineParams.a0.d})
Cycle 1:
   Color: ${c1} (${combineParams.c1.a}, ${combineParams.c1.b}, ${combineParams.c1.c}, ${combineParams.c1.d})
   Alpha: ${a1} (${combineParams.a1.a}, ${combineParams.a1.b}, ${combineParams.a1.c}, ${combineParams.a1.d})
`;
}


export function generateCycleDependentBlenderSettingsString(settings: number) {
    let pm = [
        "CLR_IN",
        "CLR_MEM",
        "CLR_BLEND",
        "CLR_FOG"
    ];
    
    let a = [
        "A_IN",
        "A_FOG",
        "A_SHADE",
        "0"
    ];
    
    let b = [
        "(1 - A)",
        "A_MEM",
        "1",
        "0"
    ]

    let p1 = pm[(settings >> 14) & 0x3];
    let p2 = pm[(settings >> 12) & 0x3];
    let a1 =  a[(settings >> 10) & 0x3];
    let a2 =  a[(settings >>  8) & 0x3];
    let m1 = pm[(settings >>  6) & 0x3];
    let m2 = pm[(settings >>  4) & 0x3];
    let b1 =  b[(settings >>  2) & 0x3];
    let b2 =  b[(settings >>  0) & 0x3];
    return `Cycle 0: (${p1} * ${a1} + ${m1} * ${b1}) / (${a1} + ${b1})
Cycle 1: (${p2} * ${a2} + ${m2} * ${b2}) / (${a2} + ${b2})`;
}


