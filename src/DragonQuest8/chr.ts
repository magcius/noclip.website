import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { computeModelMatrixSRT } from "../MathHelpers.js";
import { GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { assert, decodeString } from "../util.js";
import * as BUNDLE from './bundle.js';
import * as IMG from './img.js';
import * as MDS from './mds.js';
import * as MOT from './mot.js';
import * as SINFO from './sceneInfo.js';

interface ChrCfgInfo {
    mdsFileName: string;
    motFileName: string;
    imgFileName: string;
    motionInfo: MOT.MotionInfo[];
}

interface ProgressFlag {
    flag: number;
    dayPeriod: SINFO.ENPCDayPeriod;
}

interface NPCInfo {
    npcScript: number;
    npcFileName: string;
    npcEulerRotation: vec3;
    npcTransform: mat4;
    npcScriptEntry: number;
    npcExtraResPath: string;
}

const npcTable: string[] = ['chara/c001_skin1.chr', 'chara/c002_skin1.chr', 'chara/c004_skin2.chr', 'chara/c003_skin1.chr', 'chara/c005a.chr', 'chara/c006a.chr', 'chara/c007a.chr', 'chara/c006aw.chr', 'chara/ap001.chr', 'chara/ap002.chr', 'chara/bp001.chr', 'chara/bp002.chr', 'chara/bp004.chr', 'chara/bp005.chr', 'chara/bp007.chr', 'chara/bp006.chr', 'chara/cp001.chr', 'chara/cp002.chr', 'chara/p039a.chr', 'chara/p034a.chr', 'chara/p022a.chr', 'chara/p023a.chr', 'chara/p027a.chr', 'chara/p023a.chr', 'chara/p033a.chr', 'chara/p010a.chr', 'chara/p011a.chr', 'chara/p012a.chr', 'chara/p014a.chr', 'chara/p013a.chr', 'chara/p015a.chr', 'chara/p016a.chr', 'chara/p017a.chr', 'chara/p018a.chr', 'chara/p019a.chr', 'chara/p020a.chr', 'chara/p011op.chr', 'chara/a005a.chr', 'chara/dqtoruneko.chr', 'chara/sraim.chr', 'chara/p026a.chr', 'chara/p021a.chr', 'chara/dp001.chr', 'chara/dp001m.chr', 'chara/dp003.chr', 'chara/dp003m.chr', 'chara/dp004.chr', 'chara/p022a.chr', 'chara/p024b.chr', 'chara/cp001h.chr', 'chara/ep001.chr', 'chara/p055a.chr', 'chara/p050a.chr', 'chara/p013a.chr', 'chara/a008a.chr', 'chara/p065a.chr', 'chara/p058a.chr', 'chara/p028a.chr', 'chara/p037a.chr', 'chara/p052a.chr', 'chara/p049a.chr', 'chara/p054a.chr', 'chara/p046a.chr', 'chara/p048a.chr', 'chara/p051a.chr', 'chara/p053a.chr', 'chara/p043a.chr', 'chara/p025a.chr', 'chara/p031a.chr', 'chara/p038a.chr', 'chara/p048a.chr', 'chara/p057a.chr', 'chara/p013a.chr', 'chara/p046a.chr', 'chara/p020a.chr', 'chara/p024a.chr', 'chara/ap003.chr', 'chara/en042a.chr', 'chara/b600a.chr', 'chara/p067a.chr', 'chara/p033a.chr', 'chara/p036a.chr', 'chara/p047a.chr', 'chara/gp001.chr', 'chara/gp002.chr', 'chara/p039a.chr', 'chara/p056a.chr', 'chara/p024a.chr', 'chara/p066a.chr', 'chara/p029a.chr', 'chara/en069a.chr', 'chara/hoimisura.chr', 'chara/ip002.chr', 'chara/ip001.chr', 'chara/doroningyo.chr', 'chara/draky.chr', 'chara/hp001.chr', 'chara/a009a.chr', 'chara/en063a.chr', 'chara/p028a_iro.chr', 'chara/p038a.chr', 'chara/p027am.chr', 'chara/p013am.chr', 'chara/p014am.chr', 'chara/p018am.chr', 'chara/p011am.chr', 'chara/p022am.chr', 'chara/p048am.chr', 'chara/p028am.chr', 'chara/a001a.chr', 'chara/c004_skin2_p.chr', 'chara/a007a.chr', 'chara/en083a.chr', 'chara/p044a.chr', 'chara/p045a.chr', 'chara/p049a.chr', 'chara/p049b.chr', 'chara/jp001.chr', 'chara/jp002.chr', 'chara/p033a.chr', 'chara/a002a.chr', 'chara/en065a.chr', 'chara/ep003.chr', 'chara/lp001.chr', 'chara/lp002.chr', 'chara/lp003.chr', 'chara/lp004.chr', 'chara/mp002.chr', 'chara/mp003.chr', 'chara/mp004.chr', 'chara/k_shitai.chr', 'chara/p068a.chr', 'chara/p069a.chr', 'chara/en061a.chr', 'chara/ep002.chr', 'chara/ip003.chr', 'chara/np002.chr', 'chara/op001.chr', 'chara/pp002.chr', 'chara/pp001.chr', 'chara/np001.chr', 'chara/p059a.chr', 'chara/p060a.chr', 'chara/p061a.chr', 'chara/p062a.chr', 'chara/p063a.chr', 'chara/p064a.chr', 'chara/p035a.chr', 'chara/p034a.chr', 'chara/p029a.chr', 'chara/p030a.chr', 'chara/p032a.chr', 'chara/a010a.chr', 'chara/a007a.chr', 'chara/p052am.chr', 'chara/p051am.chr', 'chara/berserker.chr', 'chara/taho_draky.chr', 'chara/en106a.chr', 'chara/jinmenju.chr', 'chara/samayoroi.chr', 'chara/en043a.chr', 'chara/a_ku.chr', 'chara/babysatan.chr', 'chara/o_ku.chr', 'chara/en099a.chr', 'chara/baku.chr', 'chara/gigantesu.chr', 'chara/np001_kage.chr', 'chara/p059a_kage.chr', 'chara/p060a_kage.chr', 'chara/p061a_kage.chr', 'chara/p062a_kage.chr', 'chara/p063a_kage.chr', 'chara/p064a_kage.chr', 'chara/kp002.chr', 'chara/p048ap.chr', 'chara/p048ap_02.chr', 'chara/p048ap_03.chr', 'chara/p014ap.chr', 'chara/p012ap.chr', 'chara/p020ap.chr', 'chara/p054ap.chr', 'chara/p013ap.chr', 'chara/p023ap.chr', 'chara/p028ap.chr', 'chara/p027ap.chr', 'chara/p053ap.chr', 'chara/p057ap.chr', 'chara/p034ap.chr', 'chara/p031ap.chr', 'chara/p010ap.chr', 'chara/a005ap.chr', 'chara/b1000a.chr', 'chara/b1001a.chr', 'chara/en087a.chr', 'chara/oomedama.chr', 'chara/p046am.chr', 'chara/ep004.chr', 'chara/b701a.chr', 'chara/b700a.chr', 'chara/ep005.chr', 'chara/ep006.chr', 'chara/ip002b.chr', 'chara/p034a_kage.chr', 'chara/mp007.chr', 'chara/p043a_kage.chr', 'chara/a009a_kage.chr', 'chara/mp001.chr', 'chara/lp005.chr', 'chara/b1400a.chr', 'chara/b1301a.chr', 'chara/e1403_3_soul.chr', 'chara/np002kage.chr', 'chara/qp001.chr', 'chara/qp002.chr', 'chara/rp001.chr', 'chara/rp002.chr', 'chara/rp003w.chr', 'chara/sp001.chr', 'chara/sp002.chr', 'chara/p070a.chr', 'chara/p071a.chr', 'chara/p072a.chr', 'chara/p073a.chr', 'chara/rg04.chr', 'chara/rg05.chr', 'chara/rg06.chr', 'chara/rg07.chr', 'chara/rg08.chr', 'chara/rg09.chr', 'chara/rg10.chr', 'chara/rg11.chr', 'chara/rg12.chr', 'chara/rg13.chr', 'chara/rg14.chr', 'chara/rg15.chr', 'chara/rg16.chr', 'chara/rg17.chr', 'chara/a011a.chr', 'chara/en047a_h.chr', 'chara/en122a.chr', 'chara/bostol.chr', 'chara/qp016.chr', 'chara/p018b.chr', 'chara/p012f.chr', 'chara/rg01.chr', 'chara/rg02.chr', 'chara/rg03.chr', 'chara/rg18.chr', 'chara/b1701a.chr', 'chara/fp002.chr', 'chara/fp001.chr', 'chara/fp001_rp.chr', 'chara/b1801a.chr', 'chara/a004a.chr', 'chara/lp004_b.chr', 'chara/lp001_b.chr', 'chara/p024c.chr', 'chara/p024d.chr', 'chara/p024e.chr', 'chara/p011a_iro.chr', 'chara/p012a_iro.chr', 'chara/p013a_iro.chr', 'chara/p018a_iro.chr', 'chara/p020a_iro.chr', 'chara/p022a_iro.chr', 'chara/p023a_iro.chr', 'chara/p024a_iro.chr', 'chara/p024a_iro2.chr', 'chara/p024a_iro3.chr', 'chara/p025a_iro.chr', 'chara/p025a_iro2.chr', 'chara/p027a_iro.chr', 'chara/p027a_iro2.chr', 'chara/p033a_iro.chr', 'chara/p043a_iro.chr', 'chara/p046a_iro.chr', 'chara/p051a_iro.chr', 'chara/p052a_iro.chr', 'chara/p070a_iro.chr', 'chara/p073a_iro.chr', 'chara/dp003_ito.chr', 'chara/kp001.chr', 'chara/ip004.chr', 'chara/rp003w2.chr', 'chara/a009a_kage_b.chr', 'chara/s002a.chr', 'chara/en146a.chr', 'chara/p013f.chr', 'chara/p040a.chr', 'chara/p041a.chr', 'chara/p042a.chr', 'chara/pp003.chr', 'chara/dp004_hk.chr', 'chara/p074a.chr', 'chara/p075a.chr', 'chara/fp004.chr', 'chara/fp002b.chr', 'chara/c002_rp.chr', 'chara/c004_rp.chr', 'chara/c003_rp.chr', 'chara/p028a_iro2.chr', 'chara/p028a_iro3.chr', 'chara/p028a_iro4.chr', 'chara/p015a_iro.chr', 'chara/p037a_iro.chr', 'chara/p038a_iro.chr', 'chara/p019a_iro.chr', 'chara/p028a_iro5.chr', 'chara/c003_trump.chr', 'chara/p012a_trump.chr', 'chara/qp015.chr', 'chara/qp015b.chr', 'chara/qp014.chr', 'chara/p022f.chr'];

export function parseDispositionCfg(buffer: ArrayBufferSlice): Map<number, Map<number, NPCInfo[]>> {
    const lines = decodeString(buffer, 0, buffer.byteLength, "sjis").split('\n');
    type NPCTimeMap = Map<number, NPCInfo[]>;
    const dispoInfoMap = new Map<number, NPCTimeMap>(); //Progress->dayPeriod->info
    let cDayPeriod: number = -1;
    let cFlag: number = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.split(" ").length) {
            break;
        }

        const keyword = line.split(" ")[0];
        if (keyword === "PROGRESS") {
            const flag = parseInt(line.split(" ")[1].split(",")[0]) * 100 + parseInt(line.split(" ")[1].split(",")[1]);
            const dayPeriod = parseInt(line.split(" ")[1].split(",")[2].slice(0, -1));
            const pFlag: ProgressFlag = { flag, dayPeriod};
            
            if (!dispoInfoMap.has(pFlag.flag)) {
                dispoInfoMap.set(pFlag.flag, new Map<number, NPCInfo[]>());
            }
            cFlag = pFlag.flag;
            cDayPeriod = pFlag.dayPeriod;
        }
        else if (keyword === "DISPOSITION") {
            const data = line.split(" ").slice(1, line.split(" ").length).join("").split(",");
            const npcTransform: mat4 = mat4.create();
            const npcEulerRotation = vec3.fromValues(0, parseFloat(data[6]), 0);
            computeModelMatrixSRT(npcTransform, 1, 1, 1, 0, parseFloat(data[6]), 0, parseFloat(data[3]), parseFloat(data[4]), parseFloat(data[5]));
            if (!dispoInfoMap.get(cFlag)!.has(cDayPeriod))
                dispoInfoMap.get(cFlag)!.set(cDayPeriod, []);
            const npcScript = parseInt(data[0]), npcFileName = npcTable[parseInt(data[1])], npcScriptEntry = parseInt(data[7]), npcExtraResPath = data[8].slice(1, -1);
            const progressMap = dispoInfoMap.get(cFlag)!;
            if (!progressMap.has(cDayPeriod))
                progressMap.set(cDayPeriod, []);
            const npcInfo = progressMap.get(cDayPeriod)!;
            npcInfo.push({ npcScript, npcFileName, npcTransform, npcEulerRotation, npcScriptEntry, npcExtraResPath });
        }
    }
    return dispoInfoMap;
}

