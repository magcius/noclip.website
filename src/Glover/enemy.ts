import * as Textures from './textures';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { assert } from "../util";

import { SRC_FRAME_TO_MS } from './timing';
import { angularDistance, subtractAngles, radianModulo, radianLerp } from "./util";

import { vec3, quat, mat4 } from "gl-matrix";

import { GenericRenderable, SceneLighting } from './render';
import { ObjectDirectory } from './scenes';
import { GloverActorRenderer } from './actor';
import { ParticlePool } from './particles';
import { Collidable, Collision, projectOntoTerrain } from './shadows';

import { GloverLevel } from './parsers';

export const enum EnemyType {
    bovva = 7, // giant bee
    cannon, // rolley-polley grinning cannon ball
    samtex, // dynamite
    mallet, // charging bull
    generalw, // shark
    lionfish, // leaping fish
    chester, // chompy treasure chest
    keg, // waddling eyebrow'ed barrel (unused?)
    reggie, // lobster
    swish, // sword
    thrice, // mace-wielding armor
    robes, // witch ghost
    fumble, // mummy
    mike, // disembodied shoes
    raptor, // lil blue dino
    crumpet, // green pig fly
    tracey, // purse dino
    yoofow, // UFO
    opec, // green egg robot
    cymon, // purple marble robot
    sucker, // soup-bowl-head alien
    bugle, // pink elephant balloon
    dennis, // dennis!
    chuck, // egg-juggling chicken
    hubchicken, // hub world swing chicken
    frankie2, // frankenstein (FF boss)
    kloset, // evil clown (CK boss)
    willy, // t-rex (PH boss)
    joff, // whale (AT boss)
    cancer, // crab (AT boss)
    kirk, // flying fish (AT boss)
    robot, // walking robot (OOTW boss phase 1)
    evilrobot, // flying robot (OOTW boss phase 2)
    spank, // large monkey (PC boss)
    babyspk2, // small monkey (PC boss)
    evilglove, // cross-stitch
    dibber, // wind-up toys
    brundle, // fly
    malcom, // snail
    spotty, // XXX not found in game files
    gordon, // goldfish
    sidney, // ladybug
    weevil, // inverted ladybug
    chopstik, // caterpillar
    butterfly, // butterfly
    spider, // spider
    bat, // bat
    frog, // frog
    dragfly, // dragon fly
    boxthing, // spinning eye (unused?)
    bug, // XXX not found in game files
    nmefrog // frog (looks identical to frog.ndo)
};

const enemy_objects = [
    0, // X
    0, // X
    0, // X
    0, // X
    0, // X
    0, // X
    0, // X
    0x23313E06, // bovva.ndo
    0x564688C8, // cannon.ndo
    0x406F69F3, // samtex.ndo
    0xD93BC431, // mallet.ndo
    0xE1BD7DC6, // generalw.ndo
    0x51774594, // lionfish.ndo
    0x8318D8F0, // chester.ndo
    0xEB80C7C1, // keg.ndo //
    0x4FD8DEA4, // reggie.ndo
    0xB26224B1, // swish.ndo
    0x5FDF6DA4, // thrice.ndo
    0x6E6B734D, // robes.ndo
    0x11D31D93, // fumble.ndo
    0x607F0521, // mike.ndo
    0xB4AFB818, // raptor.ndo
    0x891D5CEC, // crumpet.ndo
    0x3D8AF0FF, // tracey.ndo
    0x63484739, // yoofow.ndo
    0x3C7E50C7, // opec.ndo
    0x2B7D5024, // cymon.ndo
    0x3A3FB6AC, // sucker.ndo
    0x3DA65A3E, // bugle.ndo
    0xEC858271, // dennis.ndo
    0x94561D21, // chuck.ndo
    0x83D7D176, // hubchicken1.ndo
    0x582D7F68, // frankie2.ndo
    0xFFD4E91C, // kloset.ndo
    0x41BF39F2, // willy.ndo
    0x343698FE, // joff.ndo
    0x5E6BDD75, // cancer.ndo
    0x3A54353A, // kirk.ndo
    0x7A982969, // robot.ndo
    0xF87B920D, // evilrobot.ndo
    0x8461656E, // spank.ndo
    0x8109F529, // babyspk2.ndo
    0x8099A2A3, // evilglove.ndo
    0xAF04421C, // dibber.ndo
    0x4B0AFB5A, // brundle.ndo
    0x2641A5A0, // malcom.ndo
    0xF90DC11E, // spotty.ndo
    0x08C0489B, // gordon.ndo
    0x03E850B7, // sidney.ndo
    0xD20A82F3, // weevil.ndo
    0xCED3F24C, // chopstik.ndo
    0x826654AB, // butterfly.ndo
    0xF5ED8907, // spider.ndo
    0xE38B474D, // bat.ndo //
    0xE21973A2, // frog.ndo
    0x792B1F93, // dragfly.ndo
    0x1EE07E45, // boxthing.ndo
    0x61AF1E01, // bug.ndo //
    0xF700F0E2, // nmefrog.ndo
]

const enemy_scales = [
    0.0,
    0.05,
    0.05,
    0.0,
    0.0,
    0.0,
    0.05,
    0.05, // bovva.ndo
    0.05, // cannon.ndo
    0.065, // samtex.ndo
    0.05, // mallet.ndo
    0.05, // generalw.ndo
    0.05, // lionfish.ndo
    0.05, // chester.ndo
    0.05, // keg.ndo
    0.07, // reggie.ndo
    0.1, // swish.ndo
    0.05, // thrice.ndo
    0.05, // robes.ndo
    0.05, // fumble.ndo
    0.05, // mike.ndo
    0.075, // raptor.ndo
    0.1, // crumpet.ndo
    0.05, // tracey.ndo
    0.05, // yoofow.ndo
    0.075, // opec.ndo
    0.065, // cymon.ndo
    0.05, // sucker.ndo
    0.05, // bugle.ndo
    0.05, // dennis.ndo
    0.05, // chuck.ndo
    0.15, // hubchicken1.ndo
    0.065, // frankie2.ndo
    0.06, // kloset.ndo
    0.375, // willy.ndo
    0.075, // joff.ndo
    0.075, // cancer.ndo
    0.075, // kirk.ndo
    0.5, // robot.ndo
    0.5, // evilrobot.ndo
    0.08, // spank.ndo
    0.05, // babyspk2.ndo
    0.07, // evilglove.ndo
    0.125, // dibber.ndo
    0.1, // brundle.ndo
    0.065, // malcom.ndo
    0.09, // spotty.ndo
    0.08, // gordon.ndo
    0.05, // sidney.ndo
    0.05, // weevil.ndo
    0.08, // chopstik.ndo
    0.1, // butterfly.ndo
    0.05, // spider.ndo
    0.05, // bat.ndo
    0.1, // frog.ndo
    0.05, // dragfly.ndo
    0.075, // boxthing.ndo
    0.065, // bug.ndo
    0.15 // nmefrog.ndo
];


