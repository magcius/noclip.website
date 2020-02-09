
// Scene Loader for legacy SceneDesc system.

import { LocationLoader, LocationBase, LocationLoadContext, LocationVersion } from './SceneBase2';
import { SceneGroup, SceneDesc, getSceneDescs } from '../SceneBase';
import { atob } from '../Ascii85';
import { assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { SaveManager } from '../SaveManager';
import { SceneGfx } from '../viewer';

export interface SceneDescLocation extends LocationBase {
    loaderKey: 'SceneDescLoader';

    sceneGroup: SceneGroup;
    sceneDesc: SceneDesc;

    /**
     * Raw save state bytes to pass into deserializeSaveState.
     */
    sceneSaveState: ArrayBufferSlice | null;
}

export class SceneDescLoader implements LocationLoader<SceneDescLocation> {
    public loaderKey = 'SceneDescLoader' as const;

    constructor(private groups: SceneGroup[], private saveManager: SaveManager) {
    }

    private setCurrentScene(context: LocationLoadContext, scene: SceneGfx, location: SceneDescLocation): void {
        // Set our new scene. This needs to happen *first*.
        context.setScene(scene);

        // Check if we need extra camera settings.
        if (location.cameraSettings === undefined && scene.createCameraController !== undefined) {
            location.cameraSettings = {
                kind: 'Custom',
                cameraController: scene.createCameraController(),
            };
        }

        // TODO(jstpierre): adjustCameraController

        context.setViewerLocation(location);

        if (scene.createPanels)
            context.legacyUI.setScenePanels(scene.createPanels());

        if (scene.textureHolder !== undefined)
            context.legacyUI.textureViewer.setTextureHolder(scene.textureHolder);
        else
            context.legacyUI.textureViewer.setTextureList([]);

        // Deserialize any save states if necessary.
        const state = location.sceneSaveState;
        if (state !== null && scene.deserializeSaveState)
            scene.deserializeSaveState(state.arrayBuffer, state.byteOffset, state.byteLength);

        // When the state changes, force an update of the location.
        scene.onstatechanged = () => {
            // context.locationChanged();
        };
    }

    public loadLocation(context: LocationLoadContext, location: SceneDescLocation): boolean {
        // If we're just switching save states in the same SceneDesc, then we can simply do that.
        if (context.oldLocation !== null && context.oldLocation.loaderKey === this.loaderKey) {
            const oldLocation = context.oldLocation as SceneDescLocation;
            if (oldLocation.sceneGroup === location.sceneGroup && oldLocation.sceneDesc === location.sceneDesc) {
                // Reuse the old scene, with the new location.
                context.setOldScene();
                context.setViewerLocation(location);
                return true;
            }
        }

        location.sceneDesc.createScene(context.device, context).then((scene) => {
            this.setCurrentScene(context, scene, location);
        });

        return true;
    }

    private getSaveStateSlotKey(location: SceneDescLocation, saveStateSlot: number): string {
        const key = `${location.sceneGroup.id}/${location.sceneDesc.id}`;
        return this.saveManager.getSaveStateSlotKey(key, saveStateSlot);
    }

    private loadState(location: SceneDescLocation, saveStateSlot: number): string | null {
        const slotKey = this.getSaveStateSlotKey(location, saveStateSlot);
        return this.saveManager.loadState(slotKey);
    }

    private getScreenshotURL(sceneGroupId: string, sceneDescId: string, saveStateSlot: number): string | undefined {
        if (saveStateSlot < 0)
            return undefined;
    
        // TODO(jstpierre): Take screenshots
        return undefined;
    }

    public getLocationFromSceneDesc(sceneGroup: SceneGroup, sceneDesc: SceneDesc, saveStateSlot: number = 1, saveState: string | null = null): SceneDescLocation {
        const location: SceneDescLocation = {
            version: LocationVersion.V0,
            loaderKey: this.loaderKey,
            title: sceneDesc.name,
            fullTitle: `${sceneGroup.name} - ${sceneDesc.name}`,
            screenshotURL: this.getScreenshotURL(sceneGroup.id, sceneDesc.id, saveStateSlot),

            sceneGroup,
            sceneDesc,
            sceneSaveState: null,
        };

        if (saveState === null && saveStateSlot >= 0)
            saveState = this.loadState(location, saveStateSlot);

        if (saveState !== null) {
            // Version 2 starts with ZNCA8, which is Ascii85 for 'NC\0\0'
            if (saveState.startsWith('ZNCA8') && saveState.endsWith('='))
                loadSceneSaveStateVersion2(location, saveState.slice(5, -1));

            // Version 3 starts with 'A' and has no '=' at the end.
            if (saveState.startsWith('A'))
                loadSceneSaveStateVersion3(location, saveState.slice(1));

            if (saveState.startsWith('ShareData='))
                loadSceneSaveStateVersion3(location, saveState.slice(10));
        }

        return location;
    }

    public getLocationFromIDs(sceneGroupId: string, sceneDescId: string, saveStateSlot: number = -1, saveState: string | null = null): SceneDescLocation | null {
        const sceneGroup = this.groups.find((g) => typeof g !== 'string' && g.id === sceneGroupId) as SceneGroup;
        if (!sceneGroup)
            return null;

        if (sceneGroup.sceneIdMap !== undefined && sceneGroup.sceneIdMap.has(sceneDescId))
            sceneDescId = sceneGroup.sceneIdMap.get(sceneDescId)!;

        const sceneDesc = getSceneDescs(sceneGroup).find((d) => d.id === sceneDescId);
        if (!sceneDesc)
            return null;

        return this.getLocationFromSceneDesc(sceneGroup, sceneDesc, saveStateSlot, saveState);
    }

    public getLocationFromHash(id: string): SceneDescLocation | null {
        const [sceneGroupId, ...sceneRest] = id.split('/');
        let sceneId = decodeURIComponent(sceneRest.join('/'));

        let sceneDescId: string = '', saveState: string | null = '';
        const firstSemicolon = sceneId.indexOf(';');
        if (firstSemicolon >= 0) {
            sceneDescId = sceneId.slice(0, firstSemicolon);
            saveState = sceneId.slice(firstSemicolon + 1);
        } else {
            sceneDescId = sceneId;
        }

        let saveStateSlot = -1;

        // If we have no save state, use the default one...
        if (saveState === '') {
            saveStateSlot = 1;
            saveState = null;
        }

        return this.getLocationFromIDs(sceneGroupId, sceneDescId, saveStateSlot, saveState);
    }

    public getLocationFromSaveState(existingLocation: LocationBase, saveStateSlot: number): SceneDescLocation | null {
        if (existingLocation.loaderKey !== this.loaderKey)
            return null;

        const location = existingLocation as SceneDescLocation;
        const saveState = this.loadState(location, saveStateSlot);
        return this.getLocationFromSceneDesc(location.sceneGroup, location.sceneDesc, saveStateSlot, saveState);
    }

    public getSceneGroupFromLocation(location: LocationBase): SceneGroup {
        assert(location.loaderKey === this.loaderKey);
        return (location as SceneDescLocation).sceneGroup;
    }

    public getSceneDescFromLocation(location: LocationBase): SceneDesc {
        assert(location.loaderKey === this.loaderKey);
        return (location as SceneDescLocation).sceneDesc;
    }
}

const saveStateTmp = new Uint8Array(512);
const saveStateView = new DataView(saveStateTmp.buffer);

function deserializeCameraSettings(location: SceneDescLocation, view: DataView, byteOffs: number): number {
    location.cameraSettings = { kind: 'WASD', worldMatrix: [] };
    const m = location.cameraSettings.worldMatrix;
    m[0]  = view.getFloat32(byteOffs + 0x00, true);
    m[1]  = view.getFloat32(byteOffs + 0x04, true);
    m[2]  = view.getFloat32(byteOffs + 0x08, true);
    m[3]  = view.getFloat32(byteOffs + 0x0C, true);
    m[4]  = view.getFloat32(byteOffs + 0x10, true);
    m[5]  = view.getFloat32(byteOffs + 0x14, true);
    m[6]  = view.getFloat32(byteOffs + 0x18, true);
    m[7]  = view.getFloat32(byteOffs + 0x1C, true);
    m[8]  = view.getFloat32(byteOffs + 0x20, true);
    m[9]  = view.getFloat32(byteOffs + 0x24, true);
    m[10] = view.getFloat32(byteOffs + 0x28, true);
    m[11] = view.getFloat32(byteOffs + 0x2C, true);
    return 0x04*4*3;
}

function loadSceneSaveStateVersion2(location: SceneDescLocation, state: string): void {
    const byteLength = atob(saveStateTmp, 0, state);

    let byteOffs = 0;
    location.time = saveStateView.getFloat32(byteOffs + 0x00, true);
    byteOffs += 0x04;
    byteOffs += deserializeCameraSettings(location, saveStateView, byteOffs);

    location.sceneSaveState = new ArrayBufferSlice(saveStateTmp.buffer, byteOffs, byteLength - byteOffs);
}

function loadSceneSaveStateVersion3(location: SceneDescLocation, state: string): void {
    const byteLength = atob(saveStateTmp, 0, state);

    let byteOffs = 0;
    const optionsBits: number = saveStateView.getUint8(byteOffs + 0x00);
    assert(optionsBits === 0);
    byteOffs++;

    byteOffs += deserializeCameraSettings(location, saveStateView, byteOffs);
    location.sceneSaveState = new ArrayBufferSlice(saveStateTmp.buffer, byteOffs, byteLength - byteOffs);
}
