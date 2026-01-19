import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { MathConstants } from "../../MathHelpers";
import { getLoader } from "../Common";
import {
  BlendType,
  Func,
  type Interval,
  LerpHprInterval,
  LerpPosInterval,
  Parallel,
  Sequence,
  Wait,
} from "../interval";
import { ColorAttrib, DecalEffect } from "../nodes";
import { Actor } from "./Actor";

interface CharProperties {
  name: string;
  modelPathPrefix: string;
  lods: number[];
  height: number;
  speed: number;
  animations: Record<string, string>;
  paths: CharPaths;
}

interface CharPaths {
  nodes: Record<string, CharPathNode>;
  waypoints: CharPathWaypoint[];
}

interface CharPathNode {
  pos: ReadonlyVec3;
  adjacent: string[];
}

interface CharPathWaypoint {
  from: string;
  to: string;
  raycast: boolean;
  points: ReadonlyVec3[];
}

const MICKEY_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(17, -17, 4.025),
      adjacent: ["b", "e"],
    },
    b: {
      pos: vec3.fromValues(17.5, 7.6, 4.025),
      adjacent: ["c", "e"],
    },
    c: {
      pos: vec3.fromValues(85, 11.5, 4.025),
      adjacent: ["d"],
    },
    d: {
      pos: vec3.fromValues(85, -13, 4.025),
      adjacent: ["a"],
    },
    e: {
      pos: vec3.fromValues(-27.5, -5.25, 0.0), // bottom of central steps
      adjacent: ["a", "b", "f"],
    },
    f: {
      pos: vec3.fromValues(-106.15, -4.0, -2.5), // end of bridge (opposite gazebo)
      adjacent: ["e", "g", "h", "i"],
    },
    g: {
      pos: vec3.fromValues(-89.5, 93.5, 0.5), // sidewalk just South of Punchline Pl.
      adjacent: ["f", "h"],
    },
    h: {
      pos: vec3.fromValues(-139.95, 1.69, 0.5), // sidewalk in front of Loopy Ln.
      adjacent: ["f", "g", "i"],
    },
    i: {
      pos: vec3.fromValues(-110.95, -68.57, 0.5), // sidewalk in front of Loopy Ln.
      adjacent: ["f", "h"],
    },
  },
  waypoints: [
    { from: "a", to: "e", raycast: true, points: [] },
    { from: "b", to: "e", raycast: true, points: [] },
    {
      from: "e",
      to: "f",
      raycast: true,
      points: [
        vec3.fromValues(-76.87, -7.85, -1.85),
        vec3.fromValues(-80.57, -4.0, -1.85),
      ],
    },
    {
      from: "f",
      to: "g",
      raycast: true,
      points: [vec3.fromValues(-106.62, 28.65, -1.5)],
    },
    {
      from: "g",
      to: "h",
      raycast: true,
      points: [vec3.fromValues(-128.38, 60.27, 0.5)],
    },
    // { from: "g", to: "h", raycast: true, points: [vec3.fromValues(-134.96, 60.34, 0.5)] },
    { from: "h", to: "f", raycast: true, points: [] },
    {
      from: "h",
      to: "i",
      raycast: true,
      points: [vec3.fromValues(-137.13, -42.79, 0.5)],
    },
    { from: "i", to: "f", raycast: true, points: [] },
  ],
};

