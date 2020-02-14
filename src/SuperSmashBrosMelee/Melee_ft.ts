
import ArrayBufferSlice from "../ArrayBufferSlice";
import { HSD_LoadContext, HSD_LoadContext__ResolvePtrAutoSize } from "./SYSDOLPHIN";

// ft = Fighter

export interface ftData {
    subActionTable: ftData_SubAction[];
}

export interface ftData_SubAction {
}

function Melee_ftData_SubAction_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): ftData_SubAction {
    return { };
}

export function Melee_ftData_Load(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): ftData {
    const view = buffer.createDataView();

    const subActionTableBuffer = HSD_LoadContext__ResolvePtrAutoSize(ctx, view.getUint32(0x0C));
    console.log(subActionTableBuffer.byteOffset, subActionTableBuffer.byteLength);
    const subActionTable: ftData_SubAction[] = [];

    return { subActionTable };
}
