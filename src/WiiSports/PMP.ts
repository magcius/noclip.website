import { mat4, vec3 } from "gl-matrix";
import { assertExists, readString } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";

export class PMP {
    public static parse(buffer: ArrayBufferSlice): PMP {
        const pmp = new PMP();

        const view = buffer.createDataView();
        assertExists(readString(buffer, 0x00, 0x04) === 'PMPF');

        const objectNum = view.getUint16(0x10);
        const objectOffs = view.getUint32(0x40);

        // Read objects
        let objectIdx = objectOffs;
        pmp.objects = [];

        for (let i = 0; i < objectNum; i++) {
            const objectId = view.getUint32(objectIdx + 0x00);
            const translationX = view.getFloat32(objectIdx + 0x08);
            const translationY = view.getFloat32(objectIdx + 0x0C);
            const translationZ = view.getFloat32(objectIdx + 0x10);
            const scaleX = view.getFloat32(objectIdx + 0x14);
            const scaleY = view.getFloat32(objectIdx + 0x18);
            const scaleZ = view.getFloat32(objectIdx + 0x1C);

            const r20 = view.getFloat32(objectIdx + 0x20);
            const r21 = view.getFloat32(objectIdx + 0x24);
            const r22 = view.getFloat32(objectIdx + 0x28);
            const r10 = view.getFloat32(objectIdx + 0x2C);
            const r11 = view.getFloat32(objectIdx + 0x30);
            const r12 = view.getFloat32(objectIdx + 0x34);
            const r00 = view.getFloat32(objectIdx + 0x38);
            const r01 = view.getFloat32(objectIdx + 0x3C);
            const r02 = view.getFloat32(objectIdx + 0x40);

            const modelMatrix = mat4.fromValues(
                scaleX * r00, scaleX * r01, scaleX * r02, 0,
                scaleY * r10, scaleY * r11, scaleY * r12, 0,
                scaleZ * r20, scaleZ * r21, scaleZ * r22, 0,
                translationX, translationY, translationZ, 1,
            );

            pmp.objects.push({ objectId, modelMatrix });
            objectIdx += 0x58;
        }

        // Read routes

        return pmp;
    }

    public objects: PMPObject[];
}

export interface PMPObject {
    objectId: number;
    modelMatrix: mat4;
}