const MINNIE_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(53.334, 71.057, 6.525), // in front of horn, near TTCentral entrance
      adjacent: ["b", "r"],
    },
    b: {
      pos: vec3.fromValues(127.756, 58.665, -11.75), // on other side of horn
      adjacent: ["a", "s", "c"],
    },
    c: {
      pos: vec3.fromValues(130.325, 15.174, -2.003), // on piano keys
      adjacent: ["b", "d"],
    },
    d: {
      pos: vec3.fromValues(126.173, 7.057, 0.522), // higher on piano keys
      adjacent: ["c", "e"],
    },
    e: {
      pos: vec3.fromValues(133.843, -6.618, 4.71), // higher on piano keys
      adjacent: ["d", "f", "g", "h"],
    },
    f: {
      pos: vec3.fromValues(116.876, 1.119, 3.304), // on drum
      adjacent: ["e"],
    },
    g: {
      pos: vec3.fromValues(116.271, -41.568, 3.304), // on middle drum
      adjacent: ["e", "h"],
    },
    h: {
      pos: vec3.fromValues(128.983, -49.656, -0.231), // on piano keys
      adjacent: ["e", "g", "i", "j"],
    },
    i: {
      pos: vec3.fromValues(106.024, -75.249, -4.498), // on other drum
      adjacent: ["h"],
    },
    j: {
      pos: vec3.fromValues(135.016, -93.072, -13.376), // on ground by 2nd horn
      adjacent: ["h", "k", "z"],
    },
    k: {
      pos: vec3.fromValues(123.966, -100.242, -10.879), // on keys for 2nd horn
      adjacent: ["j", "l"],
    },
    l: {
      pos: vec3.fromValues(52.859, -109.081, 6.525), // on other side of 2nd horn
      adjacent: ["k", "m"],
    },
    m: {
      pos: vec3.fromValues(-32.071, -107.049, 6.525), // on other side of Dreamland entrance
      adjacent: ["l", "n"],
    },
    n: {
      pos: vec3.fromValues(-40.519, -99.685, 6.525), // stop at record player
      adjacent: ["m", "o"],
    },
    o: {
      pos: vec3.fromValues(-40.245, -88.634, 6.525), // further around upper area of safezone
      adjacent: ["n", "p"],
    },
    p: {
      pos: vec3.fromValues(-66.3, -62.192, 6.525), // near party gatefurther around upper area of safezone
      adjacent: ["o", "q"],
    },
    q: {
      pos: vec3.fromValues(-66.212, 23.069, 6.525), // further around upper area of safezone
      adjacent: ["p", "r"],
    },
    r: {
      pos: vec3.fromValues(-18.344, 69.532, 6.525), // at last turn on upper area of safezone
      adjacent: ["q", "a"],
    },
    s: {
      pos: vec3.fromValues(91.357, 44.546, -13.475), // on ground between piano and center area
      adjacent: ["b", "t"],
    },
    t: {
      pos: vec3.fromValues(90.355, 6.279, -13.475), // in center area near piano
      adjacent: ["s", "u"],
    },
    u: {
      pos: vec3.fromValues(-13.765, 42.362, -14.553), // in center area
      adjacent: ["t", "v"],
    },
    v: {
      pos: vec3.fromValues(-52.627, 7.428, -14.553), // in center area opposite piano
      adjacent: ["u", "w"],
    },
    w: {
      pos: vec3.fromValues(-50.654, -54.879, -14.553), // in center area opposite piano
      adjacent: ["v", "x"],
    },
    x: {
      pos: vec3.fromValues(-3.711, -81.819, -14.553), // in center area
      adjacent: ["w", "y"],
    },
    y: {
      pos: vec3.fromValues(90.777, -49.714, -13.475),
      adjacent: ["z", "x"],
    },
    z: {
      pos: vec3.fromValues(90.059, -79.426, -13.475),
      adjacent: ["j", "y"],
    },
  },
  waypoints: [
    { from: "a", to: "b", raycast: true, points: [] },
    { from: "k", to: "l", raycast: true, points: [] },
    { from: "b", to: "c", raycast: true, points: [] },
    { from: "c", to: "d", raycast: true, points: [] },
    { from: "d", to: "e", raycast: true, points: [] },
    { from: "e", to: "f", raycast: true, points: [] },
    { from: "e", to: "g", raycast: true, points: [] },
    { from: "e", to: "h", raycast: true, points: [] },
    { from: "g", to: "h", raycast: true, points: [] },
    { from: "h", to: "i", raycast: true, points: [] },
    { from: "h", to: "j", raycast: true, points: [] },
    { from: "s", to: "b", raycast: true, points: [] },
    { from: "t", to: "u", raycast: true, points: [] }, // curb down
    { from: "x", to: "y", raycast: true, points: [] }, // curb up
  ],
};

