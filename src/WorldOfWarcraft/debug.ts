import { mat4, vec3 } from "gl-matrix";
import { drawWorldSpaceLine, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { WmoData, WmoDefinition } from "./data.js";
import { WdtScene } from "./scenes.js";
import { Color } from "../Color.js";

function getClipFromWorldMatrix(): mat4 {
    return (window.main.scene as WdtScene).mainView.clipFromWorldMatrix;
}

export function drawDebugPortals(wmo: WmoData, def: WmoDefinition, groupId: number, color?: Color, offsY?: number) {
    const portalVerts = wmo.wmo.dbg_get_portal_verts(groupId);
    let i = 0;
    while (i < portalVerts.length) {
        const len = portalVerts[i++];
        const verts = portalVerts.slice(i, i + len * 3);
        i += len * 3;
        for (let j = 0; j < len; j++) {
            const v0: vec3 = verts.slice(j * 3, (j + 1) * 3);
            const bStart = (j + 1) % len;
            const v1: vec3 = verts.slice(bStart * 3, (bStart + 1) * 3);
            vec3.transformMat4(v0, v0, def.modelMatrix);
            vec3.transformMat4(v1, v1, def.modelMatrix);
            drawWorldSpaceText(
                getDebugOverlayCanvas2D(),
                getClipFromWorldMatrix(),
                v0,
                `${j} (${groupId})`,
                offsY,
                color,
            );
            drawWorldSpaceLine(
                getDebugOverlayCanvas2D(),
                getClipFromWorldMatrix(),
                v0,
                v1,
                color,
            );
        }
    }
}
