import { mat4, vec3 } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';
import { Color, colorNewFromRGBA, colorCopy, colorNewCopy, colorFromRGBA, White, colorScale } from '../Color';
import { nArray } from '../util';

import { SFATexture } from './textures';
import { dataSubarray, readUint16 } from './util';
import { ObjectInstance } from './objects';
import { World } from './world';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { createDirectionalLight, Light } from './WorldLights';
import { SceneUpdateContext } from './render';
import { computeViewMatrix } from '../Camera';

enum EnvfxType {
    Atmosphere = 5,
    Skyscape = 6,
}

class Atmosphere {
    // Note: Textures are not owned by this class.
    public textures: (SFATexture | null)[] = nArray(8, () => null);
    public outdoorAmbientColors: Color[] = nArray(8, () => colorNewFromRGBA(1.0, 1.0, 1.0, 1.0));
}

class Skyscape { // Clouds, mountains, etc.
    public objects: ObjectInstance[] = [];

    public destroy(device: GfxDevice) {
        for (let obj of this.objects)
            obj.destroy(device);
    }
}

const scratchMtx0 = mat4.create();

const MIST_TEXTURE_DIM = 64;

export class EnvfxManager {
    public atmosphere = new Atmosphere();
    public skyscape = new Skyscape();
    private timeOfDay = 4;
    public ambienceIdx: number = 0;
    public enableAmbientLighting = true;
    public enableFog = true;
    
    public skyLight: Light = createDirectionalLight(vec3.fromValues(-1.0, -1.0, -1.0), White);
    public groundLight: Light = createDirectionalLight(vec3.fromValues(1.0, 1.0, 1.0), White);
    // TODO: groundLightFactor seems to be modified by the function for drawing lens flares,
    // when looking at the sun. Otherwise, it is 1.0 by default.
    private groundLightFactor: number = 1.0;

    private envfxactBin: DataView;
    private readonly ENVFX_SIZE = 0x60;

    public mistEnable = true;
    public mistTop = 0.0;
    public mistBottom = 0.0;
    private mistTexture: SFATexture;
    private mistParam?: number;

    private constructor(device: GfxDevice, private world: World) {
        this.mistTexture = SFATexture.create(device, MIST_TEXTURE_DIM, MIST_TEXTURE_DIM);
    }

    public static async create(device: GfxDevice, world: World, dataFetcher: DataFetcher): Promise<EnvfxManager> {
        const self = new EnvfxManager(device, world);

        const pathBase = world.gameInfo.pathBase;
        self.envfxactBin = (await dataFetcher.fetchData(`${pathBase}/ENVFXACT.bin`)).createDataView();
        
        return self;
    }

    public update(device: GfxDevice, sceneCtx: SceneUpdateContext) {
        this.updateAmbience();

        const viewToWorldMtx = scratchMtx0;
        computeViewMatrix(viewToWorldMtx, sceneCtx.viewerInput.camera);
        mat4.invert(viewToWorldMtx, viewToWorldMtx);

        const viewToWorldTY = viewToWorldMtx[4*3+1];

        // XXX: This code causes the mist to "overwhelm" the camera when the camera is immersed.
        //      This doesn't work well with noclip, so I have disabled it.
        // let mistParam;
        // if (viewToWorldTY >= this.mistTop)
        //     mistParam = 0;
        // else if (viewToWorldTY <= this.mistBottom)
        //     mistParam = 64;
        // else
        //     mistParam = 64 * (this.mistTop - viewToWorldTY) / (this.mistTop - this.mistBottom);
        let mistParam = 0; // Behave as if the camera is always above the mist
        this.updateMistTexture(device, mistParam);
    }

    public getMistTexture(): SFATexture {
        return this.mistTexture;
    }

    private updateAmbience() {
        // TODO: change skylight angle depending on time of day
        this.getAmbientColor(this.skyLight.color, this.ambienceIdx);
        if (this.enableAmbientLighting) {
            colorScale(this.groundLight.color, this.skyLight.color, this.groundLightFactor);
            this.groundLight.color.a = 1.0;
        } else
            colorCopy(this.groundLight.color, this.skyLight.color);

        // If lights were already added, this has no effect
        this.world.worldLights.addLight(this.skyLight);
        this.world.worldLights.addLight(this.groundLight);
    }

    public setTimeOfDay(time: number) {
        this.timeOfDay = time;
        this.updateAmbience();
    }

    public setAmbience(idx: number) {
        this.ambienceIdx = idx;
        this.updateAmbience();
    }

