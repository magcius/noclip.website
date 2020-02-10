
//@ts-ignore
import * as defaultSaveStateData from './DefaultSaveStates.json';

export type SettingCallback = (saveManager: SaveManager, key: string) => void;
export type SaveStateCallback = (saveManager: SaveManager) => void;

export const enum SaveStateLocation {
    LocalStorage,
    SessionStorage,
    Defaults,
    None,
}

interface SettingListener {
    callback: SettingCallback;
    key: string;
}

export class SaveManager {
    private settingListeners: SettingListener[] = [];
    private saveStateListeners: SaveStateCallback[] = [];

    constructor() {
        this.cleanOldKeys();
    }

    private cleanOldKeys(): void {
        // Clean up old stuff.
        window.localStorage.removeItem('CameraStates');
        window.localStorage.removeItem('SaveStates');
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const key = window.localStorage.key(i)!;
            if (key.startsWith('SaveState_') && key.endsWith('/0'))
                window.localStorage.removeItem(key);
        }
    }

    private getSettingKey(key: string) {
        return `Setting_${key}`;
    }

    public loadSetting<T>(key: string, defaultValue: T): T {
        const valueStr = window.localStorage.getItem(this.getSettingKey(key));
        if (valueStr !== null)
            return JSON.parse(valueStr);
        else
            return defaultValue;
    }

    public saveSetting<T>(key: string, value: T, force: boolean = false): void {
        if (force || (this.loadSetting<T | null>(key, null) === value))
            return;
        window.localStorage.setItem(this.getSettingKey(key), JSON.stringify(value));
        for (let i = 0; i < this.settingListeners.length; i++)
            if (this.settingListeners[i].key === key)
                this.settingListeners[i].callback(this, key);
    }

    public addSettingListener(key: string, callback: SettingCallback, triggerNow: boolean = true): void {
        this.settingListeners.push({ callback, key });
        if (triggerNow)
            callback(this, key);
    }

    public getSaveStateSlotKey(sceneDescId: string, slotIndex: number): string {
        return `SaveState_${sceneDescId}/${slotIndex}`;
    }

    public getCurrentSceneDescId(): string | null {
        return window.sessionStorage.getItem('CurrentSceneDescId') || null;
    }

    public setCurrentSceneDescId(id: string) {
        window.sessionStorage.setItem('CurrentSceneDescId', id);
    }

    public addSaveStateListener(callback: SaveStateCallback): void {
        this.saveStateListeners.push(callback);
    }

    private callSaveStateListeners(): void {
        for (let i = 0; i < this.saveStateListeners.length; i++)
            this.saveStateListeners[i](this);
    }
 
    public saveTemporaryState(key: string, serializedState: string): void {
        // Clean up old stuff.
        window.localStorage.removeItem(key);
        window.sessionStorage.setItem(key, serializedState);
    }

    public saveState(key: string, serializedState: string): void {
        window.localStorage.setItem(key, serializedState);
        this.callSaveStateListeners();
    }

    public deleteState(key: string): void {
        window.localStorage.removeItem(key);
        this.callSaveStateListeners();
    }

    public hasStateInLocation(key: string, location: SaveStateLocation): boolean {
        if (location === SaveStateLocation.LocalStorage)
            return key in window.localStorage;

        if (location === SaveStateLocation.SessionStorage)
            return key in window.sessionStorage;

        if (location === SaveStateLocation.Defaults)
            return key in defaultSaveStateData;

        return false;
    }

    public loadStateFromLocation(key: string, location: SaveStateLocation): string | null {
        if (location === SaveStateLocation.LocalStorage)
            return window.localStorage.getItem(key);

        if (location === SaveStateLocation.SessionStorage)
            return window.sessionStorage.getItem(key);

        if (location === SaveStateLocation.Defaults)
            return defaultSaveStateData[key] || null;

        return null;
    }

    public loadState(key: string): string | null {
        let state: string | null = null;

        state = window.localStorage.getItem(key);
        if (state)
            return state;

        // Look up in temporary storage?
        state = window.sessionStorage.getItem(key);
        if (state)
            return state;

        // Look up in default save state data.
        state = defaultSaveStateData[key];
        if (state)
            return state;

        return null;
    }

    public export(): string {
        return JSON.stringify(Object.assign({}, window.localStorage), null, 4);
    }
}

export const GlobalSaveManager = new SaveManager();
