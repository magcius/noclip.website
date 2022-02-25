import * as Textures from './textures';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

import { SRC_FRAME_TO_MS } from './timing';

import { vec3, quat, mat4 } from "gl-matrix";

import { GenericRenderable, SceneLighting } from './render';
import { ObjectDirectory } from './scenes';
import { GloverActorRenderer } from './actor';

export const enum EnemyType {
    bovva = 7,
    cannon,
    samtex,
    mallet,
    generalw,
    lionfish,
    chester,
    keg,
    reggie,
    swish,
    thrice,
    robes,
    fumble,
    mike,
    raptor,
    crumpet,
    tracey,
    yoofow,
    opec,
    cymon,
    sucker,
    bugle,
    dennis,
    chuck,
    hubchicken1,
    frankie2,
    kloset,
    willy,
    joff,
    cancer,
    kirk,
    robot,
    evilrobot,
    spank,
    babyspk2,
    evilglove,
    dibber,
    brundle,
    malcom,
    spotty,
    gordon,
    sidney,
    weevil,
    chopstik,
    butterfly,
    spider,
    bat,
    frog,
    dragfly,
    boxthing,
    bug,
    nmefrog
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
    0xEB80C7C1, // keg.ndo
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
    0xE38B474D, // bat.ndo
    0xE21973A2, // frog.ndo
    0x792B1F93, // dragfly.ndo
    0x1EE07E45, // boxthing.ndo
    0x61AF1E01, // bug.ndo
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


export class GloverEnemy implements GenericRenderable {
    private actor: GloverActorRenderer;


    private eulers = vec3.fromValues(0,0,0);
    private rotation = quat.create();
    private position = vec3.fromValues(0,0,0);
    private scale = vec3.create();


    public visible: boolean = true;

    constructor (private device: GfxDevice, private cache: GfxRenderCache, private textureHolder: Textures.GloverTextureHolder, private objects: ObjectDirectory, private sceneLights: SceneLighting, private enemyType: EnemyType, position: vec3, y_rotation: number) {
        vec3.copy(this.position, position);
        this.eulers[1] = y_rotation;

        const scale = enemy_scales[enemyType];
        vec3.set(this.scale, scale, scale, scale);

        const objId = enemy_objects[enemyType];
        const objRoot = objects.get(objId);
        if (objRoot === undefined) {
            throw `Object 0x${objId.toString(16)} is not loaded!`;
        }
        this.actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, sceneLights);
        this.actor.playSkeletalAnimation(5, true, false);
        // TODO:
        // switch (enemyType) {
        //     ...
        // }

        this.updateActorModelview();
    }

    private updateActorModelview() {
        // TODO: are these in degrees or radians?
        quat.fromEuler(this.rotation,
            this.eulers[0],
            this.eulers[1],
            this.eulers[2]);
        mat4.fromRotationTranslationScale(this.actor.modelMatrix, this.rotation, this.position, this.scale);
    }

    public destroy(device: GfxDevice): void {
        this.actor.destroy(device);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }
        this.actor.prepareToRender(device, renderInstManager, viewerInput);
    }

};