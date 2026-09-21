import { SceneRoom } from "./scenes";
import { AABB } from "../Geometry";
import { StageID } from "./stages";
import { ReadonlyVec3 } from "gl-matrix";

// The original portal-based renderer doesn't make sense when you go OOB so
// room overlaps need to be handled the hacky way.
export function updateHarcodedHacks(
    pos: ReadonlyVec3,
    currentRoom: number,
    stageID: StageID,
    rooms: Map<number, SceneRoom>,
): void {
    switch(stageID) {
        case StageID.Chicago:
            updateChicagoHacks(currentRoom, pos, rooms);
            break;

        case StageID.Villa:
            updateVillaHacks(currentRoom, pos, rooms);
            break;

        case StageID.AirForceOne:
            updateAirForceOneHacks(currentRoom, pos, rooms);
            break;

        case StageID.AttackShip:
            updateAttackShipHacks(currentRoom, pos, rooms);
            break;

        case StageID.Extraction:
        case StageID.MisterBlondesRevenge:
        case StageID.Defection:
            updateDDTowerHacks(currentRoom, pos, rooms);
            break;

        case StageID.Defense:
        case StageID.Duel:
            // This place is a mess. Actually implementing portals might be quicker
            // than finding hacky workarounds.
            break;

        case StageID.Infiltration:
        case StageID.Rescue:
        case StageID.Escape:
        case StageID.MaianSOS:
            updateArea51Hacks(currentRoom, pos, rooms);
            break;
    }
}

function updateChicagoHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // Reflections on the street overlap the bar interior.
        const bar = [0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0d, 0x0e, 0x0a, 0x0b, 0x0c];
        const aboveBar = [0x47, 0x36, 0x34, 0x46];
        const underground = pos[1] < -16;
        const inBadBBox = aboveBar.includes(currentRoom);
        const inBar = bar.includes(currentRoom);

        aboveBar.forEach(v => {
            const hide = inBar || (inBadBBox && underground);
            rooms.get(v)!.setVisible(!hide);
        });
    }

    { // Alcove next to the limo overlaps with the backalley
        const alcove = [0x37, 0x10, 0x11, 0x12, 0x13];
        const alley = 0x40;

        rooms.get(alley)!.setVisible(!alcove.includes(currentRoom));
    }
}

function updateDDTowerHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // There's one skybox for the ground floor, one for the others.
        const threshold = -4200;
        const lower = [0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14];
        const upper = [0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c];

        lower.forEach(v => rooms.get(v)!.setVisible(pos[1] <= threshold));
        upper.forEach(v => rooms.get(v)!.setVisible(pos[1] > threshold));
    }

    { // Intro buildings should not be visible unless OOB.
        const intro = [0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7];
        intro.forEach(v => {
            rooms.get(v)!.setVisible(
                intro.includes(currentRoom) || currentRoom === 0x00
            );
        });
    }

    { // Entrypoint floor overlaps top of executive floor.
        const entrypoint = [0x3f, 0x39, 0x45, 0x39, 0x44, 0x3c, 0x3d, 0x3e, 0x3b];
        const executive = [0x63, 0x52, 0x53, 0x54];
        const threshold = -922;

        // Visible from the entire central shaft.
        entrypoint.forEach(v => {
            rooms.get(v)!.setVisible(pos[1] >= threshold || currentRoom === 0x00);
        });

        executive.forEach(v => {
            rooms.get(v)!.setVisible(pos[1] < threshold || currentRoom === 0x00);
        });
    }

    { // Stairs overlap with cheese room.
        const stairs = [0x53, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x52, 0x56, 0x57, 0x67, 0x88];
        const cheese = [0x43, 0x38, 0x3e, 0x5d, 0x09, 0x5e];

        stairs.forEach(v => {
            rooms.get(v)!.setVisible(!cheese.includes(currentRoom));
        });

        cheese.forEach(v => {
            rooms.get(v)!.setVisible(!stairs.includes(currentRoom));
        });
    }
}