export class CHR {
    public name: string;
    public resInfo = new Map<String, BUNDLE.BundleResourceInfo>();
    public model: MDS.MDS | null = null;
    public img: IMG.IMG | null = null;
    public mot: MOT.MOT | null = null;
    public textureDataMap = new Map<string, IMG.TextureData>();
}

function parseCfgFile(buffer: ArrayBufferSlice): ChrCfgInfo {
    const lines = decodeString(buffer, 0, buffer.byteLength, "sjis").split('\n');
    let imgFileName = "";
    let mdsFileName = "";
    let motFileName = "";
    let bMotionParse = false;
    const motionInfo: MOT.MotionInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.split(" ").length)
            continue;
        const keyword = line.split(" ")[0];

        if (bMotionParse) {
            if (keyword === "KEY_END;\r")
                bMotionParse = false;
            else {
                const data = line.slice(0, -1).split(",");
                const name = data[0].split(" ")[1].split("\"")[1];
                const frameStart = parseInt(data[1].split(" ")[1]);
                const frameEnd = parseInt(data[2].split(" ")[1]);
                const speedFactor = parseFloat(data[3].split(" ")[1].split(";")[0]);
                motionInfo.push({ name, frameStart, frameEnd, speedFactor});
            }
            continue;
        }
        if (keyword === "MODEL") {
            if (line.includes(",")) //"New" MDS, see tree info to understand this check's necessity
                mdsFileName = line.split(" ")[1].slice(1, -2);
            else
                mdsFileName = line.split(" ")[1].slice(1, -3);
        }
        else if (keyword === "IMG") {
            if (imgFileName === "") //See Don Mole
                imgFileName = line.split(" ")[2].slice(1, -3);
        }
        else if (keyword === "MOTION") {
            motFileName = line.split(" ")[2].slice(1, -2);
            if (motFileName.endsWith("\""))
                motFileName = motFileName.slice(0, motFileName.length - 1);
        }
        else if (keyword === "KEY_START;\r") {
            bMotionParse = true;
        }
    }
    return { mdsFileName, imgFileName,motFileName, motionInfo };
}


