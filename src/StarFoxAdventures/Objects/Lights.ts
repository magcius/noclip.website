import { vec3 } from "gl-matrix";
import { Color, colorNewFromRGBA, colorNewFromRGBA8, White } from "../../Color";
import { ObjectInstance } from "../objects";
import { SFATexture } from "../textures";
import { angle16ToRads } from "../util";
import { World } from "../world";
import { createPointLight, Light, LightType } from "../WorldLights";
import { commonSetup } from "./Common";
import { SFAClass } from "./SFAClass";

const scratchVec0 = vec3.create();

export class LGTPointLgt extends SFAClass { // Class 681: LGTPointLgt
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x18, 0x19);

        const spotFunc = data.getUint8(0x21); // TODO: this value is passed to GXInitSpotLight
        if (spotFunc === 0)
            obj.setModelNum(0);
        else
            obj.setModelNum(1);

        const refDistance = data.getUint16(0x22);
        const radius = data.getUint16(0x24);

        const color = colorNewFromRGBA(
            data.getUint8(0x1a) / 0xff,
            data.getUint8(0x1b) / 0xff,
            data.getUint8(0x1c) / 0xff,
            1.0
        );

        vec3.zero(scratchVec0);
        this.light = createPointLight(scratchVec0, color, refDistance, radius);
        this.light.obj = obj;
        this.light.affectsMap = !!data.getUint8(0x3f);
    }

    public override mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public override unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}

export class LGTProjecte extends SFAClass {
    private light: Light;
    private texture: SFATexture | null;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x18, 0x19, 0x34);

        const refDistance = data.getUint16(0x1a);
        const radius = data.getUint16(0x1c);

        const color = colorNewFromRGBA(
            data.getUint8(0x2d) / 0xff,
            data.getUint8(0x2e) / 0xff,
            data.getUint8(0x2f) / 0xff,
            data.getUint8(0x37) / 0xff
        );

        const texId = data.getUint16(0x24);
        if (texId === 0)
            this.texture = obj.world.resColl.texFetcher.getTexture(obj.world.device, 0x5dc, false);
        else
            this.texture = obj.world.resColl.texFetcher.getTexture(obj.world.device, texId, false);
        console.log(`loaded projected light texture ${this.texture?.viewerTexture?.name}`);

        vec3.zero(scratchVec0);
        this.light = createPointLight(scratchVec0, color, refDistance, radius);
        this.light.obj = obj;
    }

    public override mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public override unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}

const TORCH_COLORS = [
    colorNewFromRGBA8(0xffc000ff),
    colorNewFromRGBA8(0xff7f00ff),
    colorNewFromRGBA8(0xffc000ff),
    colorNewFromRGBA8(0xffc000ff),
    colorNewFromRGBA8(0x00ffffff),
    colorNewFromRGBA8(0xff0000ff),
    colorNewFromRGBA8(0x00ff00ff),
    colorNewFromRGBA8(0xffff00ff),
    colorNewFromRGBA8(0xff4000ff),
    colorNewFromRGBA8(0xffc000ff),
    colorNewFromRGBA8(0x007fffff),
    colorNewFromRGBA8(0xffff00ff),
    colorNewFromRGBA8(0xffffffff),
    colorNewFromRGBA8(0xffffffff),
    colorNewFromRGBA8(0xffffffff),
];

export class Torch extends SFAClass { // Class 518: WM_Torch, PoleFlame
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        obj.yaw = angle16ToRads((data.getUint8(0x18) & 0x3f) << 10);
        const objScale = data.getInt16(0x1a);
        if (objScale < 1)
            obj.scale = 0.1;
        else
            obj.scale = objScale / 8192;

        let colorSelector = 1; // TODO: may be animated
        if (!data.getUint8(0x19)) {
            const flags = data.getUint16(0x1c);
            if (flags & 0x4)
                colorSelector = 4;
            else if (flags & 0x8)
                colorSelector = 8;
            else if (flags & 0x10)
                colorSelector = 6;
        }
        const color = TORCH_COLORS[colorSelector];

        if (obj.commonObjectParams.objType === 0x705 || obj.commonObjectParams.objType === 0x712)
            vec3.zero(scratchVec0);
        else
            vec3.set(scratchVec0, 0.0, 7.0, 0.0);
        this.light = createPointLight(scratchVec0, color, 40.0, 65.0);
        this.light.obj = obj;
    }

    public override mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public override unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}

const TORCH2_COLORS: Color[][] = [
    [
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0xff7f00ff),
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0x00ffffff),
        colorNewFromRGBA8(0xff0000ff),
        colorNewFromRGBA8(0x00ff00ff),
        colorNewFromRGBA8(0xffff00ff),
        colorNewFromRGBA8(0xff4000ff),
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0x007fffff),
        colorNewFromRGBA8(0xffff00ff),
        colorNewFromRGBA8(0xffffffff),
        colorNewFromRGBA8(0xffffffff),
        colorNewFromRGBA8(0xffffffff),
        colorNewFromRGBA8(0xff0000ff),
    ],
    [ // For objtype 0x758
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0xffc040ff),
        colorNewFromRGBA8(0xc07fffff),
        colorNewFromRGBA8(0xffc000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
        colorNewFromRGBA8(0x000000ff),
    ],
];

export class Torch2 extends SFAClass { // Class 689: CmbSrcTWall
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x1a, 0x19, 0x18);

        const colorSelector = data.getUint8(0x1b);
        const color = TORCH2_COLORS[obj.commonObjectParams.objType === 0x758 ? 1 : 0][colorSelector];

        const refDistance = (data.getUint8(0x2a) & 0x8 ? 520.0 : 130.0) * obj.scale;
        const radius = refDistance + 40.0;

        if (obj.commonObjectParams.objType === 0x758)
            vec3.zero(scratchVec0);
        else
            vec3.set(scratchVec0, 0.0, 7.0, 0.0);
        this.light = createPointLight(scratchVec0, color, refDistance, radius);
        this.light.obj = obj;
        this.light.affectsMap = !!(data.getUint8(0x29) & 0x20);
    }

    public override mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public override unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}