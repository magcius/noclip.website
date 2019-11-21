
import { mat4, vec3 } from "gl-matrix";
import { assertExists, hexzero } from "../util";
import { LiveActor, ZoneAndLayer, startBck, startBrkIfExist, startBtkIfExist, startBckIfExist, startBvaIfExist, dynamicSpawnZoneAndLayer } from "./LiveActor";
import { SceneObjHolder, getObjectName } from "./Main";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { isExistIndirectTexture, connectToSceneMapObjStrongLight, connectToSceneSky, connectToSceneIndirectMapObjStrongLight, connectToSceneBloom, bindColorChangeAnimation, bindTexChangeAnimation, emitEffect, createModelObjMapObj, MiniRoutePoint, MiniRoutePart, MiniRouteGalaxy } from "./Actors";
import { ViewerRenderInput } from "../viewer";
import { RARC } from "../j3d/rarc";
import { LoopMode, BTP, BVA } from "../Common/JSYSTEM/J3D/J3DLoader";
import AnimationController from "../AnimationController";

// The old actor code, before we started emulating things natively.
// Mostly used for SMG2 as we do not have symbols.

// Random actor for other things that otherwise do not have their own actors.

const enum SceneGraphTag {
    Skybox = 0,
    Normal = 1,
    Bloom = 2,
    Indirect = 3,
};

interface Point {
    p0: vec3;
    p1: vec3;
    p2: vec3;
}

export interface Path {
    l_id: number;
    name: string;
    type: string;
    closed: string;
    points: Point[];
}

export interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    objArg1: number;
    objArg2: number;
    objArg3: number;
    modelMatrix: mat4;
    path: Path | null;
}

export interface WorldmapPointInfo {
    isPink: boolean;
    isSmall: boolean;
    position: vec3;
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

const enum RotateAxis { X, Y, Z };

export class NoclipLegacyActor extends LiveActor {
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;

    constructor(zoneAndLayer: ZoneAndLayer, arcName: string, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, tag: SceneGraphTag, public objinfo: ObjInfo) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, arcName);

        if (isExistIndirectTexture(this))
            tag = SceneGraphTag.Indirect;

        if (tag === SceneGraphTag.Normal)
            connectToSceneMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Skybox)
            connectToSceneSky(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Indirect)
            connectToSceneIndirectMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Bloom)
            connectToSceneBloom(sceneObjHolder, this);

        if (tag === SceneGraphTag.Skybox) {
            mat4.scale(objinfo.modelMatrix, objinfo.modelMatrix, [.5, .5, .5]);

            // Kill translation. Need to figure out how the game does skyboxes.
            objinfo.modelMatrix[12] = 0;
            objinfo.modelMatrix[13] = 0;
            objinfo.modelMatrix[14] = 0;

            this.modelInstance!.isSkybox = true;
        }

        this.initEffectKeeper(sceneObjHolder, null);
    }

    public setRotateSpeed(speed: number, axis = RotateAxis.Y): void {
        this.rotatePhase = (this.objinfo.modelMatrix[12] + this.objinfo.modelMatrix[13] + this.objinfo.modelMatrix[14]);
        this.rotateSpeed = speed;
        this.rotateAxis = axis;
    }

    public updateMapPartsRotation(dst: mat4, time: number): void {
        if (this.rotateSpeed !== 0) {
            const speed = this.rotateSpeed * Math.PI / 100;
            if (this.rotateAxis === RotateAxis.X)
                mat4.rotateX(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Y)
                mat4.rotateY(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Z)
                mat4.rotateZ(dst, dst, (time + this.rotatePhase) * speed);
        }
    }

    public calcAndSetBaseMtx(viewerInput: ViewerRenderInput): void {
        const time = viewerInput.time / 1000;
        super.calcAndSetBaseMtx(viewerInput);
        this.updateMapPartsRotation(this.modelInstance!.modelMatrix, time);
    }
}