export function parse(cache: GfxRenderCache, buffer: ArrayBufferSlice, name: string, bIsFromChar: boolean = true, mapImg: IMG.IMG | null = null, bSkelModelMat: boolean = false): CHR {
    const device = cache.device;
    const chr = new CHR();
    chr.name = name.split('/').pop()!;

    chr.resInfo = BUNDLE.parseBundle(buffer);

    let mdsFileName = "";
    let imgFileName = "";
    let motFileName = "";
    let chrcfgInfo: ChrCfgInfo | null = null;
    if (chr.resInfo.has("info.cfg")) {
        chrcfgInfo = parseCfgFile(buffer.slice(chr.resInfo.get("info.cfg")!.offset, chr.resInfo.get("info.cfg")!.offset + chr.resInfo.get("info.cfg")!.size));
        mdsFileName = chrcfgInfo.mdsFileName;
        imgFileName = chrcfgInfo.imgFileName;
        motFileName = chrcfgInfo.motFileName;
    }
    else
        throw "info.cfg not found"

    if (chr.resInfo.has(imgFileName)) {
        chr.img = IMG.parse(buffer.slice(chr.resInfo.get(imgFileName)!.offset, chr.resInfo.get(imgFileName)!.offset + chr.resInfo.get(imgFileName)!.size), imgFileName);
        for (let i = 0; i < chr.img.textures.length; i++) {
            const texture = chr.img.textures[i];
            if(chr.textureDataMap.has(texture.name))
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
            chr.textureDataMap.set(chr.img.textures[i].name, { texture: gfxTex, sampler: gfxSampler });
        }
    }
    //For chr bundled in map resources, the map's img is sometimes used. See Port Prospect's boat.
    else if (mapImg !== null) {
        chr.img = mapImg;
        for (let i = 0; i < chr.img.textures.length; i++) {
            const texture = chr.img.textures[i];
            if(chr.textureDataMap.has(texture.name))
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
            
            chr.textureDataMap.set(chr.img.textures[i].name, { texture: gfxTex, sampler: gfxSampler });
        }
    }

    if (chr.resInfo.has(mdsFileName)) {
        chr.model = MDS.parse(buffer.slice(chr.resInfo.get(mdsFileName)!.offset, chr.resInfo.get(mdsFileName)!.offset + chr.resInfo.get(mdsFileName)!.size), mdsFileName, chr.textureDataMap, bIsFromChar, bSkelModelMat);
    }

    if (motFileName.length) {
        if (chr.resInfo.has(motFileName))
            chr.mot = MOT.parse(buffer.slice(chr.resInfo.get(motFileName)!.offset, chr.resInfo.get(motFileName)!.offset + chr.resInfo.get(motFileName)!.size), motFileName, chrcfgInfo.motionInfo);
    }

    return chr;
}

export function updateChrWithChr(targetChr: CHR, sourceChr: CHR) {
    for (const [k, v] of sourceChr.textureDataMap) {
        targetChr.textureDataMap.set(k, v);
    }
    if (sourceChr.mot !== null) {
        if (targetChr.mot === null)
            targetChr.mot = sourceChr.mot;
        else {
            for (const [k, v] of sourceChr.mot!.motionNameToMotion) {
                targetChr.mot.motionNameToMotion.set(k, v);
            }
        }
    }
}