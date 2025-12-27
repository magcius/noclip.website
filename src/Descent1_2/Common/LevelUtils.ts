import { Descent1Level } from "../D1/D1Level";
import { Descent2Level } from "../D2/D2Level";
import { DescentAssetCache } from "./AssetCache";
import { DescentObjectType } from "./LevelObject";

export default function postprocessLevel(
    level: Descent1Level | Descent2Level,
    assetCache: DescentAssetCache,
) {
    // Find boss robot
    const boss = level.objects.find(
        (obj) =>
            obj.type === DescentObjectType.ROBOT &&
            assetCache.getRobotInfo(obj.subtypeId)?.bossFlag > 0,
    );

    if (boss != null) {
        // If boss is present, ghost out reactor. This is what the game does
        for (const object of level.objects) {
            if (object.type === DescentObjectType.CONTROLCEN) {
                object.type = DescentObjectType.GHOST;
            }
        }
    }
}
