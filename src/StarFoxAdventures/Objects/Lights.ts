import { vec3 } from "gl-matrix";
import { colorNewFromRGBA, White } from "../../Color";
import { ObjectInstance } from "../objects";
import { SFATexture } from "../textures";
import { angle16ToRads } from "../util";
import { World } from "../world";
import { createPointLight, Light, LightType } from "../WorldLights";
import { commonSetup } from "./Common";
import { SFAClass } from "./SFAClass";

const scratchVec0 = vec3.create();

export class LGTPointLgt extends SFAClass {
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
    }

    public mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public unmount(obj: ObjectInstance, world: World) {
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

    public mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}

export class Torch extends SFAClass { // WM_Torch, PoleFlame
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        obj.yaw = angle16ToRads((data.getUint8(0x18) & 0x3f) << 10);
        const objScale = data.getInt16(0x1a);
        if (objScale < 1)
            obj.scale = 0.1;
        else
            obj.scale = objScale / 8192;

        vec3.zero(scratchVec0);
        this.light = createPointLight(scratchVec0, White, 40.0, 65.0);
        this.light.obj = obj;
    }

    public mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}

export class Torch2 extends SFAClass { // CmbSrcTWall
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x1a, 0x19, 0x18);

        // TODO: load light color (selected by data 0x1b)

        const refDistance = (data.getUint8(0x2a) & 0x8 ? 520.0 : 130.0) * obj.scale;
        const radius = refDistance + 40.0;

        vec3.zero(scratchVec0);
        this.light = createPointLight(scratchVec0, White, refDistance, radius);
        this.light.obj = obj;
    }

    public mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}