export const GOOFY_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(64.995, 169.665, 10.027), // in front of TTCentral entrance
      adjacent: ["b", "q"],
    },
    b: {
      pos: vec3.fromValues(48.893, 208.912, 10.027), // by flowers
      adjacent: ["a", "c"],
    },
    c: {
      pos: vec3.fromValues(5.482, 210.479, 10.03), // in front of trolley
      adjacent: ["b", "d"],
    },
    d: {
      pos: vec3.fromValues(-34.153, 203.284, 10.029), // near construction zone entrance
      adjacent: ["c", "e"],
    },
    e: {
      pos: vec3.fromValues(-66.656, 174.334, 10.026), // front construction zone entrance
      adjacent: ["d", "f"],
    },
    f: {
      pos: vec3.fromValues(-55.994, 162.33, 10.026), // top of ramp
      adjacent: ["e", "g"],
    },
    g: {
      pos: vec3.fromValues(-84.554, 142.099, 0.027), // down below ramp
      adjacent: ["f", "h"],
    },
    h: {
      pos: vec3.fromValues(-92.215, 96.446, 0.027), // toward flower bed
      adjacent: ["g", "i"],
    },
    i: {
      pos: vec3.fromValues(-63.168, 60.055, 0.027), // in front of flower bed
      adjacent: ["h", "j"],
    },
    j: {
      pos: vec3.fromValues(-37.637, 69.974, 0.027), // next to bush
      adjacent: ["i", "k"],
    },
    k: {
      pos: vec3.fromValues(-3.018, 26.157, 0.027), // front of Cog HQ entrance
      adjacent: ["j", "l", "m"],
    },
    l: {
      pos: vec3.fromValues(-0.711, 46.843, 0.027), // next to fountain
      adjacent: ["k"],
    },
    m: {
      pos: vec3.fromValues(26.071, 46.401, 0.027), // next to pond
      adjacent: ["k", "n"],
    },
    n: {
      pos: vec3.fromValues(30.87, 67.432, 0.027), // next to bush
      adjacent: ["m", "o"],
    },
    o: {
      pos: vec3.fromValues(93.903, 90.685, 0.027), // toward ramp
      adjacent: ["n", "p"],
    },
    p: {
      pos: vec3.fromValues(88.129, 140.575, 0.027), // below ramp
      adjacent: ["o", "q"],
    },
    q: {
      pos: vec3.fromValues(53.988, 158.232, 10.027), // top of ramp
      adjacent: ["p", "a"],
    },
  },
  waypoints: [
    { from: "f", to: "g", raycast: true, points: [] },
    { from: "p", to: "q", raycast: true, points: [] },
  ],
};

export const GOOFY_SPEEDWAY_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(-9.0, -19.517, -0.323), // near store rear entrance
      adjacent: ["b", "k"],
    },
    b: {
      pos: vec3.fromValues(-30.047, -1.578, -0.373), // by giant wrenches
      adjacent: ["a", "c"],
    },
    c: {
      pos: vec3.fromValues(-10.367, 49.042, -0.373), // in front of TTC entrance
      adjacent: ["b", "d"],
    },
    d: {
      pos: vec3.fromValues(38.439, 44.348, -0.373), // near car showoff platform
      adjacent: ["c", "e"],
    },
    e: {
      pos: vec3.fromValues(25.527, -2.395, -0.373), // near giant tires
      adjacent: ["d", "f"],
    },
    f: {
      pos: vec3.fromValues(-4.043, -59.865, -0.003), // in tunnel to track area
      adjacent: ["e", "g"],
    },
    g: {
      pos: vec3.fromValues(0.39, -99.475, -0.009), // in front of leaderboard
      adjacent: ["f", "h"],
    },
    h: {
      pos: vec3.fromValues(21.147, -109.127, -0.013), // near city race track
      adjacent: ["g", "i"],
    },
    i: {
      pos: vec3.fromValues(5.981, -147.606, -0.013), // near stadium race track
      adjacent: ["h", "j"],
    },
    j: {
      pos: vec3.fromValues(-24.898, -120.618, -0.013), // near rural race track
      adjacent: ["i", "k"],
    },
    k: {
      pos: vec3.fromValues(-2.71, -90.315, -0.011), // near tunnel to kart shop
      adjacent: ["j", "a"],
    },
  },
  waypoints: [
    { from: "a", to: "k", raycast: true, points: [] },
    { from: "k", to: "a", raycast: true, points: [] },
  ],
};

