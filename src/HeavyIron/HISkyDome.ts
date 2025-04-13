import { HIBaseFlags } from "./HIBase.js";
import { HIEnt } from "./HIEnt.js";
import { HIGame, HIScene } from "./HIScene.js";
import { RwEngine } from "./rw/rwcore.js";

interface SkyDomeInfo {
    ent: HIEnt;
    sortorder: number;
    lockY: boolean;
}

export class HISkyDomeManager {
    private skyList: SkyDomeInfo[] = [];
    public disableHack = false;

    public addEntity(ent: HIEnt, sortorder: number, lockY: boolean) {
        if (this.skyList.find(v => v.ent === ent)) return;

        this.skyList.push({ ent, sortorder, lockY });
        this.skyList.sort((a, b) => a.sortorder - b.sortorder);

        ent.render = () => {};
        ent.baseFlags &= ~HIBaseFlags.ShadowRec;
    }

    public render(scene: HIScene, rw: RwEngine) {
        if (this.disableHack) return;

        const oldFarClip = rw.camera.farPlane;

        if (scene.game >= HIGame.TSSM) {
            rw.camera.end(rw);
            rw.camera.farPlane = 10000.0;
            rw.camera.begin(rw);
        }

        for (const sky of this.skyList) {
            if (!sky.ent.model) continue;
            if (!sky.ent.isVisible()) continue;

            sky.ent.model.mat[12] = rw.camera.worldMatrix[12];
            sky.ent.model.mat[14] = rw.camera.worldMatrix[14];
            if (sky.lockY) {
                sky.ent.model.mat[13] = rw.camera.worldMatrix[13];
            }

            scene.modelManager.render(sky.ent.model.data, sky.ent.model.mat, rw);
        }

        if (scene.game >= HIGame.TSSM) {
            rw.camera.end(rw);
            rw.camera.farPlane = oldFarClip;
            rw.camera.begin(rw);
        }
    }
}