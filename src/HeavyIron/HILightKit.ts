import { mat4 } from "gl-matrix";
import { RpLight, RpLightType, RpWorld } from "./rw/rpworld.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";

export const enum HILightKitLightType {
    Ambient = 1,
    Directional = 2,
    Point = 3, // unsupported
    Spot = 4 // unsupported
}

export class HILightKit {
    public lightList: RpLight[] = [];

    constructor(data: ArrayBufferSlice, rw: RwEngine) {
        const stream = new RwStream(data);
        
        const tagID = stream.readUint32();
        const groupID = stream.readUint32();
        const lightCount = stream.readUint32();
        const lightListPtr = stream.readUint32();
        for (let i = 0; i < lightCount; i++) {
            const type = stream.readUint32();
            const color = stream.readRGBAReal();
            const matrix = mat4.fromValues(
                stream.readFloat(), stream.readFloat(), stream.readFloat(), stream.readFloat(),
                stream.readFloat(), stream.readFloat(), stream.readFloat(), stream.readFloat(),
                stream.readFloat(), stream.readFloat(), stream.readFloat(), stream.readFloat(),
                stream.readFloat(), stream.readFloat(), stream.readFloat(), stream.readFloat()
            );
            const radius = stream.readFloat();
            const angle = stream.readFloat();
            const platLightPtr = stream.readUint32();

            if (color.r > 1.0 || color.g > 1.0 || color.b > 1.0) {
                let s = Math.max(color.r, color.g, color.b);
                s = Math.max(s, 0.00001);
                s = 1.0 / s;

                color.r *= s;
                color.g *= s;
                color.b *= s;
            }

            let light: RpLight;

            switch (type) {
            case HILightKitLightType.Ambient:
                light = new RpLight(RpLightType.AMBIENT);
                break;
            case HILightKitLightType.Directional:
                light = new RpLight(RpLightType.DIRECTIONAL);
                break;
            case HILightKitLightType.Point:
                console.warn("Point light not supported");
                continue;
            case HILightKitLightType.Spot:
                console.warn("Spot light not supported");
                continue;
            default:
                console.warn(`Unknown light type ${type}`);
                continue;
            }

            light.color = color;
            light.frame.matrix = matrix;

            this.lightList.push(light);
        }
    }

    public destroy() {
        for (const light of this.lightList) {
            light.destroy();
        }
    }
}

export class HILightKitManager {
    public lastLightKit: HILightKit | null = null;

    public enable(lkit: HILightKit | null, world: RpWorld) {
        if (lkit === this.lastLightKit) {
            return;
        }

        if (this.lastLightKit) {
            for (const light of this.lastLightKit.lightList) {
                world.removeLight(light);
            }
        }

        this.lastLightKit = lkit;

        if (lkit) {
            for (const light of lkit.lightList) {
                world.addLight(light);
            }
        }
    }
}