export const DONALD_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(-94.883, -94.024, 0.025), // corner near melodyland entrance
      adjacent: ["b"],
    },
    b: {
      pos: vec3.fromValues(-13.962, -92.233, 0.025), // front of melodyland entrance
      adjacent: ["a", "h"],
    },
    c: {
      pos: vec3.fromValues(68.417, -91.929, 0.025), // by trolley
      adjacent: ["m", "g"],
    },
    d: {
      pos: vec3.fromValues(68.745, 91.227, 0.025), // across bed from trolley
      adjacent: ["k", "i"],
    },
    e: {
      pos: vec3.fromValues(4.047, 94.26, 0.025), // front of cog hq. entrance
      adjacent: ["i", "j"],
    },
    f: {
      pos: vec3.fromValues(-91.271, 90.987, 0.025), // corner near cog hq. entrance
      adjacent: ["j"],
    },
    g: {
      pos: vec3.fromValues(43.824, -94.129, 0.025), // in front of trolley
      adjacent: ["c", "h"],
    },
    h: {
      pos: vec3.fromValues(13.905, -91.334, 0.025), // near melodyland entrance
      adjacent: ["b", "g"],
    },
    i: {
      pos: vec3.fromValues(43.062, 88.152, 0.025), // near cog hq. entrance
      adjacent: ["d", "e"],
    },
    j: {
      pos: vec3.fromValues(-48.96, 88.565, 0.025), // near cog hq. entrance
      adjacent: ["e", "f"],
    },
    k: {
      pos: vec3.fromValues(75.118, 52.84, -16.62), // north of party gate
      adjacent: ["d", "l"],
    },
    l: {
      pos: vec3.fromValues(44.677, 27.091, -15.385), // west of party gate
      adjacent: ["k", "m"],
    },
    m: {
      pos: vec3.fromValues(77.009, -16.022, -14.975), // south of party gate
      adjacent: ["l", "c"],
    },
  },
  waypoints: [
    { from: "d", to: "k", raycast: true, points: [] },
    { from: "k", to: "l", raycast: true, points: [] },
    { from: "l", to: "m", raycast: true, points: [] },
    { from: "m", to: "c", raycast: true, points: [] },
    {
      from: "b",
      to: "a",
      raycast: true,
      points: [vec3.fromValues(-55.883, -89.0, 0.025)],
    },
  ],
};

export const PLUTO_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(-110.0, -37.8, 8.6), // on mound near 'North Pole'
      adjacent: ["b", "c"],
    },
    b: {
      pos: vec3.fromValues(-11.9, -128.2, 6.2), // near entrance to sleet street
      adjacent: ["a", "c"],
    },
    c: {
      pos: vec3.fromValues(48.9, -14.4, 6.2), // near entrance to walrus way
      adjacent: ["b", "a", "d"],
    },
    d: {
      pos: vec3.fromValues(0.25, 80.5, 6.2), // near entrance to Cog HQ
      adjacent: ["c", "e"],
    },
    e: {
      pos: vec3.fromValues(-83.3, 36.1, 6.2), // near the Toon HQ igloo
      adjacent: ["d", "a"],
    },
  },
  waypoints: [
    {
      from: "a",
      to: "b",
      raycast: true,
      points: [
        vec3.fromValues(-90.4, -57.2, 3.0),
        vec3.fromValues(-63.6, -79.8, 3.0),
        vec3.fromValues(-50.1, -89.1, 6.2),
      ],
    },
    {
      from: "c",
      to: "a",
      raycast: true,
      points: [
        vec3.fromValues(-15.6, -25.6, 6.2),
        vec3.fromValues(-37.5, -38.5, 3.0),
        vec3.fromValues(-55.0, -55.0, 3.0),
        vec3.fromValues(-85.0, -46.4, 3.0),
      ],
    },
    {
      from: "d",
      to: "e",
      raycast: false,
      points: [
        vec3.fromValues(-25.8, 60.0, 6.2),
        vec3.fromValues(-61.9, 64.5, 6.2),
      ],
    },
    {
      from: "e",
      to: "a",
      raycast: true,
      points: [
        vec3.fromValues(-77.2, 28.5, 6.2),
        vec3.fromValues(-76.4, 12.0, 3.0),
        vec3.fromValues(-93.2, -21.2, 3.0),
      ],
    },
  ],
};