function updateArea51Hacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // The two dissection areas overlap, it's also visible from the rooms leading up to them.
        const sectionA = [0x90, 0x91, 0x92, 0x93, 0x94, 0x99, 0x9a, 0x98, 0x96, 0x97, 0x97, 0x95];
        const sectionB = [0x80, 0x81, 0x82, 0x83, 0x84, 0x89, 0x8a, 0x88, 0x86, 0x87, 0x87, 0x85];
        if (currentRoom === 0x00 || !sectionA.concat(sectionB).includes(currentRoom)) {
            sectionA.forEach(v => rooms.get(v)!.setVisible(true));
            sectionB.forEach(v => rooms.get(v)!.setVisible(true));
        } else {
            const sectionAbbox = new AABB();
            const sectionBbbox = new AABB();
            sectionA.forEach(v => sectionAbbox.union(sectionAbbox, rooms.get(v)!.absoluteBBox));
            sectionB.forEach(v => sectionBbbox.union(sectionBbbox, rooms.get(v)!.absoluteBBox));

            const threshold = (sectionAbbox.max[0] + sectionBbbox.min[0]) / 2;
            sectionA.forEach(v => rooms.get(v)!.setVisible(pos[0] < threshold));
            sectionB.forEach(v => rooms.get(v)!.setVisible(pos[0] >= threshold));
        }
    }

    { // Lockers overlap with the hangar.
        const lockers = [0xbe, 0xb3, 0xb4, 0xb5];
        const hangar = [
            0x65, 0x66, 0x67, 0x68, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e,
            0x70, 0x72, 0x73, 0x78, 0xf5, 0xf9,
        ];

        const thresholdX = rooms.get(0xb4)!.absoluteBBox.min[0];
        const thresholdY = rooms.get(0xb4)!.absoluteBBox.min[1];
        const thresholdYmax = rooms.get(0xb4)!.absoluteBBox.max[1];
        const thresholdZ = rooms.get(0xb4)!.absoluteBBox.min[2];
        const isLockerSide =
            pos[0] >= thresholdX &&
            pos[1] >= thresholdY &&
            pos[1] < thresholdYmax &&
            pos[2] >= thresholdZ
        ;

        const inLockers = lockers.includes(currentRoom);
        const inHangar = hangar.includes(currentRoom);

        lockers.forEach(v => {
            const hide = inHangar || (inLockers && !isLockerSide);
            rooms.get(v)!.setVisible(currentRoom === 0x00 || !hide);
        });

        hangar.forEach(v => {
            const hide = inLockers || (inHangar && isLockerSide);
            rooms.get(v)!.setVisible(currentRoom === 0x00 || !hide);
        });
    }
}

function updateAttackShipHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // A fake ship exterior is actually inside the ship.
        const exterior = rooms.get(0x52)!;
        const visibleFrom = [0x4d, 0x51, 0x52, 0x53, 0x54];
        const threshold = 1550; // z

        if (visibleFrom.includes(currentRoom)) {
            rooms.forEach(v => v.setVisible(
                visibleFrom.includes(v.number) ||
                v.pos.z >= threshold
            ));
            rooms.get(0x5b)!.setVisible(currentRoom < 0x51);
            exterior.setVisible(true);
        } else {
            rooms.forEach(v => v.setVisible(true));
            exterior.setVisible(currentRoom === 0x00);
        }
    }
}

function updateAirForceOneHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // Girders from below overlap the piano room.
        const girders = [0x3e, 0x3f];
        const piano = [
            0x1c, 0x1e, 0x1d, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
            0x27, 0x28,
            0x48, // Did you know the room above was connected under the bed?
        ];

        girders.forEach(v => rooms.get(v)!.setVisible(!piano.includes(currentRoom)));
    }
}

function updateVillaHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    // Single floating tri above the map.
    rooms.get(0x58)!.setVisible(false);

    { // Generator and wind turbine rooms overlap.
        const generator = rooms.get(0x72)!;
        const turbine = rooms.get(0x61)!;
        const threshold = -20 + (turbine.absoluteBBox.min[1] + generator.absoluteBBox.max[1]) / 2;

        // Undesirable everywhere above the floor of the turbine room.
        generator.setVisible(pos[1] < threshold);

        // Undesirable when viewed from the generator room and a few rooms leading to it.
        turbine.setVisible(true);
        if (generator.visible) {
            turbine.setVisible(![generator.number, 0x73, 0x74, 0x75].includes(currentRoom));
        }
    }

    { // Minor overlap in kitchen.
        const exterior = rooms.get(0x55)!;
        const inKitchen = [0x10, 0x11, 0x12].includes(currentRoom);
        exterior.setVisible(!inKitchen);
    }
}

