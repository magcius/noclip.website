
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DataFetcher } from "../DataFetcher";
import { DataShare } from "../DataShare";
import { Destroyable } from "../SceneBase";
import { SceneGfx, SceneGfxBase } from "../viewer";
import { UI } from "../ui";
import { CameraController } from "../Camera";

// A Location is a combination of what was a "scene desc" and a "save state" in V1.

export const enum LocationVersion {
    V0 = 'V0',
}

export interface LocationBase {
    /**
     * The version of this structure.
     */
    version: LocationVersion;

    /**
     * The engine to use to load this location. In most cases, this will be
     * some identifier for the game. Different engines can register themselves.
     */
    engine: string;

    // TODO(jstpierre): Grouping and filtering information.
    // This will change when we add these.
    /**
     * Human-readable title for the location. Should not include any game-specific info.
     */
    title: string;

    /**
     * Full human-readable title for the location. Include the game here too.
     */
    fullTitle: string;

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
     * Engines can extend this with extra details.
     */
}

export interface LocationCameraSettingsWASD {
    kind: 'WASD';

    /**
     * There's probably a better way to store this...
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
    // Possible optimization if the existing location is the same. Use sparingly.
    oldLocation: LocationBase | null;

    device: GfxDevice;
    dataFetcher: DataFetcher;
    dataShare: DataShare;
    // TODO(jstpierre): Remove this
    uiContainer: HTMLElement;
    // TODO(jstpierre): Remove this
    legacyUI: UI;
    // TODO(jstpierre): Remove this in favor of the new loading approach?
    destroyablePool: Destroyable[];

    /**
     * LocationLoaders should fill this in on the context to destroy any assets
     * they've created.
     */
    onabort: ((context: this) => void) | null;

    /**
     * Set the resulting scene. Does not have to be called.
     */
    setScene(s: SceneGfxBase): void;

    /**
     * Configures the viewer to use the location settings. Currently, that includes things
     * like scene time, camera settings, and so on. Normally, this would be passed straight
     * from the location, but this gives the loader an opportunity to overwrite some of the
     * settings.
     */
    setViewerLocation(location: LocationBase): void;

    /**
     * Call this to signal that the location has changed.
     */
    locationChanged(): void;
}

export interface LocationLoader<T extends LocationBase = LocationBase> {
    loadLocation(context: LocationLoadContext, location: T): boolean;
}