export const DAISY_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(64.995, 169.665, 10.027), // in front of TTCentral entrance
      adjacent: ["b", "q"],
    },
    b: {
      pos: vec3.fromValues(48.893, 208.912, 10.027), // by flowers
      adjacent: ["a", "c"],
    },
    c: {
      pos: vec3.fromValues(5.482, 210.479, 10.03), // in front of trolley
      adjacent: ["b", "d"],
    },
    d: {
      pos: vec3.fromValues(-34.153, 203.284, 10.029), // near construction zone entrance
      adjacent: ["c", "e"],
    },
    e: {
      pos: vec3.fromValues(-66.656, 174.334, 10.026), // front construction zone entrance
      adjacent: ["d", "f"],
    },
    f: {
      pos: vec3.fromValues(-55.994, 162.33, 10.026), // top of ramp
      adjacent: ["e", "g"],
    },
    g: {
      pos: vec3.fromValues(-84.554, 142.099, 0.027), // down below ramp
      adjacent: ["f", "h"],
    },
    h: {
      pos: vec3.fromValues(-92.215, 96.446, 0.027), // toward flower bed
      adjacent: ["g", "i"],
    },
    i: {
      pos: vec3.fromValues(-63.168, 60.055, 0.027), // in front of flower bed
      adjacent: ["h", "j"],
    },
    j: {
      pos: vec3.fromValues(-37.637, 69.974, 0.027), // next to bush
      adjacent: ["i", "k"],
    },
    k: {
      pos: vec3.fromValues(-3.018, 26.157, 0.027), // front of Cog HQ entrance
      adjacent: ["j", "l", "m"],
    },
    l: {
      pos: vec3.fromValues(-0.711, 46.843, 0.027), // next to fountain
      adjacent: ["k"],
    },
    m: {
      pos: vec3.fromValues(26.071, 46.401, 0.027), // next to pond
      adjacent: ["k", "n"],
    },
    n: {
      pos: vec3.fromValues(30.87, 67.432, 0.027), // next to bush
      adjacent: ["m", "o"],
    },
    o: {
      pos: vec3.fromValues(93.903, 90.685, 0.027), // toward ramp
      adjacent: ["n", "p"],
    },
    p: {
      pos: vec3.fromValues(88.129, 140.575, 0.027), // below ramp
      adjacent: ["o", "q"],
    },
    q: {
      pos: vec3.fromValues(53.988, 158.232, 10.027), // top of ramp
      adjacent: ["p", "a"],
    },
  },
  waypoints: [
    { from: "f", to: "g", raycast: true, points: [] },
    { from: "p", to: "q", raycast: true, points: [] },
  ],
};

export const CHIP_PATHS: CharPaths = {
  nodes: {
    a: {
      pos: vec3.fromValues(50.004, 102.725, 0.6), // in front of log tunnel
      adjacent: ["b", "k"],
    },
    b: {
      pos: vec3.fromValues(-29.552, 112.531, 0.6), // north bridge inner side
      adjacent: ["c", "a"],
    },
    c: {
      pos: vec3.fromValues(-51.941, 146.155, 0.025), // north bridge outer side
      adjacent: ["d", "b"],
    },
    d: {
      pos: vec3.fromValues(-212.334, -3.639, 0.025), // in front of golf tunnel
      adjacent: ["e", "c"],
    },
    e: {
      pos: vec3.fromValues(-143.466, -67.526, 0.025), // west bridge outer side
      adjacent: ["f", "d", "i"],
    },
    f: {
      pos: vec3.fromValues(-107.556, -62.257, 0.025), // west bridge inner side
      adjacent: ["g", "e", "j"],
    },
    g: {
      pos: vec3.fromValues(-43.103, -71.518, 0.2734), // south bridge inner side
      adjacent: ["h", "f", "j"],
    },
    h: {
      pos: vec3.fromValues(-40.605, -125.124, 0.025), // south bridge outer side
      adjacent: ["i", "g"],
    },
    i: {
      pos: vec3.fromValues(-123.05, -124.542, 0.025), // between south & west bridge
      adjacent: ["h", "e"],
    },
    j: {
      pos: vec3.fromValues(-40.092, 2.784, 1.268), // SW of gazebo
      adjacent: ["k", "b", "f", "g"],
    },
    k: {
      pos: vec3.fromValues(75.295, 26.715, 1.4), // SE of gazebo
      adjacent: ["a", "j"],
    },
  },
  waypoints: [
    { from: "a", to: "b", raycast: true, points: [] },
    { from: "a", to: "k", raycast: true, points: [] },
    { from: "b", to: "c", raycast: true, points: [] },
    { from: "b", to: "j", raycast: true, points: [] },
    { from: "c", to: "d", raycast: true, points: [] },
    { from: "d", to: "e", raycast: true, points: [] },
    { from: "e", to: "f", raycast: true, points: [] },
    { from: "e", to: "i", raycast: true, points: [] },
    { from: "f", to: "g", raycast: true, points: [] },
    { from: "f", to: "j", raycast: true, points: [] },
    { from: "g", to: "h", raycast: true, points: [] },
    { from: "g", to: "j", raycast: true, points: [] },
    { from: "h", to: "i", raycast: true, points: [] },
    { from: "j", to: "k", raycast: true, points: [] },
  ],
};