export class NoclipLegacyActorSpawner {
    private isSMG1 = false;
    private isSMG2 = false;
    private isWorldMap = false;

    constructor(private sceneObjHolder: SceneObjHolder) {
        this.isSMG1 = this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy';
        this.isSMG2 = this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy2';
        this.isWorldMap = this.isSMG2 && this.sceneObjHolder.sceneDesc.galaxyName.startsWith('WorldMap');
    }

    public async spawnObjectLegacy(zoneAndLayer: ZoneAndLayer, infoIter: JMapInfoIter, objinfo: ObjInfo): Promise<void> {
        const modelCache = this.sceneObjHolder.modelCache;
        const galaxyName = this.sceneObjHolder.sceneDesc.galaxyName;

        const applyAnimations = (actor: LiveActor, animOptions: AnimOptions | null | undefined) => {
            if (animOptions !== null) {
                if (animOptions !== undefined) {
                    if (animOptions.bck !== undefined)
                        startBck(actor, animOptions.bck.slice(0, -4));
                    if (animOptions.brk !== undefined)
                        startBrkIfExist(actor.modelInstance!, actor.arc, animOptions.brk.slice(0, -4));
                    if (animOptions.btk !== undefined)
                        startBtkIfExist(actor.modelInstance!, actor.arc, animOptions.btk.slice(0, -4));
                } else {
                    // Look for "Wait" animation first, then fall back to the first animation.
                    let hasAnim = false;
                    hasAnim = startBck(actor, 'Wait') || hasAnim;
                    hasAnim = startBrkIfExist(actor.modelInstance!, actor.arc, 'Wait') || hasAnim;
                    hasAnim = startBtkIfExist(actor.modelInstance!, actor.arc, 'Wait') || hasAnim;
                    if (!hasAnim) {
                        // If there's no "Wait" animation, then play the first animations that we can...
                        const bckFile = actor.arc.files.find((file) => file.name.endsWith('.bck')) || null;
                        if (bckFile !== null) {
                            const bckFilename = bckFile.name.slice(0, -4);
                            startBck(actor, bckFilename);
                        }

                        const brkFile = actor.arc.files.find((file) => file.name.endsWith('.brk') && file.name.toLowerCase() !== 'colorchange.brk') || null;
                        if (brkFile !== null) {
                            const brkFilename = brkFile.name.slice(0, -4);
                            startBckIfExist(actor.modelInstance!, actor.arc, brkFilename);
                        }

                        const btkFile = actor.arc.files.find((file) => file.name.endsWith('.btk') && file.name.toLowerCase() !== 'texchange.btk') || null;
                        if (btkFile !== null) {
                            const btkFilename = btkFile.name.slice(0, -4);
                            startBtkIfExist(actor.modelInstance!, actor.arc, btkFilename);
                        }            
                    }
                }
            }

            // Apply a random phase to the animation.
            const ank1Animator = actor.modelInstance!.ank1Animator;
            if (ank1Animator !== null && ank1Animator.ank1.loopMode === LoopMode.REPEAT)
                ank1Animator.animationController.phaseFrames += Math.random() * ank1Animator.ank1.duration;
        }

        const bindChangeAnimation = (actor: NoclipLegacyActor, rarc: RARC, frame: number) => {
            bindColorChangeAnimation(actor.modelInstance!, rarc, frame);
            bindTexChangeAnimation(actor.modelInstance!, rarc, frame);
        };

        const spawnGraphNullable = async (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined): Promise<[NoclipLegacyActor, RARC] | null> => {
            const data = await modelCache.requestObjectData(arcName);

            if (data === null)
                return null;

            const actor = new NoclipLegacyActor(zoneAndLayer, arcName, this.sceneObjHolder, infoIter, tag, objinfo);
            applyAnimations(actor, animOptions);

            actor.scenarioChanged(this.sceneObjHolder);

            return [actor, actor.arc];
        };

        const spawnGraph = async (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            return assertExists(await spawnGraphNullable(arcName, tag, animOptions));
        };

        const name = objinfo.objName;
        switch (name) {
            case 'MeteorCannon':
            case 'Plant':
            case 'WaterPlant':
            case 'SwingRope':
            case 'Creeper':
            case 'TrampleStar':
            case 'Flag':
            case 'FlagPeachCastleA':
            case 'FlagPeachCastleB':
            case 'FlagPeachCastleC':
            case 'FlagKoopaA':
            case 'FlagKoopaB':
            case 'FlagKoopaC':
            case 'FlagKoopaCastle':
            case 'FlagRaceA':
            case 'FlagRaceB':
            case 'FlagRaceC':
            case 'FlagTamakoro':
            case 'OceanRing':
            case 'WoodLogBridge':
            case 'SandBird':
            case 'RingBeamerAreaObj':
            case 'StatusFloor':
                // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
                return;

            case 'StarPieceFollowGroup':
            case 'StarPieceGroup':
            case 'StarPieceSpot':
            case 'StarPieceFlow':
            case 'WingBlockStarPiece':
            case 'YellowChipGroup':
            case 'CoinAppearSpot':
            case 'LuigiIntrusively':
            case 'MameMuimuiAttackMan':
            case 'CutBushGroup':
            case 'SuperDreamer':
            case 'PetitPorterWarpPoint':
            case 'TimerCoinBlock':
            case 'CoinLinkGroup':
            case 'CollectTico':
            case 'BrightSun':
            case 'InstantInferno':
            case 'FireRing':
            case 'FireBar':
            case 'JumpBeamer':
            case 'WaterFortressRain':
            case 'BringEnemy':
            case 'IceLayerBreak':
            case 'HeadLight':
            case 'TereboGroup':
            case 'NoteFairy':
            case 'Tongari2D':
            case 'Grapyon':
            case 'GliderShooter':
            case 'CaveInCube':
            case 'RaceRail':
            case 'GliBirdNpc':
            case 'SecretGateCounter':
            case 'HammerHeadPackun':
            case 'Hanachan':
            case 'MarinePlant':
            case 'Nyoropon':
            case 'WaterStream':
            case 'BallRail':
            case 'SphereRailDash':
            case 'HammerHeadPackunSpike':
                // No archives. Needs R&D for what to display.
                return;

            case 'SplashCoinBlock':
            case 'TimerCoinBlock':
            case 'SplashPieceBlock':
            case 'TimerPieceBlock':
            case 'ItemBlockSwitch':
                spawnGraph("CoinBlock", SceneGraphTag.Normal);
                break;

            case 'SurfingRaceSubGate':
                spawnGraph(name).then(([node, rarc]) => {
                    bindChangeAnimation(node, rarc, objinfo.objArg1);
                });
                return;

            // Bloomables.
            // The actual engine will search for a file suffixed "Bloom" and spawn it if so.
            // Here, we don't want to trigger that many HTTP requests, so we just list all
            // models with bloom variants explicitly.
            case 'AssemblyBlockPartsTimerA':
            case 'AstroDomeComet':
            case 'FlipPanel':
            case 'FlipPanelReverse':
            case 'HeavensDoorInsidePlanetPartsA':
            case 'LavaProminence':
            case 'LavaProminenceEnvironment':
            case 'LavaProminenceTriple':
                spawnGraph(name, SceneGraphTag.Normal);
                spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
                break;

            // SMG1.
            case 'Rabbit':
                spawnGraph('TrickRabbit');
                break;
            case 'TicoShop':
                spawnGraph(`TicoShop`).then(([node, rarc]) => {
                    startBvaIfExist(node.modelInstance!, rarc, 'Small0');
                });
                break;

            case 'OtaKing':
                spawnGraph('OtaKing');
                spawnGraph('OtaKingMagma');
                spawnGraph('OtaKingMagmaBloom', SceneGraphTag.Bloom);
                break;

            case 'UFOKinoko':
                spawnGraph(name, SceneGraphTag.Normal, null).then(([node, rarc]) => {
                    bindChangeAnimation(node, rarc, objinfo.objArg0);
                });
                break;
            case 'PlantA':
                spawnGraph(`PlantA${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantB':
                spawnGraph(`PlantB${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantC':
                spawnGraph(`PlantC${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantD':
                spawnGraph(`PlantD${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'BenefitItemOneUp':
                spawnGraph(`KinokoOneUp`);
                break;
            case 'BenefitItemLifeUp':
                spawnGraph(`KinokoLifeUp`);
                break;
            case 'BenefitItemInvincible':
                spawnGraph(`PowerUpInvincible`);
                break;
            case 'MorphItemNeoHopper':
                spawnGraph(`PowerUpHopper`);
                break;
            case 'MorphItemNeoBee':
                spawnGraph(`PowerUpBee`);
                break;
            case 'MorphItemNeoFire':
                spawnGraph(`PowerUpFire`);
                break;
            case 'MorphItemNeoFoo':
                spawnGraph(`PowerUpFoo`);
                break;
            case 'MorphItemNeoIce':
                spawnGraph(`PowerUpIce`);
                break;
            case 'MorphItemNeoTeresa':
                spawnGraph(`PowerUpTeresa`);
                break;
            case 'SpinCloudItem':
                spawnGraph(`PowerUpCloud`);
                break;
            case 'PukupukuWaterSurface':
                spawnGraph(`Pukupuku`);
                break;
            case 'JetTurtle':
                // spawnGraph(`Koura`);
                break;

            // TODO(jstpierre): Group spawn logic?
            case 'FlowerGroup':
                if (this.isSMG1)
                    spawnGraph(`Flower`);
                return;
            case 'FlowerBlueGroup':
                if (this.isSMG1)
                    spawnGraph(`FlowerBlue`);
                return;

            case 'HeavensDoorAppearStepA':
                // This is the transition effect version of the steps that appear after you chase the bunnies in Gateway Galaxy.
                // "HeavensDoorAppearStepAAfter" is the non-transition version of the same, and it's also spawned, so don't
                // bother spawning this one.
                return;

            case 'GreenStar':
            case 'PowerStar':
                spawnGraph(`PowerStar`, SceneGraphTag.Normal, { }).then(([node, rarc]) => {
                    if (this.isSMG1) {
                        // This appears to be hardcoded in the DOL itself, inside "GameEventFlagTable".
                        const isRedStar = galaxyName === 'HeavensDoorGalaxy' && node.objinfo.objArg0 === 2;
                        // This is also hardcoded, but the designers left us a clue.
                        const isGreenStar = name === 'GreenStar';
                        const frame = isRedStar ? 5 : isGreenStar ? 2 : 0;

                        const animationController = new AnimationController();
                        animationController.setTimeInFrames(frame);

                        const btp = BTP.parse(rarc.findFileData(`powerstar.btp`)!);
                        node.modelInstance!.bindTPT1(btp, animationController);
                    } else {
                        const frame = name === 'GreenStar' ? 2 : 0;

                        const animationController = new AnimationController();
                        animationController.setTimeInFrames(frame);

                        const btp = BTP.parse(rarc.findFileData(`PowerStarColor.btp`)!);
                        node.modelInstance!.bindTPT1(btp, animationController);
                    }

                    node.modelInstance!.setMaterialVisible('Empty', false);

                    node.setRotateSpeed(140);
                });
                return;

            case 'GrandStar':
                spawnGraph(name).then(([node, rarc]) => {
                    // Stars in cages are rotated by BreakableCage at a hardcoded '3.0'.
                    // See BreakableCage::exeWait.
                    node.modelInstance!.setMaterialVisible('GrandStarEmpty', false);
                    node.setRotateSpeed(3);
                });
                return;

            // SMG2
            case 'Moc':
                spawnGraph(name, SceneGraphTag.Normal, { bck: 'turn.bck' }).then(([node, rarc]) => {
                    const bva = BVA.parse(rarc.findFileData(`FaceA.bva`)!);
                    node.modelInstance!.bindVAF1(bva);
                });
                break;
            case 'CareTakerHunter':
                spawnGraph(`CaretakerHunter`);
                break;
            case 'WorldMapSyncSky':
                // Presumably this uses the "current world map". I chose 03, because I like it.
                spawnGraph(`WorldMap03Sky`, SceneGraphTag.Skybox);
                break;

            case 'DinoPackunVs1':
            case 'DinoPackunVs2':
                spawnGraph(`DinoPackun`);
                break;

            case 'Mogucchi':
                spawnGraph(name, SceneGraphTag.Normal, { bck: 'walk.bck' });
                return;

            case 'Dodoryu':
                spawnGraph(name, SceneGraphTag.Normal, { bck: 'swoon.bck' });
                break;
            case 'Karikari':
                spawnGraph('Karipon');
                break;
            case 'YoshiCapture':
                spawnGraph(`YCaptureTarget`);
                break;
            case 'Patakuri':
                // TODO(jstpierre): Parent the wing to the kurib.
                spawnGraph(`Kuribo`, SceneGraphTag.Normal, { bck: 'patakuriwait.bck' });
                spawnGraph(`PatakuriWing`);
                break;
            case 'ShellfishCoin':
                spawnGraph(`Shellfish`);
                break;
            case 'TogeBegomanLauncher':
            case 'BegomanBabyLauncher':
                spawnGraph(`BegomanLauncher`);
                break;

            case 'MarioFacePlanetPrevious':
                // The "old" face planet that Lubba discovers. We don't want it in sight, just looks ugly.
                return;

            case 'RedBlueTurnBlock':
                spawnGraph(`RedBlueTurnBlock`);
                spawnGraph(`RedBlueTurnBlockBase`);
                break;

            case 'TicoCoin':
                spawnGraph(name).then(([node, rarc]) => {
                    node.modelInstance!.setMaterialVisible('TicoCoinEmpty_v', false);
                });
                break;
            case 'WanwanRolling':
                spawnGraph(name, SceneGraphTag.Normal, { });
                break;
            case 'PhantomCandlestand':
                spawnGraph(name).then(([node, rarc]) => {
                    emitEffect(this.sceneObjHolder, node, 'Fire');
                });
            default: {
                const node = await spawnGraphNullable(name);
                if (node === null)
                    console.warn(`Unable to spawn ${name}`, zoneAndLayer, infoIter);
                break;
            }
        }
    }

    // SMG2 World Map
    public requestArchives(sceneObjHolder: SceneObjHolder): void {
        if (this.isWorldMap)
            this.requestArchivesWorldMap(sceneObjHolder);
    }

    public requestArchivesWorldMap(sceneObjHolder: SceneObjHolder): void {
        const modelCache = sceneObjHolder.modelCache;
        const galaxyName = sceneObjHolder.sceneDesc.galaxyName;
        modelCache.requestObjectData('MiniRoutePoint');
        modelCache.requestObjectData('MiniRouteLine');
        modelCache.requestObjectData('MiniWorldWarpPoint');
        modelCache.requestObjectData('MiniEarthenPipe');
        modelCache.requestObjectData('MiniStarPieceMine');
        modelCache.requestObjectData('MiniTicoMasterMark');
        modelCache.requestObjectData('MiniStarCheckPointMark');

        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(galaxyName.substr(0, 10))!;
        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((jmp) => {
            modelCache.requestObjectData(assertExists(jmp.getValueString('MiniatureName')));
        })
    }

    public place(): void {
        if (this.isWorldMap) {
            this.placeWorldMap();
            // This zone appears to be toggled at runtime? Not sure how the WorldMap system is implemented...
            this.sceneObjHolder.spawner.zones[1].visible = false;
        }
    }

    private placeWorldMap(): void {
        const galaxyName = this.sceneObjHolder.sceneDesc.galaxyName;

        const points: WorldmapPointInfo[] = [];
        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(galaxyName.substr(0, 10))!;
        const worldMapPointData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointPos.bcsv')!);

        // Spawn everything in Zone -1.
        const zoneAndLayer: ZoneAndLayer = dynamicSpawnZoneAndLayer;

        worldMapPointData.mapRecords((infoIter) => {
            const position = vec3.fromValues(
                assertExists(infoIter.getValueNumber('PointPosX')),
                assertExists(infoIter.getValueNumber('PointPosY')),
                assertExists(infoIter.getValueNumber('PointPosZ')),
            );

            const isPink = infoIter.getValueString('ColorChange') == 'o';
            const isSmall = true;
            const pointInfo: WorldmapPointInfo = {
                position, isPink, isSmall,
            };
            points.push(pointInfo);
        });

        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointPosIndex'));
            points[pointIndex].isSmall = false;
            const galaxy = new MiniRouteGalaxy(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
        });

        // Sometimes it's in the ActorInfo directory, sometimes its not... WTF?
        const worldMapPointParts = createCsvParser(worldMapRarc.files.find((file) => file.name.toLowerCase() === 'pointparts.bcsv')!.buffer);
        worldMapPointParts.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointIndex'));
            points[pointIndex].isSmall = false;
            const pointPart = new MiniRoutePart(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
        });

        // Spawn our points
        worldMapPointData.mapRecords((infoIter, i) => {
            const isValid = infoIter.getValueString('Valid') === 'o';
            if (isValid) {
                const point = new MiniRoutePoint(zoneAndLayer, this.sceneObjHolder, points[i]);
            }
        });

        const worldMapLinkData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointLink.bcsv')!);
        worldMapLinkData.mapRecords((jmp) => {
            const isColorChange = jmp.getValueString('IsColorChange') === 'o';
            const pointA = points[assertExists(jmp.getValueNumber('PointIndexA'))];
            const pointB = points[assertExists(jmp.getValueNumber('PointIndexB'))];
            this.spawnWorldMapLine(zoneAndLayer, pointA, pointB, isColorChange);
        });
    }

    public spawnWorldMapLine(zoneAndLayer: ZoneAndLayer, point1Info: WorldmapPointInfo, point2Info: WorldmapPointInfo, isPink: Boolean): void {
        // TODO(jstpierre): Move to a LiveActor for the lines as well?

        const modelMatrix = mat4.create();
        mat4.fromTranslation(modelMatrix, point1Info.position);

        const r = vec3.create();
        vec3.sub(r,point2Info.position,point1Info.position);
        modelMatrix[0]  = r[0]/1000;
        modelMatrix[1]  = r[1]/1000;
        modelMatrix[2]  = r[2]/1000;

        vec3.normalize(r, r);
        const u = vec3.fromValues(0,1,0);
        modelMatrix[4]  = 0;
        modelMatrix[5]  = 1;
        modelMatrix[6]  = 0;

        const f = vec3.create();
        vec3.cross(f, r, u);
        modelMatrix[8]  = f[0]*2;
        modelMatrix[9]  = f[1];
        modelMatrix[10] = f[2]*2;

        const obj = createModelObjMapObj(zoneAndLayer, this.sceneObjHolder, `MiniRouteLine`, 'MiniRouteLine', modelMatrix);
        startBvaIfExist(obj.modelInstance!, obj.arc, 'Open');
        if (isPink)
            startBrkIfExist(obj.modelInstance!, obj.arc, 'TicoBuild');
        else
            startBrkIfExist(obj.modelInstance!, obj.arc, 'Normal');
    }
}