    private updateMistTexture(device: GfxDevice, param: number) {
        if (!this.enableFog || !this.mistEnable || this.mistParam === param)
            return;

        const pixels = new Uint8Array(4 * MIST_TEXTURE_DIM * MIST_TEXTURE_DIM);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * MIST_TEXTURE_DIM + x)
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = a;
        }

        for (let y = 0; y < MIST_TEXTURE_DIM; y++) {
            const lineFactor = Math.min((y + param) * 255, 0x3fc0);
            for (let x = 0; x < MIST_TEXTURE_DIM; x++) {
                let I = (lineFactor * x) >> 12;
                plot(x, y, I, I, I, I);
            }
        }

        device.uploadTextureData(this.mistTexture.gfxTexture, 0, [pixels]);
    }

    public getAmbientColor(out: Color, ambienceIdx: number) {
        if (!this.enableAmbientLighting)
            colorCopy(out, White);
        else if (ambienceIdx === 0) {
            colorCopy(out, this.atmosphere.outdoorAmbientColors[this.timeOfDay]);
        } else {
            // TODO: 1 is alternate ambient environment; 2 is blend of ambiences 0 and 1.
            // The game is able to smoothly transition between two environments via this method.
            colorCopy(out, White);
        }
    }

    public getFogColor(dst: Color, ambienceIdx: number) {
        // Just use the ambient color
        // TODO: other logic might be involved depending on configuration
        this.getAmbientColor(dst, ambienceIdx);
    }

    public getAtmosphereTexture(): SFATexture | null {
        return this.atmosphere.textures[this.timeOfDay];
    }

    public loadEnvfx(index: number) {
        const data = dataSubarray(this.envfxactBin, index * this.ENVFX_SIZE, this.ENVFX_SIZE);
        const fields = {
            index: index,
            type: data.getUint8(0x5c),
        };

        if (fields.type === EnvfxType.Atmosphere) {
            const BASE = 0xc38;

            const texIds: number[] = [];
            for (let i = 0; i < 4; i++) {
                texIds.push(readUint16(data, 0x2e, i));
            }
            for (let i = 0; i < 4; i++) {
                texIds.push(readUint16(data, 0x3e, i));
            }

            this.atmosphere.textures = [];
            for (let i = 0; i < 8; i++) {
                const texId = BASE + texIds[i];
                console.log(`loading atmosphere texture ${i}: 0x${texId.toString(16)}`);
                this.atmosphere.textures[i] = this.world.resColl.texFetcher.getTexture(this.world.device, texId, false);
            }

            const outdoorAmbColors: Color[] = [];
            for (let i = 0; i < 4; i++) {
                outdoorAmbColors[i] = colorNewFromRGBA(
                    data.getUint8(0xc + i) / 255,
                    data.getUint8(0x14 + i) / 255,
                    data.getUint8(0x1c + i) / 255,
                    1.0
                );
            }

            this.atmosphere.outdoorAmbientColors[0] = outdoorAmbColors[0];
            this.atmosphere.outdoorAmbientColors[1] = outdoorAmbColors[1];
            this.atmosphere.outdoorAmbientColors[2] = outdoorAmbColors[1];
            this.atmosphere.outdoorAmbientColors[3] = outdoorAmbColors[2];
            this.atmosphere.outdoorAmbientColors[4] = outdoorAmbColors[2];
            this.atmosphere.outdoorAmbientColors[5] = outdoorAmbColors[3];
            this.atmosphere.outdoorAmbientColors[6] = outdoorAmbColors[3];
            this.atmosphere.outdoorAmbientColors[7] = outdoorAmbColors[0];
        } else if (fields.type === EnvfxType.Skyscape) {
            this.skyscape.objects = [];

            const SKY_RING_TYPES = [0, 0x628, 0x762, 0x863];
            const MOUNTAIN_TYPES = [0, 0x62a, 0x85c, 0x861, 0x863];
            const SKYSCAPE_TYPES = [0, 0x627, 0x629, 0x75e, 0x5f5];

            const skyscapeType = data.getUint8(0x5d);
            if (skyscapeType !== 0) {
                const skyscapeTypeId = SKYSCAPE_TYPES[skyscapeType];
                console.log(`loading skyscape object id 0x${skyscapeTypeId.toString(16)}`);
                const objParams = new DataView(new ArrayBuffer(128)); // XXX: doesn't matter, just spawn the object
                const skyscapeObj = this.world.objectMan.createObjectInstance(skyscapeTypeId, objParams, vec3.create());
                this.skyscape.objects.push(skyscapeObj);
            }

            const skyRingType = data.getUint8(0x5b);
            if (skyRingType !== 0) {
                const skyRingTypeId = SKY_RING_TYPES[skyRingType];
                console.log(`loading skyring object id 0x${skyRingTypeId.toString(16)}`);
                const objParams = new DataView(new ArrayBuffer(128)); // XXX: doesn't matter, just spawn the object
                const skyRingObj = this.world.objectMan.createObjectInstance(skyRingTypeId, objParams, vec3.create());
                this.skyscape.objects.push(skyRingObj);
            }

            const mountainType = data.getUint8(0x5a);
            if (mountainType !== 0) {
                const mountainTypeId = MOUNTAIN_TYPES[mountainType];
                console.log(`loading mountain object id 0x${mountainTypeId.toString(16)}`);
                const objParams = new DataView(new ArrayBuffer(128)); // XXX: doesn't matter, just spawn the object
                const mountainObj = this.world.objectMan.createObjectInstance(mountainTypeId, objParams, vec3.create());
                this.skyscape.objects.push(mountainObj);
            }
        } else {
            console.warn(`Don't know how to load envfx type ${fields.type}`);
        }

        return fields;
    }

    public destroy(device: GfxDevice) {
        this.skyscape.destroy(device);
    }
}