const CHAR_PROPERTIES: Record<string, CharProperties> = {
  mk: {
    name: "mickey",
    modelPathPrefix: "phase_3/models/char/mickey-",
    lods: [1200, 800, 400],
    height: 3,
    speed: 5,
    animations: {
      walk: "phase_3/models/char/mickey-walk",
      run: "phase_3/models/char/mickey-run",
      neutral: "phase_3/models/char/mickey-wait",
      "left-point-start": "phase_3.5/models/char/mickey-left-start",
      "left-point": "phase_3.5/models/char/mickey-left",
      "right-point-start": "phase_3.5/models/char/mickey-right-start",
      "right-point": "phase_3.5/models/char/mickey-right",
    },
    paths: MICKEY_PATHS,
  },

  vmk: {
    name: "vampire_mickey",
    modelPathPrefix: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_",
    lods: [1200, 800, 400],
    height: 3,
    speed: 1.15,
    animations: {
      walk: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_sneak",
      run: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_run",
      neutral: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_idle",
      sneak: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_sneak",
      into_sneak:
        "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_into_sneak",
      chat: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_run",
      into_idle: "phase_3.5/models/char/tt_a_chr_csc_mickey_vampire_into_idle",
    },
    paths: MICKEY_PATHS,
  },

  mn: {
    name: "minnie",
    modelPathPrefix: "phase_3/models/char/minnie-",
    lods: [1200, 800, 400],
    height: 3,
    speed: 3.2,
    animations: {
      walk: "phase_3/models/char/minnie-walk",
      run: "phase_3/models/char/minnie-run",
      neutral: "phase_3/models/char/minnie-wait",
      "left-point-start": "phase_3.5/models/char/minnie-start-Lpoint",
      "left-point": "phase_3.5/models/char/minnie-Lpoint",
      "right-point-start": "phase_3.5/models/char/minnie-start-Rpoint",
      "right-point": "phase_3.5/models/char/minnie-Rpoint",
      up: "phase_4/models/char/minnie-up",
      down: "phase_4/models/char/minnie-down",
      left: "phase_4/models/char/minnie-left",
      right: "phase_4/models/char/minnie-right",
    },
    paths: MINNIE_PATHS,
  },

  wmn: {
    name: "witch_minnie",
    modelPathPrefix: "phase_3.5/models/char/tt_a_chr_csc_witchMinnie_",
    lods: [1200, 800, 400],
    height: 3,
    speed: 1.8,
    animations: {
      walk: "phase_3.5/models/char/tt_a_chr_csc_witchMinnie_walkHalloween3",
      neutral: "phase_3.5/models/char/tt_a_chr_csc_witchMinnie_neutral2",
    },
    paths: MINNIE_PATHS,
  },

  g: {
    name: "goofy",
    modelPathPrefix: "phase_6/models/char/TT_G-",
    lods: [1500, 1000, 500],
    height: 4.8,
    speed: 5.2,
    animations: {
      walk: "phase_6/models/char/TT_GWalk",
      run: "phase_6/models/char/TT_GRun",
      neutral: "phase_6/models/char/TT_GWait",
    },
    paths: GOOFY_SPEEDWAY_PATHS,
  },

  sg: {
    name: "super_goofy",
    modelPathPrefix: "phase_6/models/char/tt_a_chr_csc_goofyCostume_",
    lods: [1200, 800, 400],
    height: 4.8,
    speed: 1.6,
    animations: {
      walk: "phase_6/models/char/tt_a_chr_csc_goofyCostume_walkStrut2",
      neutral: "phase_6/models/char/tt_a_chr_csc_goofyCostume_neutral",
    },
    paths: GOOFY_SPEEDWAY_PATHS,
  },

  d: {
    name: "donald",
    modelPathPrefix: "phase_6/models/char/DL_donald-",
    lods: [1000, 500, 250],
    height: 4.5,
    speed: 3.68,
    animations: {
      walk: "phase_6/models/char/DL_donald-walk",
      trans: "phase_6/models/char/DL_donald-transition",
      neutral: "phase_6/models/char/DL_donald-neutral",
      "trans-back": "phase_6/models/char/DL_donald-transBack",
    },
    paths: DONALD_PATHS,
  },

  dw: {
    name: "donald-wheel",
    modelPathPrefix: "phase_6/models/char/donald-wheel-",
    lods: [1000],
    height: 4.5,
    speed: 0,
    animations: {
      wheel: "phase_6/models/char/donald-wheel-wheel",
      neutral: "phase_6/models/char/donald-wheel-wheel",
    },
    paths: {
      nodes: {
        a: { pos: vec3.fromValues(0, 0, 0), adjacent: ["a"] },
      },
      waypoints: [],
    },
  },

  p: {
    name: "pluto",
    modelPathPrefix: "phase_6/models/char/pluto-",
    lods: [1000, 500, 300],
    height: 3,
    speed: 5.5,
    animations: {
      walk: "phase_6/models/char/pluto-walk",
      sit: "phase_6/models/char/pluto-sit",
      neutral: "phase_6/models/char/pluto-neutral",
      stand: "phase_6/models/char/pluto-stand",
    },
    paths: PLUTO_PATHS,
  },

  wp: {
    name: "western_pluto",
    modelPathPrefix: "phase_6/models/char/tt_a_chr_csc_plutoCostume_",
    lods: [1200, 800, 400],
    height: 4.5,
    speed: 3.2,
    animations: {
      walk: "phase_6/models/char/tt_a_chr_csc_plutoCostume_walk",
      sit: "phase_6/models/char/tt_a_chr_csc_plutoCostume_sitStart",
      neutral: "phase_6/models/char/tt_a_chr_csc_plutoCostume_sitLoop",
      stand: "phase_6/models/char/tt_a_chr_csc_plutoCostume_sitStop",
    },
    paths: PLUTO_PATHS,
  },

  // cl: {
  //   name: "clarabelle",
  //   modelPathPrefix: "phase_5.5/models/estate/Clara_pose2-",
  //   lods: [],
  //   height: 3,
  //   animations: {},
  // },

  dd: {
    name: "daisy",
    modelPathPrefix: "phase_4/models/char/daisyduck_",
    lods: [1600, 800, 400],
    height: 4.5,
    speed: 2.3,
    animations: {
      walk: "phase_4/models/char/daisyduck_walk",
      neutral: "phase_4/models/char/daisyduck_idle",
    },
    paths: DAISY_PATHS,
  },

  ch: {
    name: "chip",
    modelPathPrefix: "phase_6/models/char/chip_",
    lods: [1000, 500, 250],
    height: 2,
    speed: 3,
    animations: {
      walk: "phase_6/models/char/chip_walk",
      neutral: "phase_6/models/char/chip_idle",
    },
    paths: CHIP_PATHS,
  },

  da: {
    name: "dale",
    modelPathPrefix: "phase_6/models/char/dale_",
    lods: [1000, 500, 250],
    height: 2,
    speed: 3.5,
    animations: {
      walk: "phase_6/models/char/dale_walk",
      neutral: "phase_6/models/char/dale_idle",
    },
    paths: CHIP_PATHS, // TODO
  },
};

