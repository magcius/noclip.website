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


