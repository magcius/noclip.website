
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DataFetcher } from "../DataFetcher";
import { DataShare } from "../DataShare";
import { Destroyable } from "../SceneBase";
import { SceneGfxBase } from "../viewer";
import { UI } from "../ui";
import { CameraController } from "../Camera";

// A Location is a combination of what was a "scene desc" and a "save state" was in V1.
//
// Basically, it loosely and valuely identifies a "loaded scene"

export const enum LocationVersion {
    V0 = 'V0',
}

interface LocationBaseV0 {
    /**
     * The version of this structure.
     */
    version: LocationVersion.V0;

    /**
     * Which LocationLoader to use when loading this scene? Note that this is not guaranteed
     * to tell you anything game-specific.
     */
    loaderKey: string;

    // TODO(jstpierre): This will change when we add proper grouping and filtering information.
    /**
     * Human-readable title for the location. Should not include any game-specific info.
     */
    title: string;

    /**
     * Full human-readable title for the location. Include the game here too.
     */
    fullTitle: string;

    // Legacy grouping & sorting information, for the old UI, until we decide what we want the
    // navigation to look like for the new UI.
    tag: string | null;
    groupName: string;
    groupTag: string | null;

    /**
     * Camera settings. These are dependent on the camera controller used to
     * power the scene.
     */
    cameraSettings?: LocationCameraSettings;

    /**
     * The current scene time.
     */
    time?: number;

    /**
     * Screenshot URL, if any.
     */
    screenshotURL?: string;

    /**
     * Different loaders can extend this with extra details.
     */
}

export type LocationBase = LocationBaseV0;

export interface LocationCameraSettingsWASD {
    kind: 'WASD';

    /**
     * There's probably a better way to store this... Currently a 4x3 matrix array.
     */
    worldMatrix: number[];
}

export interface LocationCameraSettingsCustom {
    kind: 'Custom';

    /**
     * Allow providing a custom camera controller. This can't be serialized...
     */
    cameraController: CameraController;
}

export type LocationCameraSettings = LocationCameraSettingsWASD | LocationCameraSettingsCustom;

export interface LocationLoadContext {
    /**
     * The location currently being displayed. Use this as a possible optimization, together
     * with {@method setOldScene} as a way of preventing a full scene load.
     */
    oldLocation: LocationBase | null;

    device: GfxDevice;

    /**
     * The DataFetcher is the primary way to make external requests to load assets.
     */
    dataFetcher: DataFetcher;

    /**
     * The DataShare is a way of sharing data between different scenes, to prevent
     * extra loading.
     */
    dataShare: DataShare;

    /**
     * UI shenanigans. These might be removed at some point.
     */
    uiContainer: HTMLElement;
    legacyUI: UI;

    // TODO(jstpierre): Remove this in favor of the new loading approach?
    destroyablePool: Destroyable[];

    /**
     * This callback will be called when the load is aborted. It will *not* be called
     * after the scene is finished loading.
     *
     * TODO(jstpierre): Should it?
     */
    onabort: ((context: this) => void) | null;

    /**
     * Set the resulting scene. This signifies the end of the main loading stage, after which
     * any previous scenes may now be destroyed. Loading may continue afterwards if required.
     *
     * This *must* be called or memory leaks might happen. If you wish to reuse the currently
     * displayed scene, pass {@member oldScene.scene}.
     */
    setScene(s: SceneGfxBase): void;

    /**
     * Use the old scene. This is a special case that completes the load process on the currently
     * displayed scene.
     */
    setOldScene(): void;

    /**
     * Configures the viewer to use the location settings. Currently, that includes things
     * like scene time, camera settings, and so on. In most cases, this should be passed directly
     * from the location, but this gives the loader an opportunity to overwrite some of the
     * settings if desired.
     */
    setViewerLocation(location: LocationBase): void;
}

export interface LocationLoader<T extends LocationBase = LocationBase> {
    providerKey: string;

    /**
     * Requests a load of a location, using the given context and location.
     *
     * Return false if you cannot load this location, for whatever reason.
     *
     * Use {@param context} to signif
     */
    loadLocation(context: LocationLoadContext, location: T): boolean;
}