export class Char extends Actor {
  private _props: CharProperties;
  private _curPathNode = "a";
  private _walkInterval: Interval | null = null;

  async generateChar(code: string) {
    this._props = CHAR_PROPERTIES[code];
    if (!this._props) throw new Error(`Unknown character code: ${code}`);
    await this.loadModel(
      `${this._props.modelPathPrefix}${this._props.lods[0]}`,
    );
    await this.loadAnims(this._props.animations);

    if (
      this._props.name === "mickey" ||
      this._props.name === "minnie" ||
      this._props.name === "pluto" ||
      this._props.name === "donald-wheel"
    ) {
      for (const part of this._parts.values()) {
        const instance = part.character;
        // Fix pupil rendering
        const eyes = instance.find("**/eyes*");
        if (eyes) {
          instance.findAllMatches("**/joint_pupil?").forEach((pupil) => {
            pupil.reparentTo(eyes);
          });
          eyes.setEffect(new DecalEffect());
        }
      }
    } else if (this._props.name === "daisy") {
      for (const part of this._parts.values()) {
        const instance = part.character;
        // Hide closed eyes
        instance.find("**/eyesclose")?.hide();
      }
    }

    // Add drop shadow
    // TODO ShadowCaster
    const shadowModel = await getLoader().loadModel(
      "phase_3/models/props/drop_shadow",
    );
    for (const part of this._parts.values()) {
      const instance = part.character;
      const shadow = shadowModel.cloneTo(instance);
      shadow.pos = vec3.fromValues(0, 0, 0.025);
      shadow.scale = vec3.fromValues(0.4, 0.4, 0.4);
      shadow.setAttrib(ColorAttrib.flat(vec4.fromValues(0, 0, 0, 0.5)), 1);
    }

    const paths = this._props.paths;
    this._curPathNode = "a";
    this.pos = paths.nodes[this._curPathNode].pos;
    this.loop("neutral");
  }

