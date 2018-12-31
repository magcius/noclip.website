
// New Super Mario Bros DS

import * as Viewer from '../viewer';
import * as CX from '../compression/CX';
import * as NARC from './narc';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTP from './nsbtp';
import * as NSBTX from './nsbtx';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { CourseRenderer, MDL0Renderer, MKDSPass, WorldMapRenderer } from './render';
import { assert } from '../util';
import { mat4 } from 'gl-matrix';

class NewSuperMarioBrosDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private fetchBMD(path: string, abortSignal: AbortSignal): Progressable<NSBMD.BMD0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBMD.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTX(path: string, abortSignal: AbortSignal): Progressable<NSBTX.BTX0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTX.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTA(path: string, abortSignal: AbortSignal): Progressable<NSBTA.BTA0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTA.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTP(path: string, abortSignal: AbortSignal, index: number = 0): Progressable<NSBTP.BTP0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTP.parse(buffer, index);
            } catch (error) {
                return null;
            }
        });
    }

    private createObjectRepresentation(device: GfxDevice, path: string, abortSignal: AbortSignal): Progressable<ObjectRepresentation> {
        return Progressable.all<any>([
            this.fetchBMD(path+`.nsbmd`, abortSignal),
            this.fetchBTX(path+`.nsbtx`, abortSignal),
            this.fetchBTA(path+`.nsbta`, abortSignal),
            this.fetchBTP(path+`.nsbtp`, abortSignal),
        ]).then(([bmd,btx,bta,btp]) => {
            if(bmd===null)
                return null;
            assert(bmd.models.length === 1);

            return new ObjectRepresentation(device, bmd, btx, bta, btp);
        });
    }

    public createScene_Device(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.Scene_Device> {
        return Progressable.all<any>([
            this.createObjectRepresentation(device, `data/nsmbds/map/w${this.id}`, abortSignal),
            this.createObjectRepresentation(device, `data/nsmbds/map/w${this.id}_tree`, abortSignal),
            this.createObjectRepresentation(device, `data/nsmbds/map/w1_castle`, abortSignal),
            this.createObjectRepresentation(device, `data/nsmbds/map/w8_koppaC`, abortSignal),
            this.fetchBMD(`data/nsmbds/map/w1_tower.nsbmd`, abortSignal),
            this.fetchBMD(`data/nsmbds/map/map_point.nsbmd`, abortSignal),
            this.fetchBTP(`data/nsmbds/map/map_point.nsbtp`, abortSignal, 2),
            this.fetchBTP(`data/nsmbds/map/map_point.nsbtp`, abortSignal, 3),
        ]).then(([mainObj, treeObj, castleObj, bigCastleObj, towerBMD, mapPintBMD, mapPointStartBTP, mapPointBTP]) => {

            //adjust the nodes/bones to emulate the flag animations
            mat4.fromTranslation(towerBMD.models[0].nodes[2].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(towerBMD.models[0].nodes[3].jointMatrix, [0.75, 5.5, 0]);
            mat4.fromTranslation(castleObj.renderer.model.nodes[3].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(castleObj.renderer.model.nodes[4].jointMatrix, [0.75, 5.5, 0]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[5].jointMatrix, [-1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[6].jointMatrix, [-1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[7].jointMatrix, [-0.875, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[8].jointMatrix, [1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[9].jointMatrix, [1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[10].jointMatrix, [1.625, 2.75, -0.75]);

            mat4.scale(mainObj.renderer.modelMatrix,mainObj.renderer.modelMatrix,[1/16,1/16,1/16]);
            
            const objects = worldMapDescs[JSON.parse(this.id)-1];

            let representations:ObjectRepresentation[] = new Array(objects.length+(treeObj!==null?2:1));
            representations[0] = mainObj;

            if(treeObj!==null){
                mat4.scale(treeObj.renderer.modelMatrix,treeObj.renderer.modelMatrix,[1/16,1/16,1/16]);
                representations[1] = treeObj;
            }
            let i = treeObj!==null?2:1;
            
            objects.forEach(element => {
                if(element.type==WorldMapObjType.ROUTE_POINT){
                    const obj = new ObjectRepresentation(device, mapPintBMD, null, null, mapPointBTP);
                    mat4.scale(obj.renderer.modelMatrix,obj.renderer.modelMatrix,[1/16,1/16,1/16]);
                    mat4.translate(obj.renderer.modelMatrix,obj.renderer.modelMatrix,element.position);
                    representations[i] = obj;
                }else if(element.type==WorldMapObjType.START_POINT){
                    const obj = new ObjectRepresentation(device, mapPintBMD, null, null, mapPointStartBTP);
                    mat4.scale(obj.renderer.modelMatrix,obj.renderer.modelMatrix,[1/16,1/16,1/16]);
                    mat4.translate(obj.renderer.modelMatrix,obj.renderer.modelMatrix,element.position);
                    representations[i] = obj;
                }else if(element.type==WorldMapObjType.TOWER){
                    const obj = new ObjectRepresentation(device, towerBMD, null, null, null);
                    mat4.scale(obj.renderer.modelMatrix,obj.renderer.modelMatrix,[1/16,1/16,1/16]);
                    mat4.translate(obj.renderer.modelMatrix,obj.renderer.modelMatrix,element.position);
                    representations[i] = obj;
                }else if(element.type==WorldMapObjType.CASTLE){
                    mat4.scale(castleObj.renderer.modelMatrix,castleObj.renderer.modelMatrix,[1/16,1/16,1/16]);
                    mat4.translate(castleObj.renderer.modelMatrix,castleObj.renderer.modelMatrix,element.position);
                    representations[i] = castleObj;
                }else if(element.type==WorldMapObjType.BIG_CASTLE){
                    mat4.scale(bigCastleObj.renderer.modelMatrix,bigCastleObj.renderer.modelMatrix,[1/16,1/16,1/16]);
                    mat4.translate(bigCastleObj.renderer.modelMatrix,bigCastleObj.renderer.modelMatrix,element.position);
                    representations[i] = bigCastleObj;
                }

                i++;
            });
            if(this.id=="1")
                mat4.translate(mainObj.renderer.modelMatrix,mainObj.renderer.modelMatrix,[0,2.5,0]);
            else if(this.id=="3"){
                mat4.translate(mainObj.renderer.modelMatrix,mainObj.renderer.modelMatrix,[30,3,0]);
                mat4.translate(treeObj.renderer.modelMatrix,treeObj.renderer.modelMatrix,[-4,0,0]);
            }


            const w = new WorldMapRenderer(device, representations);

            return w;
        });
    }
}

enum WorldMapObjType{ROUTE_POINT, START_POINT, TOWER, CASTLE, BIG_CASTLE}

const id = 'nsmbds';
const name = 'New Super Mrio Bros DS';
const sceneDescs: Viewer.SceneDesc[] = [
    new NewSuperMarioBrosDSSceneDesc("1", "World 1"),
    new NewSuperMarioBrosDSSceneDesc("2", "World 2"),
    new NewSuperMarioBrosDSSceneDesc("3", "World 3"),
    new NewSuperMarioBrosDSSceneDesc("4", "World 4"),
    new NewSuperMarioBrosDSSceneDesc("5", "World 5"),
    new NewSuperMarioBrosDSSceneDesc("6", "World 6"),
    new NewSuperMarioBrosDSSceneDesc("7", "World 7"),
    new NewSuperMarioBrosDSSceneDesc("8", "World 8"),
];

export class ObjectRepresentation{
    public renderer: MDL0Renderer;

    constructor(device: GfxDevice, public bmd: NSBMD.BMD0, public btx: NSBTX.BTX0, public bta: NSBTA.BTA0, public btp: NSBTP.BTP0){
        this.renderer = new MDL0Renderer(device, this.btx !== null ? this.btx.tex0 : this.bmd.tex0, this.bmd.models[0]);
    }

    applyAnimations(device: GfxDevice){
        if (this.bta !== null)
            this.renderer.bindSRT0(this.bta.srt0);

        if (this.btp !== null)
            this.renderer.bindPAT0(device, this.btp.pat0);
    }
}

interface IWorldMapObj {
    type: WorldMapObjType, position: number[];
 }

const worldMapDescs: IWorldMapObj[][] = [
    [
        {type: WorldMapObjType.START_POINT,position: [-180,0,0]},
        {type: WorldMapObjType.TOWER,position: [2,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [34,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [10,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [34,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-400,0,0]},
        {type: WorldMapObjType.TOWER,position: [-26,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [2,0,-2.5]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [2,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [34,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [2,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [42,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [2,0,-2]},
        {type: WorldMapObjType.TOWER,position: [18,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [34,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [6,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [26,0,-3]},
    ],
    [
        {type: WorldMapObjType.START_POINT,position: [-144,0,0]},
        {type: WorldMapObjType.TOWER,position: [-2,0,-2]},
        {type: WorldMapObjType.CASTLE,position: [14,0,-3]},
        {type: WorldMapObjType.TOWER,position: [50,0,-2]},
        {type: WorldMapObjType.BIG_CASTLE,position: [33,0,0]},
    ],
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
