import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { DataFetcher } from "../DataFetcher.js";
import { computeModelMatrixSRT } from "../MathHelpers.js";
import { GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { decodeString } from "../util.js";
import * as BUNDLE from "./bundle.js";
import * as CHR from "./chr.js";
import * as IMG from "./img.js";
import * as MDS from "./mds.js";

class Piece {
    public name: string;
    public mdsName: string;
    public position: vec3;
    public rotation: vec3;
    public scale: vec3;
    public timeFlags: number;
}

class FuncData {
    public name: string;
    public type: string;
    public flags: number[] = [];
    public data: number[] = [];
    public position: vec3;
    public rotation: vec3;
    public scale: vec3;
    public timeflags: number;
}

class Parts {
    public name: string;
    public pieces: Piece[] = [];
    public funcs: FuncData[] = [];
}

class MapParts {
    public name: string;
    public partsName: string;
    public partsPos: vec3;
    public partsRot: vec3;
    public partsScale: vec3;
    public flags: number;
}

export class LightSet {
    public id: number;
    public bgcolor: Color;
    public bgcolor2: Color;
}

interface MapInfo {
    imgFileName: string;
    pcpFileName: string;
    parts: Map<string, Parts>;
    mapParts: MapParts[];
    lightSets: LightSet[];
    lightSetCount: number;
}

class SKY {
    public img: IMG.IMG | null = null;
    public mds: MDS.MDS | null = null;
    public bmds: MDS.MDS | null = null;
    public sunMds: MDS.MDS | null = null
    public bgMds: MDS.MDS | null = null;
    public textureDataMap = new Map<string, IMG.TextureData>();
}

function getTimeFlags(start: number, end: number): number {
    if (start === 0) {
        if (end !== 0 && end !== 24) //for 24, seen in purgatory island
            throw "time flags with null start/end mismatch";
        return 0xF;//set all flags to true
    }
    if (end < start)
        end += 24;
    const a = (start < 7 && 7 < end) ? 1 : 0;
    const b = (start < 10 && 10 < end) ? 1 : 0;
    const c = (start < 18 && 18 < end) ? 1 : 0;
    const d = (start < 21 && 21 < end) ? 1 : 0;
    return (a << 0 | b << 1 | c << 2 | d << 3);
}

export function parseSkyCfg(cache: GfxRenderCache, buffer: ArrayBufferSlice): SKY[] {
    const device = cache.device;
    const skies: SKY[] = [];
    const rNameToInfo = BUNDLE.parseBundle(buffer);
    if (!rNameToInfo.has("info.cfg"))
        throw "Sky bundle has no cfg file";
    const lines = decodeString(buffer, 0, buffer.byteLength, "sjis").split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.split(" ").length)
            continue;
        const keyword = line.split(" ")[0];
        if (keyword === "SKY_IMG") {
            skies.push(new SKY());
            const time = parseInt(line.split(" ")[1][0]);
            const imgFileName = line.split("\"")[1];
            if (rNameToInfo.has(imgFileName)) {
                skies[time].img = IMG.parse(buffer.slice(rNameToInfo.get(imgFileName)!.offset, rNameToInfo.get(imgFileName)!.offset + rNameToInfo.get(imgFileName)!.size), imgFileName);
                for (let i = 0; i < skies[time].img!.textures.length; i++) {
                    const texture = skies[time].img!.textures[i];
                    if(skies[time].textureDataMap.has(texture.name))
                        continue;
                    const gfxTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
                    const gfxSampler = cache.createSampler({
                        magFilter: GfxTexFilterMode.Bilinear,
                        minFilter: GfxTexFilterMode.Bilinear,
                        mipFilter: GfxMipFilterMode.Nearest,
                        maxLOD: 0,
                        minLOD: 0,
                        wrapS: GfxWrapMode.Repeat,
                        wrapT: GfxWrapMode.Repeat,
                    });
                    device.setResourceName(gfxTex, texture.name);
                    device.uploadTextureData(gfxTex, 0, [texture.pixels]);

                    skies[time].textureDataMap.set(skies[time].img!.textures[i].name, { texture: gfxTex, sampler: gfxSampler });
                }
            }
        }
        else if (keyword === "SKY_MDS") {
            const time = parseInt(line.split(" ")[1][0]);
            const mdsFileName = line.split("\"")[1];
            if (rNameToInfo.has(mdsFileName)) {
                skies[time].mds = MDS.parse(buffer.slice(rNameToInfo.get(mdsFileName)!.offset, rNameToInfo.get(mdsFileName)!.offset + rNameToInfo.get(mdsFileName)!.size), mdsFileName, skies[time].textureDataMap);
                skies[time].mds!.rotJointIdToAngVels.set(0, parseFloat(line.split(",")[2].split(";")[0]));
            }
        }
        else if (keyword === "SUN_MDS") {
            const time = parseInt(line.split(" ")[1][0]);
            const sunFileName = line.split("\"")[1];
            if (rNameToInfo.has(sunFileName))
                skies[time].sunMds = MDS.parse(buffer.slice(rNameToInfo.get(sunFileName)!.offset, rNameToInfo.get(sunFileName)!.offset + rNameToInfo.get(sunFileName)!.size), sunFileName, skies[time].textureDataMap);
        }
        else if (keyword === "SKYB_MDS") {
            const time = parseInt(line.split(" ")[1][0]);
            const mdsFileName = line.split("\"")[1];
            if (rNameToInfo.has(mdsFileName)) {
                skies[time].bmds = MDS.parse(buffer.slice(rNameToInfo.get(mdsFileName)!.offset, rNameToInfo.get(mdsFileName)!.offset + rNameToInfo.get(mdsFileName)!.size), mdsFileName, skies[time].textureDataMap);
            }
        }

        else if (keyword === "SKY_ANIME") {
            const time = parseInt(line.split(" ")[1][0]);
            const jointName = line.split("\"")[1];
            const angVel = parseFloat(line.split(",")[2].split(";")[0]);
            if (skies[time].mds === null)
                throw "sky mds was not registered but anim info was found";
            else {
                for (let k = 0; k < skies[time].mds!.joints.length; k++) {
                    if (skies[time].mds!.joints[k].name === jointName)
                        skies[time].mds!.rotJointIdToAngVels.set(k, angVel);
                }
            }
        }
    }
    return skies;
}

