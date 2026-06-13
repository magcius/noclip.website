
import { readFileSync, writeFileSync } from "fs";
import { SaveState, SaveStateSerializer } from "../SaveState";
import { mat4 } from "gl-matrix";
import path from "path";

const saveStateSerializer = new SaveStateSerializer();

function upgradeSaveState(str: string, key: string): string | null {
    const saveState: SaveState = {
        sceneTime: 0,
        cameraWorldMatrix: mat4.create(),
        extraData: null,
    };

    if (!saveStateSerializer.loadSaveState(saveState, str)) {
        console.warn(`Failed to parse "${key}"`);
        return null;
    }

    return saveStateSerializer.getSaveState(saveState);
}

function main() {
    const saveStatePath = path.join(import.meta.dirname, "../DefaultSaveStates.json");

    const saveStates = JSON.parse(readFileSync(saveStatePath, { encoding: "utf8" }));
    for (const key in saveStates) {
        const oldState = saveStates[key];
        const newState = upgradeSaveState(oldState, key);
        if (newState !== null)
            saveStates[key] = newState;
        else
            delete saveStates[key];
    }

    console.log(`Upgraded all save states in ${saveStatePath}`);
    writeFileSync(saveStatePath, JSON.stringify(saveStates, null, 4), { encoding: "utf8" });
}

main();