const enemy_init_flags = [
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0, // bovva.ndo
    0x4, // cannon.ndo
    0x4, // samtex.ndo
    0x245, // mallet.ndo
    0x200, // generalw.ndo
    0x5, // lionfish.ndo
    0x204, // chester.ndo
    0x4, // keg.ndo
    0x45, // reggie.ndo
    0x0, // swish.ndo
    0x4, // thrice.ndo
    0x4, // robes.ndo
    0x200, // fumble.ndo
    0x0, // mike.ndo
    0x0, // raptor.ndo
    0x4, // crumpet.ndo
    0x0, // tracey.ndo
    0x4, // yoofow.ndo
    0x4, // opec.ndo
    0x200, // cymon.ndo
    0x0, // sucker.ndo
    0x0, // bugle.ndo
    0x4, // dennis.ndo
    0x0, // chuck.ndo
    0x24, // hubchicken1.ndo
    0x24, // frankie2.ndo
    0x24, // kloset.ndo
    0x24, // willy.ndo
    0x24, // joff.ndo
    0x20, // cancer.ndo
    0x24, // kirk.ndo
    0x24, // robot.ndo
    0x24, // evilrobot.ndo
    0x24, // spank.ndo
    0x200, // babyspk2.ndo
    0x0, // evilglove.ndo
    0x45, // dibber.ndo
    0x4, // brundle.ndo
    0x4, // malcom.ndo
    0x4, // spotty.ndo
    0x4, // gordon.ndo
    0x0, // sidney.ndo
    0x0, // weevil.ndo
    0x4, // chopstik.ndo
    0x4, // butterfly.ndo
    0x4, // spider.ndo
    0x4, // bat.ndo
    0x0, // frog.ndo
    0x4, // dragfly.ndo
    0x0, // boxthing.ndo
    0x0, // bug.ndo
    0x4, // nmefrog.ndo
]

const enemy_bobble = [
    [0, 0], // 0
    [0, 0], // 1
    [0, 0], // 2
    [0, 0], // 3
    [0, 0], // 4
    [0, 0], // 5
    [0, 0], // 6
    [20, 0.05], // 7 // bovva.ndo
    [0, 0], // 8 // cannon.ndo
    [0, 0], // 9 // samtex.ndo
    [0, 0], // 10 // mallet.ndo
    [0, 0], // 11 // generalw.ndo
    [0, 0], // 12 // lionfish.ndo
    [0, 0], // 13 // chester.ndo
    [0, 0], // 14 // keg.ndo
    [0, 0], // 15 // reggie.ndo
    [0, 0], // 16 // swish.ndo
    [0, 0], // 17 // thrice.ndo
    [10, 0.05], // 18 // robes.ndo
    [0, 0], // 19 // fumble.ndo
    [0, 0], // 20 // mike.ndo
    [0, 0], // 21 // raptor.ndo
    [5, 0.2], // 22 // crumpet.ndo
    [0, 0], // 23 // tracey.ndo
    [10, 0.1], // 24 // yoofow.ndo
    [10, 0.05], // 25 // opec.ndo
    [0, 0], // 26 // cymon.ndo
    [0, 0], // 27 // sucker.ndo
    [10, 0.05], // 28 // bugle.ndo
    [0, 0], // 29 // dennis.ndo
    [0, 0], // 30 // chuck.ndo
    [0, 0], // 31 // hubchicken1.ndo
    [0, 0], // 32 // frankie2.ndo
    [0, 0], // 33 // kloset.ndo
    [0, 0], // 34 // willy.ndo
    [0, 0], // 35 // joff.ndo
    [0, 0], // 36 // cancer.ndo
    [0, 0], // 37 // kirk.ndo
    [0, 0], // 38 // robot.ndo
    [0, 0], // 39 // evilrobot.ndo
    [0, 0], // 40 // spank.ndo
    [0, 0], // 41 // babyspk2.ndo
    [0, 0], // 42 // evilglove.ndo
    [0, 0], // 43 // dibber.ndo
    [10, 0.06666667], // 44 // brundle.ndo
    [0, 0], // 45 // malcom.ndo
    [0, 0], // 46 // spotty.ndo
    [0, 0], // 47 // gordon.ndo
    [0, 0], // 48 // sidney.ndo
    [0, 0], // 49 // weevil.ndo
    [0, 0], // 50 // chopstik.ndo
    [6, 0.5], // 51 // butterfly.ndo
    [0, 0], // 52 // spider.ndo
    [6, 0.5], // 53 // bat.ndo
    [0, 0], // 54 // frog.ndo
    [0, 0], // 55 // dragfly.ndo
    [0, 0], // 56 // boxthing.ndo
    [0, 0], // 57 // bug.ndo
    [0, 0] // 58 // nmefrog.ndo
]


const enemy_roll_modulation = [
    -0.8, // 0
    -0.8, // 1
    -0.8, // 2
    -0.8, // 3
    -0.8, // 4
    -0.8, // 5
    -0.8, // 6
    -0.5, // 7 // bovva.ndo
    -0.8, // 8 // cannon.ndo
    -0.8, // 9 // samtex.ndo
    -0.8, // 10 // mallet.ndo
    -0.8, // 11 // generalw.ndo
    -0.8, // 12 // lionfish.ndo
    -0.8, // 13 // chester.ndo
    -0.8, // 14 // keg.ndo
    -0.8, // 15 // reggie.ndo
    -0.8, // 16 // swish.ndo
    -0.8, // 17 // thrice.ndo
    -0.8, // 18 // robes.ndo
    -0.8, // 19 // fumble.ndo
    -0.8, // 20 // mike.ndo
    -0.8, // 21 // raptor.ndo
    -0.8, // 22 // crumpet.ndo
    -0.8, // 23 // tracey.ndo
    -0.8, // 24 // yoofow.ndo
    -0.8, // 25 // opec.ndo
    -1.5, // 26 // cymon.ndo
    -0.8, // 27 // sucker.ndo
    -0.8, // 28 // bugle.ndo
    -0.8, // 29 // dennis.ndo
    -0.8, // 30 // chuck.ndo
    -0.8, // 31 // hubchicken1.ndo
    -0.8, // 32 // frankie2.ndo
    -0.8, // 33 // kloset.ndo
    -0.8, // 34 // willy.ndo
    -0.8, // 35 // joff.ndo
    -0.8, // 36 // cancer.ndo
    -0.8, // 37 // kirk.ndo
    -0.8, // 38 // robot.ndo
    -0.8, // 39 // evilrobot.ndo
    -0.8, // 40 // spank.ndo
    -0.8, // 41 // babyspk2.ndo
    -0.8, // 42 // evilglove.ndo
    -0.8, // 43 // dibber.ndo
    -0.8, // 44 // brundle.ndo
    -0.8, // 45 // malcom.ndo
    -0.8, // 46 // spotty.ndo
    -0.8, // 47 // gordon.ndo
    -0.8, // 48 // sidney.ndo
    -0.8, // 49 // weevil.ndo
    -0.8, // 50 // chopstik.ndo
    -0.8, // 51 // butterfly.ndo
    -0.8, // 52 // spider.ndo
    -0.8, // 53 // bat.ndo
    -0.8, // 54 // frog.ndo
    -0.8, // 55 // dragfly.ndo
    -0.8, // 56 // boxthing.ndo
    -0.8, // 57 // bug.ndo
    -0.8 // 58 // nmefrog.ndo
]