export class MAP {
    public name: string;
    public mapInfo: MapInfo;
    public textureDataMap = new Map<string, IMG.TextureData>();
    public modelMap: Map<string, MDS.MDS>;
    public modelNames: string[] = [];
    public modelTransforms: mat4[];
    public modelPeriodFlags: (number | null)[];
    public fireEffectIndices = new Map<number, boolean>();
    public chrs: CHR.CHR[] = [];
    public chrTransforms: mat4[] = [];
    public chrDayPeriodFlags: number[] = [];
    public skies: SKY[] = [];
    public img: IMG.IMG | null = null;
    public fireImg: IMG.IMG | null = null;

}

function parseCfg(buffer: ArrayBufferSlice): MapInfo {
    const lines = decodeString(buffer, 0, buffer.byteLength, "sjis").split('\n');
    let imgFileName = "";
    let bHasImgFileNameBeenSet = false; //temp workaround for several img packages.
    let pcpFileName = "";
    const parts = new Map<string, Parts>;
    const mapParts: MapParts[] = [];
    const lightSets: LightSet[] = [];
    let lightSetCount: number = 0;

    let bMapParts = false;
    let bParts = false;
    let bPiece = false;
    let bFuncData = false;
    let bLightGroup = false;
    let bLightSet = false;
    let currentPartName = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.split(" ").length)
            continue;
        const keyword = line.split(" ")[0];

        if (bParts) {
            if (keyword === "PARTS_END;") {
                currentPartName = "";
                bParts = false;
            }
            else if (bPiece) {
                if (keyword === "\tPIECE_END;") {
                    bPiece = false;
                }
                else {
                    if (keyword === "\t\tPIECE_NAME")
                        parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].name = line.split(" ")[1].slice(1, -2);
                    else if (keyword === "\t\tPIECE_POS")
                        parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].position = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
                    else if (keyword === "\t\tPIECE_ROT")
                        parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].rotation = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
                    else if (keyword === "\t\tPIECE_SCALE")
                        parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].scale = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
                    else if (keyword === "\t\tPIECE_TIME")
                        parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].timeFlags = getTimeFlags(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1].slice(0, -1)));
                }
                continue;
            }
            else if (bFuncData) {
                if (keyword === "\t\tFUNC_DATA_END;") {
                    bFuncData = false;
                }
                else {
                    if (keyword === "\t\t\tFUNC_NAME")
                        parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].name = line.split(" ")[1].slice(1, -2);
                    else if (keyword === "\t\t\tFUNC_POS") {
                        let data = line.split(" ")[1].split(",");
                        parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].position = vec3.fromValues(parseFloat(data[0]), parseFloat(data[1]), parseFloat(data[2]));
                        data = line.split(" ")[2].split(",");
                        parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].rotation = vec3.fromValues(parseFloat(data[0]), parseFloat(data[1]), parseFloat(data[2]));
                        data = line.split(" ")[3].split(",");
                        parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].scale = vec3.fromValues(parseFloat(data[0]), parseFloat(data[1]), parseFloat(data[2].slice(0, -1)));
                    }
                    else if (keyword === "\t\t\tFUNC_FLAG") {
                        let data = line.split(" ")[3].split(",");
                        parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].timeflags = getTimeFlags(parseFloat(data[0]), parseFloat(data[1].slice(0, -1)));
                    }
                }
                continue;
            }
            else if (keyword === "\tPIECE") {
                bPiece = true;
                parts.get(currentPartName)!.pieces.push(new Piece());
                parts.get(currentPartName)!.pieces[parts.get(currentPartName)!.pieces.length - 1].mdsName = line.split(" ")[1].split(",")[0].slice(1, -1);
            }
            else if (keyword === "\t\tFUNC_DATA") {
                bFuncData = true;
                parts.get(currentPartName)!.funcs.push(new FuncData());
                parts.get(currentPartName)!.funcs[parts.get(currentPartName)!.funcs.length - 1].type = line.split(" ")[1].split(",")[0].slice(1, -1);
            }
            continue;
        }
        else if (bMapParts) {
            if (keyword === "MAP_PARTS_END;") {
                bMapParts = false;
            }
            else {
                if (keyword === "\tPARTS_NAME")
                    mapParts[mapParts.length - 1].partsName = line.split(" ")[1].slice(1, -2);
                else if (keyword === "\tPARTS_POS")
                    mapParts[mapParts.length - 1].partsPos = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
                else if (keyword === "\tPARTS_ROT")
                    mapParts[mapParts.length - 1].partsRot = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
                else if (keyword === "\tPARTS_SCALE")
                    mapParts[mapParts.length - 1].partsScale = vec3.fromValues(parseFloat(line.split(" ")[1].split(",")[0]), parseFloat(line.split(" ")[1].split(",")[1]), parseFloat(line.split(" ")[1].split(",")[2].slice(0, -1)));
            }
            continue;
        }

        else if (bLightGroup) {
            if (keyword === "LIGHT_GROUP_END;") {
                bLightGroup = false;
            }
            else if (bLightSet) {
                if (line.startsWith(" LIGHT_SET_END;")) {
                    bLightSet = false;
                }
                else {
                    if (line.startsWith("  BGCOLOR2")) {
                        const data = line.split(" ")[3].split(",");
                        lightSets[lightSets.length - 1].bgcolor2 = colorNewFromRGBA(parseFloat(data[0]) / 255, parseFloat(data[1]) / 255, parseFloat(data[2].slice(0, -1)) / 255);
                    }
                    else if (line.startsWith("  BGCOLOR")) {
                        const data = line.split(" ")[3].split(",");
                        lightSets[lightSets.length - 1].bgcolor = colorNewFromRGBA(parseFloat(data[0]) / 255, parseFloat(data[1]) / 255, parseFloat(data[2].slice(0, -1)) / 255);
                    }

                }
                continue;
            }
            else if (line.startsWith(" LIGHT_SET")) {
                bLightSet = true;
                lightSets.push(new LightSet());
                lightSets[lightSets.length - 1].id = parseInt(line.split(" ")[2].split(";")[0]);
            }
            continue;
        }

        if (keyword === "IMG" && !bHasImgFileNameBeenSet) {
            imgFileName = line.split(" ")[1].slice(1, -2);
            bHasImgFileNameBeenSet = true;
        }
        else if (keyword === "PCP") {
            pcpFileName = line.split(" ")[1].slice(1, -2);
        }
        else if (keyword === "PARTS") {
            bParts = true;
            currentPartName = line.split(" ")[1].split(",")[0].slice(1, -2);
            parts.set(currentPartName, new Parts());
        }
        else if (keyword === "MAP_PARTS") {
            bMapParts = true;
            mapParts.push(new MapParts());
            mapParts[mapParts.length - 1].name = line.split(" ")[1].split(",")[0].slice(1, -1);
            mapParts[mapParts.length - 1].flags = parseInt(line.split(",")[1].slice(0, 1));
        }
        else if (keyword === "TIME_LIGHT_NUM") {
            lightSetCount = parseInt(line.split(" ")[1].split(";")[0]);
        }
        else if (keyword === "LIGHT_GROUP") {
            bLightGroup = true;
        }
    }
    return { pcpFileName, imgFileName, parts, mapParts, lightSets, lightSetCount };
}

