import { vec3 } from "gl-matrix";
import { colorNewFromRGBA } from "../../Color";
import { ObjectInstance } from "../objects";
import { World } from "../world";
import { createPointLight, Light, LightType } from "../WorldLights";
import { commonSetup } from "./Common";
import { SFAClass } from "./SFAClass";

export class LightObj extends SFAClass {
    private light: Light;

    constructor(obj: ObjectInstance, data: DataView) {
        super(obj, data);
        commonSetup(obj, data, 0x18, 0x19);

        const spotFunc = data.getUint8(0x21); // TODO: this value is passed to GXInitSpotLight
        if (spotFunc === 0)
            obj.setModelNum(0);
        else
            obj.setModelNum(1);

        // Distance attenuation values are calculated by GXInitLightDistAttn with GX_DA_MEDIUM mode
        // TODO: Some types of light use other formulae
        const refDistance = data.getUint16(0x22);
        const refBrightness = 0.75;
        const kfactor = 0.5 * (1.0 - refBrightness);
        const distAtten = vec3.fromValues(
            1.0,
            kfactor / (refBrightness * refDistance),
            kfactor / (refBrightness * refDistance * refDistance)
            );

        const color = colorNewFromRGBA(
            data.getUint8(0x1a) / 0xff,
            data.getUint8(0x1b) / 0xff,
            data.getUint8(0x1c) / 0xff,
            1.0
        );

        this.light = createPointLight(obj.getPosition(), color, distAtten);
    }

    public mount(obj: ObjectInstance, world: World) {
        world.worldLights.addLight(this.light);
    }

    public unmount(obj: ObjectInstance, world: World) {
        world.worldLights.removeLight(this.light);
    }
}