  walkToNextPoint() {
    const pathNode = this._props.paths.nodes[this._curPathNode];
    if (!pathNode || !pathNode.adjacent.length) return;
    const nextNode =
      pathNode.adjacent[Math.floor(Math.random() * pathNode.adjacent.length)];
    if (this._curPathNode === nextNode) return;
    const points = this.getPointsFromTo(this._curPathNode, nextNode);
    const sequence: Interval[] = [
      Func(() => {
        this.loop("walk");
      }),
    ];
    let startH = this.h;
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const d = vec3.create();
      vec3.subtract(d, end, start);
      const duration = vec3.length(d) / this._props.speed;
      const endH = -Math.atan2(d[0], d[1]) * MathConstants.RAD_TO_DEG;
      const deltaH = shortestDeltaDeg(startH, endH);
      sequence.push(
        new Parallel([
          // this.actorInterval("walk", { duration: duration, loop: true }),
          new LerpPosInterval(this, duration, BlendType.Linear, start, end),
          new LerpHprInterval(
            this,
            Math.abs(deltaH) / 270,
            BlendType.Linear,
            vec3.fromValues(startH, 0, 0),
            vec3.fromValues(startH + deltaH, 0, 0),
          ),
        ]),
      );
      startH = endH;
    }
    sequence.push(
      Func(() => {
        // console.log("Done walking from", this._curPathNode, "to", nextNode);
        this._curPathNode = nextNode;
        this.loop("neutral");
      }),
      Wait(2),
      // this.actorInterval("neutral", { duration: 2, loop: true }),
      Func(() => {
        this.walkToNextPoint();
      }),
    );
    this._walkInterval = new Sequence(sequence);
    this._walkInterval.start();
  }

  stopWalking() {
    this._walkInterval?.pause();
  }

  private getPointsFromTo(from: string, to: string): ReadonlyVec3[] {
    const paths = this._props.paths;
    if (from === to) return [paths.nodes[from].pos];
    let points: ReadonlyVec3[] = [];
    const forward = paths.waypoints.find(
      (wp) => wp.from === from && wp.to === to,
    );
    if (forward) {
      points = forward.points;
    } else {
      const backward = paths.waypoints.find(
        (wp) => wp.from === to && wp.to === from,
      );
      if (backward) {
        points = backward.points.slice().reverse();
      }
    }
    return [paths.nodes[from].pos, ...points, paths.nodes[to].pos];
  }
}

function shortestDeltaDeg(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