const enemy_beh = [
  { "actorFlags": 0x60493d, "decel0x18":  0.94, "maxVelocity": 13, "mobility": 26, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.8, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1.5, "u0x30": 0.4, "u0x34": 0.9, "u0x38": 0.1, "u0x3c": 10, "u0x40":  0.88, "collisionRadius": 9, "u0x4c": 4, "walkSpeed": 0.5 },  // 0
  { "actorFlags": 0x40493d, "decel0x18":  0.97, "maxVelocity": 13, "mobility": 26, "spinDeceleration":  0.97, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 14, "u0x10": 0.1, "u0x14":  0.99, "u0x20": -1, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 14, "u0x4c": 4, "walkSpeed": 0.26455 },  // 1
  { "actorFlags": 0x60493d, "decel0x18": 0.9, "maxVelocity": 13, "mobility": 26, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 7, "u0x10": 0.1, "u0x14":  0.99, "u0x20":  0.99, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1.2000000476837158, "u0x30":  0.45, "u0x34": 1.2000000476837158, "u0x38":  0.12, "u0x3c": 8, "u0x40":  0.88, "collisionRadius": 6, "u0x4c": 4, "walkSpeed":  0.75 },  // 2
  { "actorFlags": 0x404d3d, "decel0x18":  0.95, "maxVelocity": 18.200000762939453, "mobility": 36.400001525878906, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.6, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 6, "u0x4c": 4, "walkSpeed": 0.5 },  // 3
  { "actorFlags": 0x60497d, "decel0x18": 0.7, "maxVelocity": 13, "mobility": 26, "spinDeceleration": 0.9, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 3, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.7, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1.399999976158142, "u0x30": 0.3, "u0x34": 0.7, "u0x38":  0.01, "u0x3c": -30, "u0x40": 0.9, "collisionRadius": 25, "u0x4c": 4, "walkSpeed": 0.5 },  // 4
  { "actorFlags": 0x60493d, "decel0x18":  0.94, "maxVelocity": 13, "mobility": 26, "spinDeceleration": 0.9, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 12, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.6, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1, "u0x30": 0.1, "u0x34": 0.7, "u0x38":  0.01, "u0x3c": 10, "u0x40":  0.88, "collisionRadius": 9, "u0x4c": 4, "walkSpeed": 0.5 },  // 5
  { "actorFlags": 0x60493d, "decel0x18":  0.94, "maxVelocity": 13, "mobility": 36.400001525878906, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 0, "spinTweenZ": 0, "u0x0": 9, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.6, "u0x27": 0, "maxRotationSpeed": 1, "u0x2c": 1.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 9, "u0x4c": 4, "walkSpeed": 0.5 },  // 6
  { "actorFlags": 0x840091c, "decel0x18": 0.6, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 100, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.08, "u0x2c": 2.5, "u0x30": 0.3, "u0x34": 3, "u0x38":  0.01, "u0x3c": -30, "u0x40":  0.95, "collisionRadius": 17, "u0x4c": 4, "walkSpeed": 1 },  // 7 // bovva.ndo
  { "actorFlags": 0x840493d, "decel0x18":  0.92, "maxVelocity": 12, "mobility": 20, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 16, "u0x10": 0, "u0x14": 0, "u0x20": 0.8, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 1.2000000476837158 },  // 8 // cannon.ndo
  { "actorFlags": 0x40091d, "decel0x18": 0.9, "maxVelocity": 20, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 10, "u0x4c": 4, "walkSpeed": 5 },  // 9 // samtex.ndo
  { "actorFlags": 0x46091d, "decel0x18":  0.85, "maxVelocity": 18, "mobility": 30, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 100, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 1.2000000476837158 },  // 10 // mallet.ndo
  { "actorFlags": 0x42081d, "decel0x18": 0.8, "maxVelocity": 4, "mobility": 10, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 1000, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 15, "u0x4c": 4, "walkSpeed": 0.8 },  // 11 // generalw.ndo
  { "actorFlags": 0x1066090d, "decel0x18":  0.85, "maxVelocity": 4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 999999, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 15, "u0x4c": 4, "walkSpeed": 0.2 },  // 12 // lionfish.ndo
  { "actorFlags": 0x40091d, "decel0x18": 0.7, "maxVelocity": 4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10000, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.6, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 0.7 },  // 13 // chester.ndo
  { "actorFlags": 0x42091d, "decel0x18": 0.9, "maxVelocity": 4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 200, "u0x10": 0.2, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 5 },  // 14 // keg.ndo
  { "actorFlags": 0x46081d, "decel0x18": 0.3, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.1, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.25, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 5, "u0x4c": 4, "walkSpeed": 1.5 },  // 15 // reggie.ndo
  { "actorFlags": 0x46091d, "decel0x18":  0.85, "maxVelocity": 1.2999999523162842, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.25, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 14, "u0x4c": 4, "walkSpeed": 1 },  // 16 // swish.ndo
  { "actorFlags": 0x52080c, "decel0x18": 0.3, "maxVelocity": 4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 10, "u0x4c": 4, "walkSpeed": 5 },  // 17 // thrice.ndo
  { "actorFlags": 0x400104, "decel0x18": 0.9, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.05, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 0.1 },  // 18 // robes.ndo
  { "actorFlags": 0x42091d, "decel0x18": 0.8, "maxVelocity": 1, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 8, "u0x4c": 4, "walkSpeed": 1 },  // 19 // fumble.ndo
  { "actorFlags": 0x52011d, "decel0x18": 0.6, "maxVelocity": 1.7999999523162842, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 500, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 8 },  // 20 // mike.ndo
  { "actorFlags": 0x46091d, "decel0x18": 0.7, "maxVelocity": 1, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 15, "u0x4c": 4, "walkSpeed": 2.299999952316284 },  // 21 // raptor.ndo
  { "actorFlags": 0x40090c, "decel0x18": 0.1, "maxVelocity": 20, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 2, "spinTweenY": 2, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.9, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 10, "u0x4c": 4, "walkSpeed": 16 },  // 22 // crumpet.ndo
  { "actorFlags": 0x8040091d, "decel0x18":  0.85, "maxVelocity": 7, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 1000, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 30, "u0x4c": 4, "walkSpeed": 1 },  // 23 // tracey.ndo
  { "actorFlags": 0x400d0c, "decel0x18": 0.5, "maxVelocity": 6, "mobility": 10, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.3, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 14, "u0x4c": 4, "walkSpeed": 1 },  // 24 // yoofow.ndo
  { "actorFlags": 0x400d1c, "decel0x18": 0.8, "maxVelocity": 5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 100, "u0x10": 0, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.25, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 15, "u0x4c": 4, "walkSpeed": 1 },  // 25 // opec.ndo
  { "actorFlags": 0x400d1d, "decel0x18": 0.8, "maxVelocity": 12, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.25, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 9, "u0x4c": 4, "walkSpeed": 1 },  // 26 // cymon.ndo
  { "actorFlags": 0x40091d, "decel0x18": 0.8, "maxVelocity": 2, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.5, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 1 },  // 27 // sucker.ndo
  { "actorFlags": 0x40491c, "decel0x18":  0.93, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 100, "u0x10": 0, "u0x14": 0, "u0x20":  0.99, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0.3, "u0x34": 3, "u0x38":  0.01, "u0x3c": -30, "u0x40":  0.95, "collisionRadius": 27, "u0x4c": 4, "walkSpeed":  0.08 },  // 28 // bugle.ndo
  { "actorFlags": 0xa40091d, "decel0x18": 0.9, "maxVelocity": 4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 100, "u0x10": 0, "u0x14": 0, "u0x20": 0.4, "u0x27": 0, "maxRotationSpeed": 0.4, "u0x2c": 2.5, "u0x30": 0.3, "u0x34": 1, "u0x38":  0.02, "u0x3c": 10, "u0x40":  0.88, "collisionRadius": 16, "u0x4c": 4, "walkSpeed": 5 },  // 29 // dennis.ndo
  { "actorFlags": 0x40091d, "decel0x18": 0.6, "maxVelocity": 1, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0.2, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.4, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 0.5 },  // 30 // chuck.ndo
  { "actorFlags": 0x10c, "decel0x18": -3, "maxVelocity": 1, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 999999, "u0x10": 0.2, "u0x14":  0.99, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.4, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 12, "u0x4c": 4, "walkSpeed": 0.5 },  // 31 // hubchicken1.ndo
  { "actorFlags": 0x2001d, "decel0x18": 0.9, "maxVelocity": 1.2000000476837158, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.05, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 15, "u0x4c": 4, "walkSpeed": 2.200000047683716 },  // 32 // frankie2.ndo
  { "actorFlags": 0x2011d, "decel0x18": 0.7, "maxVelocity": 1.600000023841858, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.08, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 45, "u0x4c": 4, "walkSpeed": 0.9 },  // 33 // kloset.ndo
  { "actorFlags": 0x8091d, "decel0x18": 0.7, "maxVelocity": 2, "mobility": 40, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 75, "u0x4c": 4, "walkSpeed": 4.599999904632568 },  // 34 // willy.ndo
  { "actorFlags": 0x8002011d, "decel0x18": 0.8, "maxVelocity": 4, "mobility": 20, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.07, "u0x2c": 1, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 38, "u0x4c": 4, "walkSpeed": 0.8 },  // 35 // joff.ndo
  { "actorFlags": 0x6000c, "decel0x18": 0.9, "maxVelocity": 1.7999999523162842, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.08, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 13, "u0x4c": 4, "walkSpeed": 1.7999999523162842 },  // 36 // cancer.ndo
  { "actorFlags": 0xc, "decel0x18": 0.9, "maxVelocity": 6, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 1, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.15, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 25, "u0x4c": 4, "walkSpeed": 1 },  // 37 // kirk.ndo
  { "actorFlags": 0xc, "decel0x18": -3, "maxVelocity": 3.4000000953674316, "mobility": 20, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.07, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 250, "u0x4c": 4, "walkSpeed": 3.4000000953674316 },  // 38 // robot.ndo
  { "actorFlags": 0xc, "decel0x18": 0.8, "maxVelocity": 15, "mobility": 40, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.12, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 250, "u0x4c": 4, "walkSpeed": 5 },  // 39 // evilrobot.ndo
  { "actorFlags": 0x2011d, "decel0x18": 0.8, "maxVelocity": 3, "mobility": 20, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed":  0.11, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 32, "u0x4c": 4, "walkSpeed":  0.95 },  // 40 // spank.ndo
  { "actorFlags": 0x11d, "decel0x18": 0.8, "maxVelocity": 2, "mobility": 20, "spinDeceleration":  0.95, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 20, "u0x4c": 4, "walkSpeed":  0.95 },  // 41 // babyspk2.ndo
  { "actorFlags": 0x104, "decel0x18": 0.5, "maxVelocity": 20, "mobility": 20, "spinDeceleration": 0.995, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed": 0.3, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 18.799999237060547, "u0x4c": 4, "walkSpeed": 1 },  // 42 // evilglove.ndo
  { "actorFlags": 0x6010c, "decel0x18": 0.5, "maxVelocity": 6, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10000, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed": 0.3, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 7, "u0x4c": 4, "walkSpeed": 1 },  // 43 // dibber.ndo
  { "actorFlags": 0x4, "decel0x18": 0.6, "maxVelocity": 8, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.6, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 6, "u0x4c": 4, "walkSpeed": 4 },  // 44 // brundle.ndo
  { "actorFlags": 0x15, "decel0x18": 0.8, "maxVelocity": 0.3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.02, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 5, "u0x4c": 4, "walkSpeed": 0.1 },  // 45 // malcom.ndo
  { "actorFlags": 0x4, "decel0x18": 0.9, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.02, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 6, "u0x4c": 4, "walkSpeed": 0.2 },  // 46 // spotty.ndo
  { "actorFlags": 0x4, "decel0x18": 0.9, "maxVelocity": 2.5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.3, "u0x27": 0, "maxRotationSpeed":  0.04, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 6, "u0x4c": 4, "walkSpeed": 0.2 },  // 47 // gordon.ndo
  { "actorFlags": 0x15, "decel0x18": 0.8, "maxVelocity": 6, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 3, "u0x4c": 4, "walkSpeed": 3 },  // 48 // sidney.ndo
  { "actorFlags": 0x15, "decel0x18": 0.8, "maxVelocity": 6, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 3, "u0x4c": 4, "walkSpeed": 3 },  // 49 // weevil.ndo
  { "actorFlags": 0x15, "decel0x18": 0.5, "maxVelocity": 0.4, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed":  0.05, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 1.5, "u0x4c": 4, "walkSpeed": 0.2 },  // 50 // chopstik.ndo
  { "actorFlags": 0x104, "decel0x18": 0.8, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 8, "u0x4c": 4, "walkSpeed": 1 },  // 51 // butterfly.ndo
  { "actorFlags": 0x15, "decel0x18": 0.8, "maxVelocity": 0.5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 3, "u0x4c": 4, "walkSpeed":  0.05 },  // 52 // spider.ndo
  { "actorFlags": 0x4, "decel0x18": 0.8, "maxVelocity": 3, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 1, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 8, "u0x4c": 4, "walkSpeed": 1 },  // 53 // bat.ndo
  { "actorFlags": 0x115, "decel0x18": 0.9, "maxVelocity": 0.5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed": 0.2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 5, "u0x4c": 4, "walkSpeed":  0.05 },  // 54 // frog.ndo
  { "actorFlags": 0x4, "decel0x18": -1, "maxVelocity": 10, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 2, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 8, "u0x4c": 4, "walkSpeed": 10 },  // 55 // dragfly.ndo
  { "actorFlags": 0x15, "decel0x18":  0.85, "maxVelocity": 5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.4, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 3, "u0x4c": 4, "walkSpeed": 0.8 },  // 56 // boxthing.ndo
  { "actorFlags": 0x15, "decel0x18":  0.85, "maxVelocity": 1, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0.1, "u0x27": 0, "maxRotationSpeed": 0.4, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 3, "u0x4c": 4, "walkSpeed": 0.8 },  // 57 // bug.ndo
  { "actorFlags": 0x11d, "decel0x18": 0.9, "maxVelocity": 0.5, "mobility": 20, "spinDeceleration": 0.8, "spinTweenX": 0, "spinTweenY": 1, "spinTweenZ": 0, "u0x0": 10, "u0x10": 0, "u0x14": 0, "u0x20": 0, "u0x27": 0, "maxRotationSpeed": 0.1, "u0x2c": 2.5, "u0x30": 0, "u0x34": 0, "u0x38": 0, "u0x3c": 0, "u0x40": 0, "collisionRadius": 7, "u0x4c": 4, "walkSpeed":  0.05 }, // 58 // nmefrog.ndo
]

const ExecutionCondition = GloverLevel.EnemyInstruction.ExecutionConditionType;
type Instruction = GloverLevel.EnemyInstruction;

const scratchVec3 = vec3.create();
const scratchVec3_2 = vec3.create();

export class GloverEnemy implements GenericRenderable {
    public actor: GloverActorRenderer;

    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;

    public visible: boolean = true;

    public terrain: readonly Collidable[] = [];

    private particles: ParticlePool | null = null;

    // Physics

    private eulers = vec3.create();;
    private rotation = quat.create();
    private position = vec3.create();;
    private scale = vec3.create();

    private lastEulers = vec3.create();;
    private nextEulers = vec3.create();;

    private lastPosition = vec3.create();;
    private nextPosition = vec3.create();;

    private velocity = vec3.create();

    private flying = false;

    private minCollisionDistance: number;
    private maxCollisionDistance: number;

    // AI

    private normalInstructions: Instruction[] = [];
    private curInstrIdx: number = 0;
    private curInstr: Instruction | null = null;
    private curInstrExecCount: number = 0;
    private curInstrLifetime: number = -1;
    private instrCooldownCounter: number = 0;

    private collision: Collision | null = null;

    private dstPos: vec3 = vec3.create();
    private dstEulers: vec3 = vec3.create();

    constructor (private device: GfxDevice, private cache: GfxRenderCache, private textureHolder: Textures.GloverTextureHolder, private objects: ObjectDirectory, private sceneLights: SceneLighting, private enemyType: EnemyType, position: vec3, y_rotation: number, private level_id: string) {
        vec3.copy(this.lastPosition, position);
        vec3.copy(this.nextPosition, position);
        vec3.copy(this.position, position);
        this.lastEulers[1] = y_rotation;
        this.nextEulers[1] = y_rotation;
        this.dstEulers[1] = y_rotation;

        this.flying = (enemy_beh[enemyType].actorFlags & 1) === 0;

        const scale = enemy_scales[enemyType];
        vec3.set(this.scale, scale, scale, scale);

        let objId = enemy_objects[enemyType];

        if (this.enemyType === EnemyType.hubchicken) {
            switch(level_id) {
                case '00':
                case '01':
                case '02':
                    objId = 0x11CD1E6C // hubchicken3.ndo
                    break;
                case '03':
                case '04':
                    objId = 0x58C079E1 // hubchicken2.ndo
                    break;
                default:
                    objId = 0x83D7D176; // hubchicken1.ndo
                    break;
            }
        }

        const objRoot = objects.get(objId);
        if (objRoot === undefined) {
            throw `Object 0x${objId.toString(16)} is not loaded!`;
        }
        this.actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, sceneLights);
        this.actor.playSkeletalAnimation(5, true, false);
        this.updateActorModelview();

        // TODO: per-enemy tweaks
        this.minCollisionDistance = 1.0;
        this.maxCollisionDistance = enemy_beh[this.enemyType].collisionRadius;

        switch (enemyType) {
            case EnemyType.robes: {
                this.particles = new ParticlePool(device, cache, textureHolder, 0xc);
                break;
            }
            case EnemyType.sucker: {
                this.particles = new ParticlePool(device, cache, textureHolder, 1);
                break;
            }
            case EnemyType.frankie2: {
                this.maxCollisionDistance = 30;
            }
            case EnemyType.fumble: {
                this.maxCollisionDistance = 5;
            }
            case EnemyType.cymon: {
                this.maxCollisionDistance = 20;
            }
            case EnemyType.chuck: {
                this.maxCollisionDistance = 22;
            }

            // TODO: mike, raptor, opec, and then audit from kloset onward
        }
    }

    private instructionConditionsMet(instr: Instruction) {
        switch (instr.executionCondition) {
            case ExecutionCondition.PERIODIC: {
                // todo
                return false;
            }
            case ExecutionCondition.ROLL_ANGLE_WITHIN_RANGE_AND_PERIODIC: {
                // todo
                return false;
            }
            case ExecutionCondition.ENEMY_WITHIN_ATTENTION_BBOX: {
                // todo
                return false;
            }
            case ExecutionCondition.ALWAYS: {
                return true;
            }
            case ExecutionCondition.RANDOM_CHANCE_PARAM_A_OVER_1000: {
                // todo
                return false;
            }
            default: {
                return false;
            }

        }
    }

    public getPosition(): vec3 {
        return this.position;
    }

    public pushNormalInstruction(instr: Instruction) {
        this.normalInstructions.push(instr);
    }

    private updateActorModelview() {
        quat.fromEuler(this.rotation,
            this.eulers[0] * 180/Math.PI,
            this.eulers[1] * 180/Math.PI,
            this.eulers[2] * 180/Math.PI);
        mat4.fromRotationTranslationScale(this.actor.modelMatrix, this.rotation, this.position, this.scale);
    }

    public destroy(device: GfxDevice): void {
        this.actor.destroy(device);

        if (this.particles !== null) {
            this.particles.destroy(device);
        }
    }

    private throttleVelocity(speedCap: number) {
        if ((enemy_beh[this.enemyType].actorFlags & 0x1000000) === 0) {
            const velMagnitude = vec3.length(this.velocity);
            if (velMagnitude > speedCap) {
                vec3.scale(this.velocity, this.velocity, speedCap / velMagnitude);
            }
        }
    }

    private setXZVelocityBasedOnRotation(speed: number, speedCap: number) {
        this.velocity[0] += speed * Math.sin(this.nextEulers[1]);
        this.velocity[2] += speed * Math.cos(this.nextEulers[1]);
        if ((enemy_beh[this.enemyType].actorFlags & 0x1000000) === 0) {
            const xz_speed = Math.sqrt(this.velocity[0]*this.velocity[0] + this.velocity[2]*this.velocity[2]);
            this.velocity[0] *= speedCap / xz_speed;
            this.velocity[2] *= speedCap / xz_speed;
        }
    }

    private groundCollisionCheck(): boolean {
        assert(this.curInstr !== null);
        const beh = enemy_beh[this.enemyType];

        if (this.instrCooldownCounter === 0) {
            if ((enemy_init_flags[this.enemyType] & 4) === 0) {
                let collided: boolean = false;

                vec3.normalize(scratchVec3, this.velocity);
                const collision = projectOntoTerrain(this.nextPosition, null, this.terrain, scratchVec3, false);
                if (collision !== null) {
                    const collisionDist = vec3.distance(collision.position, this.nextPosition);
                    if (collisionDist < vec3.length(this.velocity) * this.maxCollisionDistance * 2) {
                        collided = true;
                        vec3.zero(this.velocity);
                        this.velocity[0] = collision.normal[0] * beh.walkSpeed;
                        this.velocity[2] = collision.normal[2] * beh.walkSpeed;
                    }
                }

                if (collided) {
                    if ((this.curInstr.flags & 0x1000) === 0) {
                        const thetaDist = angularDistance(this.dstEulers[1], this.nextEulers[1]);
                        if (thetaDist < Math.PI / 2) {
                            this.dstEulers[1] += Math.PI;
                        }
                        this.dstEulers[1] = radianModulo(this.dstEulers[1]);
                    }
                    this.instrCooldownCounter = 0x5; // 0x1e;
                }
                return collided;
            }
        }
        return false;
    }

    private flyTo(dst: vec3, velMagnitude: number, instrFlags: number): boolean {
        if (this.groundCollisionCheck()) {
            return true;
        }
        // TODO: enemy-specific edge cases (dibber, bugle, robes)
        const distRemaining = vec3.dist(this.nextPosition, dst);
        if (distRemaining > velMagnitude) {
            const journeyVec = scratchVec3;
            vec3.sub(journeyVec, this.nextPosition, dst);
            if ((instrFlags & 0x1000) === 0) {
                this.dstEulers[1] = radianModulo(Math.atan2(-journeyVec[0], -journeyVec[2]));
            }
            vec3.normalize(journeyVec, journeyVec);
            vec3.scale(journeyVec, journeyVec, enemy_beh[this.enemyType].walkSpeed);

            if (this.enemyType !== EnemyType.bugle) {
                /* Slow down when turning */
                if (angularDistance(this.eulers[1], this.dstEulers[1]) > Math.PI / 6) {
                    vec3.scale(this.velocity, this.velocity, 0.8);
                }
            }

            if ((instrFlags & 0x4) === 0) {
                /* Slow down when approaching destination */
                if (distRemaining < velMagnitude * 1.3) {
                    vec3.scale(this.velocity, this.velocity, distRemaining / (velMagnitude * 1.3));
                    vec3.scale(journeyVec, journeyVec, 0.7);
                }
            }

            if ((instrFlags & 1) !== 0) {
                const xz_speed = Math.sqrt(journeyVec[0]*journeyVec[0] + journeyVec[2]*journeyVec[2]);
                this.setXZVelocityBasedOnRotation(xz_speed, enemy_beh[this.enemyType].maxVelocity)
            }

            if ((instrFlags & 2) !== 0) {
                this.velocity[0] -= journeyVec[0];
                this.velocity[2] -= journeyVec[2];
            }

            this.velocity[1] -= journeyVec[1];

            this.throttleVelocity(enemy_beh[this.enemyType].maxVelocity);

            if ((instrFlags & 0x2000) !== 0) {
                let roll = -subtractAngles(this.dstEulers[1], this.nextEulers[1]) * enemy_roll_modulation[this.enemyType];
                if (Math.abs(roll) > 0.08) {
                    this.dstEulers[2] = radianModulo(roll);
                } else {
                    this.dstEulers[2] = 0;
                }
            }

            return false;
        }

        if (this.enemyType !== EnemyType.bugle) {
            if (this.enemyType === EnemyType.dibber) {
                vec3.scale(this.velocity, this.velocity, 0.5);
            }
            this.dstEulers[2] = 0;
        }

        return true;

    }

    private walkTo(dst: vec3, velMagnitude: number, instrFlags: number): boolean {

        this.dstEulers[2] = 0;

        if (this.groundCollisionCheck()) {
            return true;
        }

        const journeyVec = scratchVec3;
        vec3.sub(journeyVec, this.nextPosition, dst);

        let distXZ = Math.sqrt(journeyVec[0]*journeyVec[0] + journeyVec[2]*journeyVec[2]);
        if (distXZ < velMagnitude) {
            this.velocity[0] *= 0.5;
            this.velocity[2] *= 0.5;
            return true;
        }

        if ((instrFlags & 0x1) != 0) {
            journeyVec[0] /= distXZ;
            journeyVec[2] /= distXZ;
            journeyVec[0] *= enemy_beh[this.enemyType].walkSpeed;
            journeyVec[2] *= enemy_beh[this.enemyType].walkSpeed;
            // TODO: double check this block, it seems to not be firing for sharkle even though he needs it??
            if ((instrFlags & 0x1000) === 0) {
                this.dstEulers[1] = radianModulo(Math.atan2(journeyVec[0], journeyVec[2]) + Math.PI);
            }
            this.setXZVelocityBasedOnRotation(enemy_beh[this.enemyType].walkSpeed, enemy_beh[this.enemyType].maxVelocity);
        }

        if ((instrFlags & 0x2) != 0) {
            if ((enemy_beh[this.enemyType].actorFlags & 0x1000000) === 0) {
                const xz_speed = Math.sqrt(this.velocity[0]*this.velocity[0] + this.velocity[2]*this.velocity[2]);
                if (xz_speed >= enemy_beh[this.enemyType].maxVelocity) {
                    return false;
                }
                vec3.sub(journeyVec, this.nextPosition, dst);
                journeyVec[1] = 0;
                vec3.normalize(journeyVec, journeyVec);
                vec3.scale(journeyVec, journeyVec, enemy_beh[this.enemyType].walkSpeed);
                this.velocity[0] -= journeyVec[0];
                this.velocity[2] -= journeyVec[2];
            }
        }

        if ((instrFlags & 0x2000) != 0) {
            const theta_diff = subtractAngles(this.dstEulers[1], this.nextEulers[1]) * enemy_roll_modulation[this.enemyType];
            if (Math.abs(theta_diff) > 0.08) {
                this.dstEulers[2] = theta_diff;
            } else {
                this.dstEulers[2] = 0;
            }
        }
        return false;
    }

    private instrRandomWalk() {
        assert(this.curInstr !== null);
        assert(this.curInstr.params !== undefined);
        assert(this.curInstr.params.__type === "EnemyInstructionRandomWalk");
        let chooseNewPoint = false;
        if (this.curInstrExecCount == 0) {
            if ((this.curInstr.flags & 0x4000) === 0) {
                if (this.enemyType === EnemyType.yoofow) {
                    this.actor.playSkeletalAnimation(0xd, false, false);
                    this.actor.playSkeletalAnimation(0xf, true, true);
                } else {
                    if ((this.curInstr.flags & 0x40000) === 0) {
                        this.actor.playSkeletalAnimation(0xf, true, false);
                    } else {
                        this.actor.playSkeletalAnimation(9, true, false);
                    }
                }
            }
            chooseNewPoint = true;
        } else {
            const velMagnitude = vec3.length(this.velocity) + 20;
            if (this.flying) {
                chooseNewPoint = this.flyTo(this.dstPos, velMagnitude, this.curInstr.flags);
            } else {
                chooseNewPoint = this.walkTo(this.dstPos, velMagnitude, this.curInstr.flags);
            }
        }
        if (chooseNewPoint) {
            while (true) {
                vec3.set(this.dstPos, this.curInstr.params.homeX, this.curInstr.params.homeY, this.curInstr.params.homeZ);
                this.dstPos[0] += Math.floor(Math.random() * this.curInstr.params.extentX);
                this.dstPos[1] += Math.floor(Math.random() * this.curInstr.params.extentY);
                this.dstPos[2] += Math.floor(Math.random() * this.curInstr.params.extentZ);
                if (vec3.distance(this.dstPos, this.nextPosition) >= this.curInstr.params.minTravelDistance) {
                    break;
                }
            }
        }
    }

    private instrTurn() {
        assert(this.curInstr !== null);
        assert(this.curInstr.params !== undefined);
        assert(this.curInstr.params.__type === "EnemyInstructionTurn");

        if (this.curInstrExecCount === 0 && (this.curInstr.flags & 0x4000) === 0) {
            this.actor.playSkeletalAnimation(0xf, true, false);
        }
        if (this.curInstr.params.chooseRandomDirection === 0) {
            this.dstEulers[1] = radianModulo(Math.atan2(this.curInstr.params.lookatX - this.nextPosition[0],
                                                        this.curInstr.params.lookatZ - this.nextPosition[2]));
        } else {
            this.dstEulers[1] = Math.floor(Math.random()*0x274) / 100;
        }

        return angularDistance(this.dstEulers[1], this.nextEulers[1]) < 0.1;
    }

    private instrRest() {
        assert(this.curInstr !== null);
        assert(this.curInstr.params !== undefined);
        assert(this.curInstr.params.__type === "EnemyInstructionRest");

        if (this.enemyType == EnemyType.hubchicken) {
            // TODO: hack to let chicken swing, because the rest of this
            //       is not properly implemented
            return;
        }  
        if (this.enemyType == EnemyType.dibber) {
            vec3.scale(this.velocity, this.velocity, 0.5);
        }
        const restFlags = this.curInstr.params.flags;
        if (this.curInstrExecCount == 0) {
            let queueAnim = false;
            if ((restFlags & 2) == 0) {
                if ((this.curInstr.flags & 0x4000) == 0) {
                    if ((restFlags & 4) == 0) {
                        queueAnim = false;
                    } else {
                        this.actor.isPlaying = false;
                        queueAnim = true;
                    }
                    this.actor.playSkeletalAnimation(5, this.curInstr.params.animStartPlaying != 0, queueAnim);
                }
            } else {
                if ((restFlags & 4) != 0) {
                    this.actor.isPlaying = false;
                    queueAnim = true;
                }
                this.actor.playSkeletalAnimation(0xe, false, queueAnim);
                if ((this.curInstr.flags & 0x4000) == 0) {
                    queueAnim = true;
                    this.actor.playSkeletalAnimation(5, this.curInstr.params.animStartPlaying != 0, queueAnim);
                }
            }
        }

        // TODO:
        // if (((restFlags & 1) != 0) && this.curInstrExecCount < 5) {
        //     spawnParticles_801b70f8(this.actor.pos,2,0.0,0.8);
        // }
    }


    private advanceAI() {
        let advanceInstr: boolean = false;

        if (this.instrCooldownCounter > 0) {
            this.instrCooldownCounter -= 1;
            return;
        }

        if (this.curInstr !== null) {
            const instrParams = this.curInstr.params!;
            switch (instrParams.__type) {
                case 'EnemyInstructionRandomWalk': {
                    this.instrRandomWalk();
                    break;
                }
                case 'EnemyInstructionMove': {
                    advanceInstr = this.flyTo(
                        [instrParams.destinationX, instrParams.destinationY, instrParams.destinationZ], 
                        instrParams.velMagnitude,
                        this.curInstr.flags
                    );
                    if (advanceInstr) {
                        this.curInstrIdx++;
                        if ((this.curInstr.flags & 0x4000) === 0) { 
                            this.actor.playSkeletalAnimation(0xe, false, false);
                        }
                    }
                    break;
                }
                case 'EnemyInstructionDash': {
                    if (this.curInstrExecCount === 0) {
                        if ((this.curInstr.flags & 0x40000) == 0) {
                            if ((this.curInstr.flags & 0x4000) == 0) {
                                this.actor.playSkeletalAnimation(0xd, true, false);
                                this.actor.playSkeletalAnimation(0xf, true, true);
                            }
                        } else {
                            this.actor.playSkeletalAnimation(0xd, true, false);
                            this.actor.playSkeletalAnimation(9, true, true);
                        }
                    }
                    if ((this.curInstr.flags & 0x80000) === 0 || this.actor.currentAnimIdx != 0xd) {
                        advanceInstr = this.walkTo(
                            [instrParams.destinationX, instrParams.destinationY, instrParams.destinationZ], 
                            instrParams.velMagnitude,
                            this.curInstr.flags
                        );
                        if (advanceInstr) {
                            this.curInstrIdx++;
                        }
                    }
                    break;
                }


                case 'EnemyInstructionTurn': {
                    // TODO: this is a hack to keep dibbers from flipping out.
                    //       figure out why, in game, they don't need this:
                    // TODO: even with this, a dibber near the beginning of PH2 flips out. investigate
                    if (this.curInstrExecCount == 0) {
                        vec3.zero(this.velocity);
                    }
                    advanceInstr = this.instrTurn();
                    if (advanceInstr) {
                        this.curInstrIdx++;
                    }
                    break;
                }
                case 'EnemyInstructionRest': {
                    this.instrRest();
                    if (this.curInstrLifetime <= 0 && (this.actor.currentAnimIdx === 5 || (instrParams.flags & 4) === 0)) {
                        advanceInstr = true;
                        this.curInstrIdx++;
                    }
                    break;
                }

                case 'EnemyInstructionPlayAnimation': {
                    if (this.curInstrExecCount == 0) {
                        // TODO:
                        // if (((enemy->curInstruction).flags & INSTR_FLAG_SLOW_DOWN_CLOSE_TO_DESTINATION) != 0) {
                        //     animReset_80133b9c(&enemy->actor);
                        // }
                        let animIdx = 0;
                        if (instrParams.animIdx1 < 0) {
                            if ((this.curInstr.flags & 0x2) != 0) {
                                this.actor.isPlaying = false;
                            }
                            animIdx = instrParams.animIdx2;
                        } else {
                            if ((this.curInstr.flags & 0x2) != 0) {
                                this.actor.isPlaying = false;
                            }
                            animIdx = instrParams.animIdx1 + 10;
                        }
                        this.actor.playSkeletalAnimation(animIdx,
                                (this.curInstr.flags & 0x1) !== 0,
                                (this.curInstr.flags & 0x2) !== 0);
                    }
                    if (this.curInstrLifetime <= 0) {
                        let dstIdx = instrParams.animIdx1 + 10;
                        if (instrParams.animIdx1 < 0) {
                          dstIdx = instrParams.animIdx2;
                        }
                        if (this.actor.currentAnimIdx === dstIdx) {
                            this.curInstrIdx++
                            advanceInstr = true;
                        }
                    }

                    break;
                }
                case 'EnemyInstructionGoto': {
                    this.curInstrIdx = instrParams.instrIdx;
                    advanceInstr = true;
                    break;
                }
            }
            this.curInstrExecCount += 1;
            if (this.curInstrLifetime > 0) {
                this.curInstrLifetime -= 1;
            }
            if (this.curInstrLifetime == 0 && !advanceInstr) {
                // TODO: if guard is a hack for incomplete fumble ai
                if (this.enemyType !== EnemyType.fumble) {
                    this.curInstrIdx++
                    advanceInstr = true;                    
                }
            }
        }

        if (this.curInstr === null || advanceInstr) {
            for (;this.curInstrIdx < this.normalInstructions.length; this.curInstrIdx++) {
                if (this.instructionConditionsMet(this.normalInstructions[this.curInstrIdx])) {
                    break;
                }
            }

            this.curInstrExecCount = 0;
            if (this.curInstrIdx < this.normalInstructions.length) {
                this.curInstr = this.normalInstructions[this.curInstrIdx];
                this.curInstrLifetime = this.curInstr.lifetime;
            } else {
                this.curInstr = null;
            }
        }

        const bobble = enemy_bobble[this.enemyType];
        if (bobble[0] !== 0) {
            this.velocity[1] += Math.sin(this.frameCount/bobble[0]) * bobble[1];
        }
    }

    private advanceEulerAngle(axis: number) {
        const beh = enemy_beh[this.enemyType];

        this.dstEulers[axis] = radianModulo(this.dstEulers[axis])        
        if (angularDistance(this.nextEulers[axis], this.dstEulers[axis]) <= 0.01) {
           this.nextEulers[axis] = this.dstEulers[axis];
           return;
        }
 
        let thetaChange = angularDistance(this.nextEulers[axis], this.dstEulers[axis]);
        let spinTween = (axis === 0) ? beh.spinTweenX : (axis === 1) ? beh.spinTweenY : beh.spinTweenZ;
        if (spinTween === 1) {
           thetaChange /= 2.0;
        }
        thetaChange = Math.min(thetaChange, beh.maxRotationSpeed);
 
        if (this.nextEulers[axis] < this.dstEulers[axis]) {
           if (this.dstEulers[axis] - this.nextEulers[axis] >= Math.PI) {
              this.nextEulers[axis] -= thetaChange;
           } else {
              this.nextEulers[axis] += thetaChange;
           }
        } else {
           if (this.nextEulers[axis] - this.dstEulers[axis] >= Math.PI) {
              this.nextEulers[axis] += thetaChange;
           } else {         
              this.nextEulers[axis] -= thetaChange;
           }
        }
        this.nextEulers[axis] = radianModulo(this.nextEulers[axis]);
        return;
    }

    private advancePhysics() {
        const beh = enemy_beh[this.enemyType];

        vec3.add(this.nextPosition, this.nextPosition, this.velocity);

        if ((beh.actorFlags & 1) !== 0) {
            // TODO: need floor collision, first:
            // const gravAccel = (beh.actorFlags & 0x40) == 0 ? 1.2 : 0.6;
            // const terminalVelocity = (beh.actorFlags & 0x1000000) == 0 ? -15 : -100000;
            // this.velocity[1] = Math.max(this.velocity[1] - gravAccel, terminalVelocity);

            vec3.scale(this.velocity, this.velocity, Math.max(0, beh.decel0x18));

            vec3.copy(scratchVec3, this.position);
            scratchVec3[1] += this.maxCollisionDistance;
            const groundCollision = projectOntoTerrain(scratchVec3, null, this.terrain);
            if (groundCollision !== null) {
                this.nextPosition[1] = groundCollision.position[1] + this.maxCollisionDistance;
            }
        } else {
            vec3.scale(this.velocity, this.velocity, 1-(1-beh.decel0x18)/4);

        }
        vec3.scale(this.velocity, this.velocity, 0.75);

        if (beh.spinTweenX !== 0) {
            this.advanceEulerAngle(0);
        }
        if (beh.spinTweenY !== 0) {
            this.advanceEulerAngle(1);
        }
        if (beh.spinTweenZ !== 0) {
            this.advanceEulerAngle(2);
        }


    }

    private advancePerEnemyCode() {
        switch (this.enemyType) {
            case EnemyType.robes: {
                // TODO:
                // actor.alpha = Math.sin(this.frameCount/8.0);
                const ether_spawn_period = (this.level_id === '1e') ? 3 : 1;
                const ether_lifetime = (this.level_id === '1e') ? 0x28 : 0x10 // 1; technically it's supposed to be 1 but that makes my eyes bleed
                const ether_alpha_center = (this.level_id === '1e') ? 0x3c : 0x78;
                const ether_alpha_spread = (this.level_id === '1e') ? 0xa : 0x1e;
                if ((this.frameCount % ether_spawn_period) === 0) {
                    const particle = this.particles!.spawn(this.nextPosition, [0,0,0]);
                    particle.flipbook.setPrimColor(0xbf, 0xff, 0x14);
                    particle.flipbook.startAlpha = 0;
                    particle.flipbook.endAlpha = ether_alpha_center + Math.sin(this.frameCount / 10) * ether_alpha_spread;
                    particle.flipbook.startSize = particle.flipbook.flipbookMetadata.startSize * 3; 
                    particle.flipbook.endSize = particle.flipbook.flipbookMetadata.endSize * 3; 
                    particle.setLifetime(ether_lifetime);
                }
                break;
            }
            case EnemyType.sucker: {
                if ((this.frameCount % 3) === 0) {
                    const pos = scratchVec3;
                    const vel = scratchVec3_2;
                    vec3.copy(pos, this.nextPosition);
                    vec3.scale(vel, this.velocity, 0.8 / SRC_FRAME_TO_MS);
                    pos[1] += 8;
                    vel[1] += 3;
                    const particle = this.particles!.spawn(pos, vel);
                    particle.setLifetime(10);
                }
                break;
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;

        if (this.lastFrameAdvance > SRC_FRAME_TO_MS) {
            this.lastFrameAdvance = 0;
            this.frameCount += 1;
            vec3.copy(this.lastPosition, this.nextPosition);
            vec3.copy(this.lastEulers, this.nextEulers);
            this.advanceAI();
            this.advancePerEnemyCode();
            this.advancePhysics();
        }


        vec3.lerp(this.position, this.lastPosition, this.nextPosition, Math.min(1.0, this.lastFrameAdvance/(SRC_FRAME_TO_MS*1.1)));
        radianLerp(this.eulers, this.lastEulers, this.nextEulers, Math.min(1.0, this.lastFrameAdvance/(SRC_FRAME_TO_MS*1.1)));

        this.updateActorModelview();

        this.actor.prepareToRender(device, renderInstManager, viewerInput);

        if (this.particles !== null) {
            this.particles.prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}