export async function parse(cache: GfxRenderCache, buffer: ArrayBufferSlice, dataFetcher: DataFetcher, mapName: string, basePath: string): Promise<MAP> {
    const device = cache.device;
    const map = new MAP();
    map.name = mapName;
    map.mapInfo = parseCfg(buffer);

    const [ipkBuffer, mpkBuffer, skyBuffer] = await Promise.all([
        dataFetcher.fetchData(`${basePath}.ipk`),
        dataFetcher.fetchData(`${basePath}.mpk`),
        dataFetcher.fetchData(`${basePath}.sky`, { allow404: true }),
    ]);

    const ipkInfo = BUNDLE.parseBundle(ipkBuffer);
    if (!ipkInfo.has(map.mapInfo.imgFileName))
        throw "img file not found";
    map.img = IMG.parse(ipkBuffer.slice(ipkInfo.get(map.mapInfo.imgFileName)!.offset, ipkInfo.get(map.mapInfo.imgFileName)!.offset + ipkInfo.get(map.mapInfo.imgFileName)!.size), map.mapInfo.imgFileName);
    for (let i = 0; i < map.img.textures.length; i++) {
        const texture = map.img.textures[i];
        if(map.textureDataMap.has(texture.name))
            continue;
        const gfxTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
        const gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Bilinear,
            minFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            maxLOD: 0,
            minLOD: 0,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
        device.setResourceName(gfxTex, texture.name);
        device.uploadTextureData(gfxTex, 0, [texture.pixels]);
        map.textureDataMap.set(map.img.textures[i].name, { texture: gfxTex, sampler: gfxSampler });
    }

    const mpkInfo = BUNDLE.parseBundle(mpkBuffer);
    if (!mpkInfo.has(map.mapInfo.pcpFileName))
        throw "pcp file not found";
    const pcpInfo = BUNDLE.parseBundle(mpkBuffer.slice(mpkInfo.get(map.mapInfo.pcpFileName)!.offset), mpkInfo.get(map.mapInfo.pcpFileName)!.offset);
    const processedMDS = new Map<string, string>();
    const processedCHRS = new Map<string, CHR.CHR>();
    let bFireEffectLoaded: boolean = false;
    map.modelMap = new Map<string, MDS.MDS>();
    map.modelTransforms = [];
    map.modelPeriodFlags = [];
    for (let i = 0; i < map.mapInfo.mapParts.length; i++) {
        const mapPart = map.mapInfo.mapParts[i];
        const mapPartTransform = mat4.create();
        computeModelMatrixSRT(mapPartTransform, mapPart.partsScale[0], mapPart.partsScale[1], mapPart.partsScale[2], mapPart.partsRot[0], mapPart.partsRot[1], mapPart.partsRot[2], mapPart.partsPos[0], mapPart.partsPos[1], mapPart.partsPos[2]);
        if (!map.mapInfo.parts.has(mapPart.partsName))
            continue;
        const parts = map.mapInfo.parts.get(mapPart.partsName);
        for (let j = 0; j < parts!.pieces.length; j++) {
            const piece = parts!.pieces[j];
            if (!piece.mdsName.length || (mapPart.flags === 0 && piece.timeFlags === 0xF || piece.mdsName === "p01_1-m.mds")) //Last one prevents having casinon dup
                continue;
            const pieceTransform = mat4.create();
            computeModelMatrixSRT(pieceTransform, piece.scale[0], piece.scale[1], piece.scale[2], piece.rotation[0], piece.rotation[1], piece.rotation[2], piece.position[0], piece.position[1], piece.position[2]);
            if (piece.mdsName.split(".")[1] === "chr") {
                if (processedCHRS.has(piece.mdsName))
                    map.chrs.push(processedCHRS.get(piece.mdsName) as CHR.CHR);
                else {
                    map.chrs.push(CHR.parse(cache, mpkBuffer.slice(pcpInfo.get(piece.mdsName)!.offset, pcpInfo.get(piece.mdsName)!.offset + pcpInfo.get(piece.mdsName)!.size), piece.mdsName, true, map.img));
                    processedCHRS.set(piece.mdsName, map.chrs[map.chrs.length - 1]);
                }
                map.chrTransforms.push(mat4.mul(mat4.create(), mapPartTransform, pieceTransform));
                map.chrDayPeriodFlags.push(piece.timeFlags);
                continue;
            }
            if (processedMDS.has(piece.mdsName))
                map.modelMap.set(piece.name, map.modelMap.get(processedMDS.get(piece.mdsName) as string) as MDS.MDS);
            else {
                map.modelMap.set(piece.name, MDS.parse(mpkBuffer.slice(pcpInfo.get(piece.mdsName)!.offset, pcpInfo.get(piece.mdsName)!.offset + pcpInfo.get(piece.mdsName)!.size), piece.mdsName, map.textureDataMap));
                processedMDS.set(piece.mdsName, piece.name);
            }
            map.modelNames.push(piece.name);
            map.modelTransforms.push(mat4.mul(mat4.create(), mapPartTransform, pieceTransform));
            map.modelPeriodFlags.push(piece.timeFlags);
        }

        for (let j = 0; j < parts!.funcs.length; j++) {
            const func = parts!.funcs[j];
            if (func.type === "fire") { //Torches
                if (!bFireEffectLoaded) {
                    const fireImgBuffer = await dataFetcher.fetchData("DragonQuest8/effect/taimatu.img");
                    map.fireImg = IMG.parse(fireImgBuffer, "DragonQuest8/effect/taimatu.img");
                    for (let i = 0; i < map.fireImg.textures.length; i++) {
                        const texture = map.fireImg.textures[i];
                        if(map.textureDataMap.has(texture.name))
                            continue;
                        const gfxTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
                        const gfxSampler = cache.createSampler({
                            magFilter: GfxTexFilterMode.Bilinear,
                            minFilter: GfxTexFilterMode.Bilinear,
                            mipFilter: GfxMipFilterMode.Nearest,
                            maxLOD: 0,
                            minLOD: 0,
                            wrapS: GfxWrapMode.Clamp,
                            wrapT: GfxWrapMode.Clamp,
                        });
                        device.setResourceName(gfxTex, texture.name);
                        device.uploadTextureData(gfxTex, 0, [texture.pixels]);

                        map.textureDataMap.set(map.fireImg.textures[i].name, { texture: gfxTex, sampler: gfxSampler });
                    }
                    bFireEffectLoaded = true;
                }
                const funcTransform = mat4.create();
                computeModelMatrixSRT(funcTransform, 1, 1, 1, func.rotation[0], func.rotation[1], func.rotation[2], func.position[0], func.position[1], func.position[2])
                if (!processedMDS.has(func.name)) {
                    map.modelMap.set(func.name, MDS.createFireMDS(func.name, func.scale, map.textureDataMap));
                    processedMDS.set(func.name, func.name);
                }
                map.modelNames.push(func.name);
                map.modelTransforms.push(mat4.mul(mat4.create(), mapPartTransform, funcTransform));
                map.modelPeriodFlags.push(func.timeflags);
                map.fireEffectIndices.set(map.modelNames.length - 1, true);
            }
            else if (func.type === "place") { //Trees
                const funcTransform = mat4.create();
                computeModelMatrixSRT(funcTransform, 20, 20, 20, func.rotation[0], func.rotation[1], func.rotation[2], func.position[0], func.position[1], func.position[2]);
                if (!processedCHRS.has(func.type)) {
                    const treeBuffer = await dataFetcher.fetchData("DragonQuest8/map/tree_a.chr");
                    map.chrs.push(CHR.parse(cache, treeBuffer.slice(0x75e0, 0x1d5a0), func.name, true, map.img)); //Only grab tree 0
                    processedCHRS.set(func.type, map.chrs[map.chrs.length - 1]);
                }
                else {
                    map.chrs.push(processedCHRS.get(func.type) as CHR.CHR);
                }
                map.chrTransforms.push(mat4.mul(mat4.create(), mapPartTransform, funcTransform));
                map.chrDayPeriodFlags.push(0xF); //Trees are always there

            }
        }
    }

    if (skyBuffer.byteLength) {
        map.skies = parseSkyCfg(cache, skyBuffer);
        for (let j = 0; j < map.skies.length; j++) {
            const sky = map.skies[j];
            for (const [k, v] of sky.textureDataMap)
                map.textureDataMap.set(k, v);
            if (sky.mds !== null) {
                map.modelMap.set("sky" + j.toString(), sky.mds as MDS.MDS);
                map.modelNames.push("sky" + j.toString());
                map.modelTransforms.push(mat4.create());
                map.modelPeriodFlags.push(1 << (j + 1) % 4);
            }
            if (j === 0 && sky.mds !== null) {
                const sphereSkyMds = new MDS.MDS();
                sphereSkyMds.currentMotion = sky.mds!.currentMotion;
                sphereSkyMds.joints = sky.mds!.joints;
                sphereSkyMds.materials = sky.mds!.materials;
                sphereSkyMds.mdts = [sky.mds.mdts[0]];
                sphereSkyMds.modelMats = sky.mds!.modelMats;
                sphereSkyMds.mot = sky.mds!.mot;
                sphereSkyMds.name = "sphereSky";
                sphereSkyMds.rigidTransformJointIds = sky.mds!.rigidTransformJointIds;
                sphereSkyMds.rotJointIdToAngVels = sky.mds!.rotJointIdToAngVels;
                sphereSkyMds.textureDataMap = sky.mds!.textureDataMap;
                map.modelMap.set("sphereSky", sphereSkyMds);
                map.modelNames.push("sphereSky");
                map.modelTransforms.push(mat4.create());
                map.modelPeriodFlags.push(0xD);
            }
            if (sky.bmds !== null) {
                map.modelMap.set("skyb" + j.toString(), sky.bmds as MDS.MDS);
                map.modelNames.push("skyb" + j.toString());
                map.modelTransforms.push(mat4.create());
                map.modelPeriodFlags.push(1 << (j + 1) % 4);
            }
        }
    }

    return map;
}