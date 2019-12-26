
import { ContentReader, ContentTypeReader, XNA_Texture2D, ContentTypeReaderManager, XNA_PrimitiveType, XNA_SurfaceFormat } from "./XNB";
import { vec3, vec2, vec4, quat } from "gl-matrix";
import { assertExists } from "../util";
import { Color } from "../Color";

// Fez implementation of XNB.

function Fez_TrileEmplacementReader(reader: ContentReader): vec3 {
    const x = reader.ReadInt32();
    const y = reader.ReadInt32();
    const z = reader.ReadInt32();
    return vec3.fromValues(x, y, z);
}

export interface Fez_VertexPositionNormalTextureInstance {
    position: vec3;
    normal: vec3;
    texcoord: vec2;
}

function Fez_VertexPositionNormalTextureInstanceReader(reader: ContentReader): Fez_VertexPositionNormalTextureInstance {
    const position = reader.ReadVector3();
    const normalByte = reader.ReadByte();
    const normal = normals[normalByte];
    const texcoord = reader.ReadVector2();
    return { position, normal, texcoord };
}

export interface Fez_ArtObject {
    name: string;
    futureCubeMap: XNA_Texture2D;
    size: vec3;
    geometry: Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>;
    actorType: number;
    noSilhouette: boolean;
}

function Fez_ArtObjectReader(reader: ContentReader): Fez_ArtObject {
    const name = reader.ReadString();
    const futureCubeMap = assertExists(reader.ReadObject<XNA_Texture2D>());
    const size = reader.ReadVector3();
    const geometry = reader.ReadObject<Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>>()!;
    const actorType = reader.ReadObject<number>()!;
    const noSilhouette = reader.ReadBoolean();
    return { name, futureCubeMap, size, geometry, actorType, noSilhouette };
}

export interface Fez_Trile {
    name: string;
    cubemapPath: string;
    size: vec3;
    offset: vec3;
    geometry: Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>;
    atlasOffset: vec2;
}

function Fez_TrileReader(reader: ContentReader): Fez_Trile {
    const name = reader.ReadString();
    const cubemapPath = reader.ReadString();
    const size = reader.ReadVector3();
    const offset = reader.ReadVector3();
    const immaterial = reader.ReadBoolean();
    const seeThrough = reader.ReadBoolean();
    const thin = reader.ReadBoolean();
    const forceHugging = reader.ReadBoolean();
    const faces = reader.ReadObject<Map<number, number>>();
    const geometry = reader.ReadObject<Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>>()!;
    const actorSettingsType = reader.ReadObject<number>();
    const actorSettingsFace = reader.ReadObject<number>();
    const surfaceType = reader.ReadObject<number>();
    const atlasOffset = reader.ReadVector2();
    return { name, cubemapPath, size, offset, geometry, atlasOffset };
}

export interface Fez_TrileSet {
    name: string;
    triles: Map<number, Fez_Trile>;
    textureAtlas: XNA_Texture2D;
}

function Fez_TrileSetReader(reader: ContentReader): Fez_TrileSet {
    const name = reader.ReadString();
    const triles = reader.ReadObject<Map<number, Fez_Trile>>()!;
    const textureAtlas = reader.ReadObject<XNA_Texture2D>()!;
    return { name, triles, textureAtlas };
}

export interface Fez_AnimatedTexture {
    width: number;
    height: number;
    actualWidth: number;
    actualHeight: number;
    texture: XNA_Texture2D;
    frames: Fez_Frame[];
}

function Fez_AnimatedTextureReader(reader: ContentReader): Fez_AnimatedTexture {
    const width = reader.ReadInt32();
    const height = reader.ReadInt32();
    const actualWidth = reader.ReadInt32();
    const actualHeight = reader.ReadInt32();
    const textureDataSize = reader.ReadInt32();
    const textureData = reader.ReadBytes(textureDataSize);
    const frames = reader.ReadObject<Fez_Frame[]>()!;
    const texture: XNA_Texture2D = { format: XNA_SurfaceFormat.Color, width, height, levelData: [textureData] };
    return { width, height, actualWidth, actualHeight, texture, frames };
}

export interface Fez_Frame {
    duration: number;
    rectangle: vec4;
}

function Fez_FrameReader(reader: ContentReader): Fez_Frame {
    const duration = reader.ReadObject<number>()!;
    const rectangle = reader.ReadObject<vec4>()!;
    return { duration, rectangle };
}

export interface Fez_SkyLayer {
    name: string;
    inFront: boolean;
    opacity: number;
    fogTint: number;
}

function Fez_SkyLayerReader(reader: ContentReader): Fez_SkyLayer {
    const name = reader.ReadString();
    const inFront = reader.ReadBoolean();
    const opacity = reader.ReadSingle();
    const fogTint = reader.ReadSingle();
    return { name, inFront, opacity, fogTint };
}

export interface Fez_Sky {
    name: string;
    background: string;
    windSpeed: number;
    density: number;
    fogDensity: number;
    layers: Fez_SkyLayer[];
    clouds: string[];
    shadows: string | null;
    stars: string | null;
    cloudTint: string | null;
    verticalTiling: boolean;
    horizontalScrolling: boolean;
    layerBaseHeight: number;
    interLayerVerticalDistance: number;
    horizontalDistance: number;
    verticalDistance: number;
    layerBaseSpacing: number;
    windParallax: number;
    windDistance: number;
    cloudsParallax: number;
    shadowOpacity: number;
    foliageShadows: boolean;
    noPerFaceLayerXOffset: boolean;
    layerBaseXOffset: number;
}

function Fez_SkyReader(reader: ContentReader): Fez_Sky {
    const name = reader.ReadString();
    const background = reader.ReadString();
    const windSpeed = reader.ReadSingle();
    const density = reader.ReadSingle();
    const fogDensity = reader.ReadSingle();
    const layers = reader.ReadObject<Fez_SkyLayer[]>()!;
    const clouds = reader.ReadObject<string[]>()!;
    const shadows = reader.ReadObject<string>()!;
    const stars = reader.ReadObject<string>()!;
    const cloudTint = reader.ReadObject<string>()!;
    const verticalTiling = reader.ReadBoolean();
    const horizontalScrolling = reader.ReadBoolean();
    const layerBaseHeight = reader.ReadSingle();
    const interLayerVerticalDistance = reader.ReadSingle();
    const horizontalDistance = reader.ReadSingle();
    const verticalDistance = reader.ReadSingle();
    const layerBaseSpacing = reader.ReadSingle();
    const windParallax = reader.ReadSingle();
    const windDistance = reader.ReadSingle();
    const cloudsParallax = reader.ReadSingle();
    const shadowOpacity = reader.ReadSingle();
    const foliageShadows = reader.ReadBoolean();
    const noPerFaceLayerXOffset = reader.ReadBoolean();
    const layerBaseXOffset = reader.ReadSingle();
    return {
        name, background, windSpeed, density, fogDensity, layers, clouds, shadows, stars,
        cloudTint, verticalTiling, horizontalScrolling, layerBaseHeight, interLayerVerticalDistance,
        horizontalDistance, verticalDistance, layerBaseSpacing, windParallax, windDistance,
        cloudsParallax, shadowOpacity, foliageShadows, noPerFaceLayerXOffset, layerBaseXOffset,
    };
}

export interface Fez_TrileFace {
    trileID: vec3;
    faceOrientation: number;
}

function Fez_TrileFaceReader(reader: ContentReader): Fez_TrileFace {
    const trileID = reader.ReadObject<vec3>()!;
    const faceOrientation = reader.ReadObject<number>()!;
    return { trileID, faceOrientation };
}

export interface Fez_Volume {
    orientations: number[];
    from: vec3;
    to: vec3;
    actorSettings: number;
}

function Fez_VolumeReader(reader: ContentReader): Fez_Volume {
    const orientations = reader.ReadObject<number[]>()!;
    const from = reader.ReadVector3();
    const to = reader.ReadVector3();
    const actorSettings = reader.ReadObject<number>()!;
    return { orientations, from, to, actorSettings };
}

export interface Fez_DotDialogueLine {
    resourceText: string;
    grouped: boolean;
}

function Fez_DotDialogueLineReader(reader: ContentReader): Fez_DotDialogueLine {
    const resourceText = reader.ReadObject<string>()!;
    const grouped = reader.ReadBoolean();
    return { resourceText, grouped };
}

export interface Fez_VolumeActorSettings {
    farawayPlaneOffset: vec2;
    isPointOfInterest: boolean;
    dotDialogue: Fez_DotDialogueLine[];
    waterLocked: boolean;
    codePattern: number[];
    isBlackHole: boolean;
    needsTrigger: boolean;
    isSecretPassage: boolean;
}

function Fez_VolumeActorSettingsReader(reader: ContentReader): Fez_VolumeActorSettings {
    const farawayPlaneOffset = reader.ReadVector2();
    const isPointOfInterest = reader.ReadBoolean();
    const dotDialogue = reader.ReadObject<Fez_DotDialogueLine[]>()!;
    const waterLocked = reader.ReadBoolean();
    const codePattern = reader.ReadObject<number[]>()!;
    const isBlackHole = reader.ReadBoolean();
    const needsTrigger = reader.ReadBoolean();
    const isSecretPassage = reader.ReadBoolean();
    return { farawayPlaneOffset, isPointOfInterest, dotDialogue, waterLocked, codePattern, isBlackHole, needsTrigger, isSecretPassage };
}

export interface Fez_Script {
    name: string;
    timeout: number;
    triggers: Fez_ScriptTrigger[];
    conditions: Fez_ScriptCondition[];
    actions: Fez_ScriptAction[];
    oneTime: boolean;
    triggerless: boolean;
    ignoreEndTriggers: boolean;
    levelWideOneTime: boolean;
    disabled: boolean;
    isWinCondition: boolean;
}

function Fez_ScriptReader(reader: ContentReader): Fez_Script {
    const name = reader.ReadString();
    const timeout = reader.ReadObject<number>()!;
    const triggers = reader.ReadObject<Fez_ScriptTrigger[]>()!;
    const conditions = reader.ReadObject<Fez_ScriptCondition[]>()!;
    const actions = reader.ReadObject<Fez_ScriptAction[]>()!;
    const oneTime = reader.ReadBoolean();
    const triggerless = reader.ReadBoolean();
    const ignoreEndTriggers = reader.ReadBoolean();
    const levelWideOneTime = reader.ReadBoolean();
    const disabled = reader.ReadBoolean();
    const isWinCondition = reader.ReadBoolean();
    return { name, timeout, triggers, conditions, actions, oneTime, triggerless, ignoreEndTriggers, levelWideOneTime, disabled, isWinCondition };
}

export interface Fez_ScriptTrigger {
    entity: Fez_Entity;
    event: string;
}

function Fez_ScriptTriggerReader(reader: ContentReader): Fez_ScriptTrigger {
    const entity = reader.ReadObject<Fez_Entity>()!;
    const event = reader.ReadString();
    return { entity, event };
}

export interface Fez_ScriptCondition {
    entity: Fez_Entity;
    operator: number;
    property: string;
    value: string;
}

function Fez_ScriptConditionReader(reader: ContentReader): Fez_ScriptCondition {
    const entity = reader.ReadObject<Fez_Entity>()!;
    const operator = reader.ReadObject<number>()!;
    const property = reader.ReadString();
    const value = reader.ReadString();
    return { entity, operator, property, value };
}

export interface Fez_ScriptAction {
    entity: Fez_Entity;
    operation: string;
    arguments: string[];
    killswitch: boolean;
    blocking: boolean;
}

function Fez_ScriptActionReader(reader: ContentReader): Fez_ScriptAction {
    const entity = reader.ReadObject<Fez_Entity>()!;
    const operation = reader.ReadString();
    const arguments_ = reader.ReadObject<string[]>()!;
    const killswitch = reader.ReadBoolean();
    const blocking = reader.ReadBoolean();
    return { entity, operation, arguments: arguments_, killswitch, blocking };
}

export interface Fez_Entity {
    entityType: string;
    identifier: number;
}

function Fez_EntityReader(reader: ContentReader): Fez_Entity {
    const entityType = reader.ReadString();
    const identifier = reader.ReadObject<number>()!;
    return { entityType, identifier };
}

export interface Fez_TrileInstance {
    position: vec3;
    trileID: number;
    orientation: number;
    actorSettings: Fez_InstanceActorSettings | null;
    overlappedTriles: Fez_TrileInstance[];
}

function Fez_TrileInstanceReader(reader: ContentReader): Fez_TrileInstance {
    const position = reader.ReadVector3();
    const trileID = reader.ReadInt32();
    const orientation = reader.ReadByte();
    const hasActorSettings = reader.ReadBoolean();
    let actorSettings: Fez_InstanceActorSettings | null = null;
    if (hasActorSettings)
        actorSettings = reader.ReadObject<Fez_InstanceActorSettings>();
    const overlappedTriles = reader.ReadObject<Fez_TrileInstance[]>()!;
    return { position, trileID, orientation, actorSettings, overlappedTriles };
}

export interface Fez_InstanceActorSettings {
    containedTrile: number | null;
    signText: string | null;
    sequence: boolean[];
    sequenceSampleName: string | null;
    sequenceAlternateSampleName: string | null;
    hostVolume: number | null;
}

function Fez_InstanceActorSettingsReader(reader: ContentReader): Fez_InstanceActorSettings {
    const containedTrile = reader.ReadObject<number>();
    const signText = reader.ReadObject<string>();
    const sequence = reader.ReadObject<boolean[]>()!;
    const sequenceSampleName = reader.ReadObject<string>();
    const sequenceAlternateSampleName = reader.ReadObject<string>();
    const hostVolume = reader.ReadObject<number>();
    return { containedTrile, signText, sequence, sequenceSampleName, sequenceAlternateSampleName, hostVolume };
}

export interface Fez_ArtObjectInstance {
    name: string;
    position: vec3;
    rotation: quat;
    scale: vec3;
    actorSettings: Fez_ArtObjectActorSettings | null;
}

function Fez_ArtObjectInstanceReader(reader: ContentReader): Fez_ArtObjectInstance {
    const name = reader.ReadString();
    const position = reader.ReadVector3();
    const rotation = reader.ReadQuaternion();
    const scale = reader.ReadVector3();
    const actorSettings = reader.ReadObject<Fez_ArtObjectActorSettings>();
    return { name, position, rotation, scale, actorSettings };
}

export interface Fez_ArtObjectActorSettings {
    inactive: boolean;
    containedTrile: number | null;
    attachedGroup: number | null;
    spinView: number;
    spinEvery: number;
    spinOffset: number;
    offCenter: boolean;
    rotationCenter: vec3;
    vibrationPattern: number[];
    codePattern: number[];
    segment: Fez_PathSegment | null;
    nextNode: number | null;
    destinationLevel: string | null;
    treasureMapName: string | null;
    invisibleSides: number[];
    timeSwitchWindBackSpeed: number;
}

function Fez_ArtObjectActorSettingsReader(reader: ContentReader): Fez_ArtObjectActorSettings {
    const inactive = reader.ReadBoolean();
    const containedTrile = reader.ReadObject<number>();
    const attachedGroup = reader.ReadObject<number>();
    const spinView = reader.ReadObject<number>()!;
    const spinEvery = reader.ReadSingle();
    const spinOffset = reader.ReadSingle();
    const offCenter = reader.ReadBoolean();
    const rotationCenter = reader.ReadVector3();
    const vibrationPattern = reader.ReadObject<number[]>()!;
    const codePattern = reader.ReadObject<number[]>()!;
    const segment = reader.ReadObject<Fez_PathSegment>();
    const nextNode = reader.ReadObject<number>();
    const destinationLevel = reader.ReadObject<string>();
    const treasureMapName = reader.ReadObject<string>();
    const invisibleSides = reader.ReadObject<number[]>()!;
    const timeSwitchWindBackSpeed = reader.ReadSingle();
    return {
        inactive, containedTrile, attachedGroup, spinView, spinEvery, spinOffset, offCenter, rotationCenter,
        vibrationPattern, codePattern, segment, nextNode, destinationLevel, treasureMapName, invisibleSides,
        timeSwitchWindBackSpeed,
    };
}

export interface Fez_BackgroundPlane {
    position: vec3;
    rotation: quat;
    scale: vec3;
    size: vec3;
    textureName: string;
    lightMap: boolean;
    allowOverbrightness: boolean;
    filter: Color;
    animated: boolean;
    doubleSided: boolean;
    opacity: number;
    attachedGroup: number | null;
    billboard: boolean;
    syncWithSamples: boolean;
    crosshatch: boolean;
    unknown: boolean;
    alwaysOnTop: boolean;
    fullbright: boolean;
    pixelatedLightmap: boolean;
    xTextureRepeat: boolean;
    yTextureRepeat: boolean;
    clampTexture: boolean;
    actorType: number | null;
    attachedPlane: number | null;
    parallaxFactor: number;
}

function Fez_BackgroundPlaneReader(reader: ContentReader): Fez_BackgroundPlane {
    const position = reader.ReadVector3();
    const rotation = reader.ReadQuaternion();
    const scale = reader.ReadVector3();
    const size = reader.ReadVector3();
    const textureName = reader.ReadString();
    const lightMap = reader.ReadBoolean();
    const allowOverbrightness = reader.ReadBoolean();
    const filter = reader.ReadColor();
    const animated = reader.ReadBoolean();
    const doubleSided = reader.ReadBoolean();
    const opacity = reader.ReadSingle();
    const attachedGroup = reader.ReadObject<number>();
    const billboard = reader.ReadBoolean();
    const syncWithSamples = reader.ReadBoolean();
    const crosshatch = reader.ReadBoolean();
    const unknown = reader.ReadBoolean();
    const alwaysOnTop = reader.ReadBoolean();
    const fullbright = reader.ReadBoolean();
    const pixelatedLightmap = reader.ReadBoolean();
    const xTextureRepeat = reader.ReadBoolean();
    const yTextureRepeat = reader.ReadBoolean();
    const clampTexture = reader.ReadBoolean();
    const actorType = reader.ReadObject<number>();
    const attachedPlane = reader.ReadObject<number>();
    const parallaxFactor = reader.ReadSingle();
    return {
        position, rotation, scale, size, textureName, lightMap, allowOverbrightness, filter, animated,
        doubleSided, opacity, attachedGroup, billboard, syncWithSamples, crosshatch, unknown, alwaysOnTop,
        fullbright, pixelatedLightmap, xTextureRepeat, yTextureRepeat, clampTexture, actorType, attachedPlane,
        parallaxFactor,
    };
}

export interface Fez_TrileGroup {
    triles: Fez_TrileInstance[];
    path: Fez_MovementPath | null;
    heavy: boolean;
    actorType: number | null;
    geyserOffset: number;
    geyserPauseFor: number;
    geyserLiftFor: number;
    geyserApexHeight: number;
    spinCenter: vec3;
    spinClockwise: boolean;
    spinFrequency: number;
    spinNeedsTriggering: boolean;
    spin180Degrees: boolean;
    fallOnRotate: boolean;
    spinOffset: number;
    associatedSound: string | null;
}

function Fez_TrileGroupReader(reader: ContentReader): Fez_TrileGroup {
    const triles = reader.ReadObject<Fez_TrileInstance[]>()!;
    const path = reader.ReadObject<Fez_MovementPath>();
    const heavy = reader.ReadBoolean();
    const actorType = reader.ReadObject<number>();
    const geyserOffset = reader.ReadSingle();
    const geyserPauseFor = reader.ReadSingle();
    const geyserLiftFor = reader.ReadSingle();
    const geyserApexHeight = reader.ReadSingle();
    const spinCenter = reader.ReadVector3();
    const spinClockwise = reader.ReadBoolean();
    const spinFrequency = reader.ReadSingle();
    const spinNeedsTriggering = reader.ReadBoolean();
    const spin180Degrees = reader.ReadBoolean();
    const fallOnRotate = reader.ReadBoolean();
    const spinOffset = reader.ReadSingle();
    const associatedSound = reader.ReadObject<string>();
    return {
        triles, path, heavy, actorType, geyserOffset, geyserPauseFor, geyserLiftFor, geyserApexHeight,
        spinCenter, spinClockwise, spinFrequency, spinNeedsTriggering, spin180Degrees, fallOnRotate,
        spinOffset, associatedSound,
    };
}

export interface Fez_MovementPath {
    segments: Fez_PathSegment[];
    needsTrigger: boolean;
    endBehavior: number | null;
    soundName: string | null;
    isSpline: boolean;
    offsetSeconds: number;
    saveTrigger: boolean;
}

function Fez_MovementPathReader(reader: ContentReader): Fez_MovementPath {
    const segments = reader.ReadObject<Fez_PathSegment[]>()!;
    const needsTrigger = reader.ReadBoolean();
    const endBehavior = reader.ReadObject<number>();
    const soundName = reader.ReadObject<string>();
    const isSpline = reader.ReadBoolean();
    const offsetSeconds = reader.ReadSingle();
    const saveTrigger = reader.ReadBoolean();
    return { segments, needsTrigger, endBehavior, soundName, isSpline, offsetSeconds, saveTrigger };
}

export interface Fez_PathSegment {
    destination: vec3;
    duration: number | null;
    waitTimeOnStart: number | null;
    waitTimeOnFinish: number | null;
    acceleration: number;
    deceleration: number;
    jitterFactor: number;
    orientation: quat;
    customData: Fez_CameraNodeData | null;
}

function Fez_PathSegmentReader(reader: ContentReader): Fez_PathSegment {
    const destination = reader.ReadVector3();
    const duration = reader.ReadObject<number>()!;
    const waitTimeOnStart = reader.ReadObject<number>()!;
    const waitTimeOnFinish = reader.ReadObject<number>()!;
    const acceleration = reader.ReadSingle();
    const deceleration = reader.ReadSingle();
    const jitterFactor = reader.ReadSingle();
    const orientation = reader.ReadQuaternion();
    const hasCustomData = reader.ReadBoolean();
    let customData: Fez_CameraNodeData | null = null;
    if (hasCustomData)
        customData = reader.ReadObject<Fez_CameraNodeData>();
    return { destination, duration, waitTimeOnStart, waitTimeOnFinish, acceleration, deceleration, jitterFactor, orientation, customData };
}

export interface Fez_NpcInstance {
    name: string;
    position: vec3;
    destinationOffset: vec3;
    walkSpeed: number;
    randomizeSpeech: boolean;
    sayFirstSpeechLineOnce: boolean;
    avoidsGomez: boolean;
    actorType: number;
    speech: Fez_SpeechLine[];
    actions: Map<number, Fez_NpcActionContent>;
}

function Fez_NpcInstanceReader(reader: ContentReader): Fez_NpcInstance {
    const name = reader.ReadString();
    const position = reader.ReadVector3();
    const destinationOffset = reader.ReadVector3();
    const walkSpeed = reader.ReadSingle();
    const randomizeSpeech = reader.ReadBoolean();
    const sayFirstSpeechLineOnce = reader.ReadBoolean();
    const avoidsGomez = reader.ReadBoolean();
    const actorType = reader.ReadObject<number>()!;
    const speech = reader.ReadObject<Fez_SpeechLine[]>()!;
    const actions = reader.ReadObject<Map<number, Fez_NpcActionContent>>()!;
    return { name, position, destinationOffset, walkSpeed, randomizeSpeech, sayFirstSpeechLineOnce, avoidsGomez, actorType, speech, actions };
}

export interface Fez_SpeechLine {
    text: string | null;
    overrideContent: Fez_NpcActionContent | null;
}

function Fez_SpeechLineReader(reader: ContentReader): Fez_SpeechLine {
    const text = reader.ReadObject<string>();
    const overrideContent = reader.ReadObject<Fez_NpcActionContent>();
    return { text, overrideContent };
}

export interface Fez_NpcActionContent {
    animationName: string | null;
    soundName: string | null;
}

function Fez_NpcActionContentReader(reader: ContentReader): Fez_NpcActionContent {
    const animationName = reader.ReadObject<string>();
    const soundName = reader.ReadObject<string>();
    return { animationName, soundName };
}

export interface Fez_AmbienceTrack {
    name: string;
    dawn: boolean;
    day: boolean;
    dusk: boolean;
    night: boolean;
}

function Fez_AmbienceTrackReader(reader: ContentReader): Fez_AmbienceTrack {
    const name = reader.ReadObject<string>()!;
    const dawn = reader.ReadBoolean();
    const day = reader.ReadBoolean();
    const dusk = reader.ReadBoolean();
    const night = reader.ReadBoolean();
    return { name, dawn, day, dusk, night };
}

export interface Fez_CameraNodeData {
    perspective: boolean;
    pixelsPerTrixel: number;
    soundName: string | null;
}

function Fez_CameraNodeDataReader(reader: ContentReader): Fez_CameraNodeData {
    const perspective = reader.ReadBoolean();
    const pixelsPerTrixel = reader.ReadInt32();
    const soundName = reader.ReadObject<string>();
    return { perspective, pixelsPerTrixel, soundName };
}

export interface Fez_Level {
    name: string;
    size: vec3;
    startingPosition: Fez_TrileFace | null;
    sequenceSamplesPath: string | null;
    flat: boolean;
    skipPostprocess: boolean;
    baseDiffuse: number;
    baseAmbient: number;
    gomezHaloName: string | null;
    haloFiltering: boolean;
    blinkingAlpha: boolean;
    loops: boolean;
    waterType: number | null;
    waterHeight: number;
    skyName: string;
    trileSetName: string;
    volumes: Map<number, Fez_Volume>;
    scripts: Map<number, Fez_Volume>;
    songName: string | null;
    fapFadeoutStart: number;
    fapFadeoutLength: number;
    triles: Map<vec3, Fez_TrileInstance>;
    artObjects: Map<number, Fez_ArtObjectInstance>;
    backgroundPlanes: Map<number, Fez_BackgroundPlane>;
    groups: Map<number, Fez_TrileGroup>;
    nonplayerCharacters: Map<number, Fez_NpcInstance>;
    paths: Map<number, Fez_MovementPath>;
    descending: boolean;
    rainy: boolean;
    lowPass: boolean;
    mutedLoops: string[];
    ambienceTracks: Fez_AmbienceTrack[];
    nodeType: number | null;
    quantum: boolean;
}

function Fez_LevelReader(reader: ContentReader): Fez_Level {
    const name = reader.ReadObject<string>()!;
    const size = reader.ReadVector3();
    const startingPosition = reader.ReadObject<Fez_TrileFace>();
    const sequenceSamplesPath = reader.ReadObject<string>();
    const flat = reader.ReadBoolean();
    const skipPostprocess = reader.ReadBoolean();
    const baseDiffuse = reader.ReadSingle();
    const baseAmbient = reader.ReadSingle();
    const gomezHaloName = reader.ReadObject<string>();
    const haloFiltering = reader.ReadBoolean();
    const blinkingAlpha = reader.ReadBoolean();
    const loops = reader.ReadBoolean();
    const waterType = reader.ReadObject<number>();
    const waterHeight = reader.ReadSingle();
    const skyName = reader.ReadString();
    const trileSetName = reader.ReadObject<string>()!;
    const volumes = reader.ReadObject<Map<number, Fez_Volume>>()!;
    const scripts = reader.ReadObject<Map<number, Fez_Volume>>()!;
    const songName = reader.ReadObject<string>();
    const fapFadeoutStart = reader.ReadInt32();
    const fapFadeoutLength = reader.ReadInt32();
    const triles = reader.ReadObject<Map<vec3, Fez_TrileInstance>>()!;
    const artObjects = reader.ReadObject<Map<number, Fez_ArtObjectInstance>>()!;
    const backgroundPlanes = reader.ReadObject<Map<number, Fez_BackgroundPlane>>()!;
    const groups = reader.ReadObject<Map<number, Fez_TrileGroup>>()!;
    const nonplayerCharacters = reader.ReadObject<Map<number, Fez_NpcInstance>>()!;
    const paths = reader.ReadObject<Map<number, Fez_MovementPath>>()!;
    const descending = reader.ReadBoolean();
    const rainy = reader.ReadBoolean();
    const lowPass = reader.ReadBoolean();
    const mutedLoops = reader.ReadObject<string[]>()!;
    const ambienceTracks = reader.ReadObject<Fez_AmbienceTrack[]>()!;
    const nodeType = reader.ReadObject<number>();
    const quantum = reader.ReadBoolean();
    return {
        name, size, startingPosition, sequenceSamplesPath, flat, skipPostprocess, baseDiffuse, baseAmbient,
        gomezHaloName, haloFiltering, blinkingAlpha, loops, waterType, waterHeight, skyName, trileSetName,
        volumes, scripts, songName, fapFadeoutStart, fapFadeoutLength, triles, artObjects, backgroundPlanes,
        groups, nonplayerCharacters, paths, descending, rainy, lowPass, mutedLoops, ambienceTracks, nodeType,
        quantum,
    };
}

export interface Fez_ShaderInstancedIndexedPrimitives<T> {
    primitiveType: XNA_PrimitiveType;
    vertices: T[];
    indices: number[];
}

function Fez_ShaderInstancedIndexedPrimitivesReader_Factory(typeReaders: ContentTypeReader[]): ContentTypeReader {
    return (reader: ContentReader): Fez_ShaderInstancedIndexedPrimitives<any> => {
        const primitiveType = reader.ReadObject<XNA_PrimitiveType>()!;
        const vertices = reader.ReadObject<any>()!;
        const indices = reader.ReadObject<number[]>()!;
        return { primitiveType, vertices, indices };
    };
}

const normals = [
    vec3.fromValues(-1, 0, 0),
    vec3.fromValues(0, -1, 0),
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(1, 0, 0),
    vec3.fromValues(0, 1, 0),
    vec3.fromValues(0, 0, 1),
];

export class FezContentTypeReaderManager extends ContentTypeReaderManager {
    constructor() {
        super();

        this.RegisterTypeReaderEnum('FezEngine.FaceOrientation');
        this.RegisterTypeReaderEnum('FezEngine.CollisionType');
        this.RegisterTypeReaderEnum('FezEngine.Structure.LiquidType');
        this.RegisterTypeReaderEnum('FezEngine.Structure.NpcAction');
        this.RegisterTypeReaderEnum('FezEngine.Structure.Input.CodeInput');
        this.RegisterTypeReaderEnum('FezEngine.Structure.Input.VibrationMotor');

        this.RegisterTypeReaderValueType(Fez_TrileEmplacementReader,
            'FezEngine.Structure.TrileEmplacement',
            'FezEngine.Readers.TrileEmplacementReader');
        this.RegisterTypeReaderValueType(Fez_VertexPositionNormalTextureInstanceReader,
            'FezEngine.Structure.Geometry.VertexPositionNormalTextureInstance',
            'FezEngine.Readers.VertexPositionNormalTextureInstanceReader');

        this.RegisterTypeReaderDirect(Fez_ArtObjectReader,
            'FezEngine.Structure.ArtObject',
            'FezEngine.Readers.ArtObjectReader');
        this.RegisterTypeReaderDirect(Fez_TrileSetReader,
            'FezEngine.Structure.TrileSet',
            'FezEngine.Readers.TrileSetReader');
        this.RegisterTypeReaderDirect(Fez_TrileReader,
            'FezEngine.Structure.Trile',
            'FezEngine.Readers.TrileReader');
        this.RegisterTypeReaderDirect(Fez_AnimatedTextureReader,
            'FezEngine.Structure.AnimatedTexture',
            'FezEngine.Readers.AnimatedTextureReader');
        this.RegisterTypeReaderDirect(Fez_FrameReader,
            'FezEngine.Content.FrameContent',
            'FezEngine.Readers.FrameReader');
        this.RegisterTypeReaderDirect(Fez_SkyReader,
            'FezEngine.Structure.Sky',
            'FezEngine.Readers.SkyReader');
        this.RegisterTypeReaderDirect(Fez_SkyLayerReader,
            'FezEngine.Structure.SkyLayer',
            'FezEngine.Readers.SkyLayerReader');
        this.RegisterTypeReaderDirect(Fez_TrileFaceReader,
            'FezEngine.Structure.TrileFace',
            'FezEngine.Readers.TrileFaceReader');
        this.RegisterTypeReaderDirect(Fez_VolumeReader,
            'FezEngine.Structure.Volume',
            'FezEngine.Readers.VolumeReader');
        this.RegisterTypeReaderDirect(Fez_VolumeActorSettingsReader,
            'FezEngine.Structure.VolumeActorSettings',
            'FezEngine.Readers.VolumeActorSettingsReader');
        this.RegisterTypeReaderDirect(Fez_DotDialogueLineReader,
            'FezEngine.Structure.DotDialogueLine',
            'FezEngine.Readers.DotDialogueLineReader');
        this.RegisterTypeReaderDirect(Fez_ScriptReader,
            'FezEngine.Structure.Scripting.Script',
            'FezEngine.Readers.ScriptReader');
        this.RegisterTypeReaderDirect(Fez_ScriptTriggerReader,
            'FezEngine.Structure.Scripting.ScriptTrigger',
            'FezEngine.Readers.ScriptTriggerReader');
        this.RegisterTypeReaderDirect(Fez_ScriptConditionReader,
            'FezEngine.Structure.Scripting.ScriptCondition',
            'FezEngine.Readers.ScriptConditionReader');
        this.RegisterTypeReaderDirect(Fez_ScriptActionReader,
            'FezEngine.Structure.Scripting.ScriptAction',
            'FezEngine.Readers.ScriptActionReader');
        this.RegisterTypeReaderDirect(Fez_EntityReader,
            'FezEngine.Structure.Scripting.Entity',
            'FezEngine.Readers.EntityReader');
        this.RegisterTypeReaderDirect(Fez_TrileInstanceReader,
            'FezEngine.Structure.TrileInstance',
            'FezEngine.Readers.TrileInstanceReader');
        this.RegisterTypeReaderDirect(Fez_InstanceActorSettingsReader,
            'FezEngine.Structure.InstanceActorSettings',
            'FezEngine.Readers.InstanceActorSettingsReader');
        this.RegisterTypeReaderDirect(Fez_ArtObjectInstanceReader,
            'FezEngine.Structure.ArtObjectInstance',
            'FezEngine.Readers.ArtObjectInstanceReader');
        this.RegisterTypeReaderDirect(Fez_ArtObjectActorSettingsReader,
            'FezEngine.Structure.ArtObjectActorSettings',
            'FezEngine.Readers.ArtObjectActorSettingsReader');
        this.RegisterTypeReaderDirect(Fez_BackgroundPlaneReader,
            'FezEngine.Structure.BackgroundPlane',
            'FezEngine.Readers.BackgroundPlaneReader');
        this.RegisterTypeReaderDirect(Fez_TrileGroupReader,
            'FezEngine.Structure.TrileGroup',
            'FezEngine.Readers.TrileGroupReader');
        this.RegisterTypeReaderDirect(Fez_MovementPathReader,
            'FezEngine.Structure.MovementPath',
            'FezEngine.Readers.MovementPathReader');
        this.RegisterTypeReaderDirect(Fez_PathSegmentReader,
            'FezEngine.Structure.PathSegment',
            'FezEngine.Readers.PathSegmentReader');
        this.RegisterTypeReaderDirect(Fez_NpcInstanceReader,
            'FezEngine.Structure.NpcInstance',
            'FezEngine.Readers.NpcInstanceReader');
        this.RegisterTypeReaderDirect(Fez_SpeechLineReader,
            'FezEngine.Structure.SpeechLine',
            'FezEngine.Readers.SpeechLineReader');
        this.RegisterTypeReaderDirect(Fez_NpcActionContentReader,
            'FezEngine.Structure.NpcActionContent',
            'FezEngine.Readers.NpcActionContentReader');
        this.RegisterTypeReaderDirect(Fez_AmbienceTrackReader,
            'FezEngine.Structure.AmbienceTrack',
            'FezEngine.Readers.AmbienceTrackReader');
        this.RegisterTypeReaderDirect(Fez_CameraNodeDataReader,
            'FezEngine.Structure.CameraNodeData',
            'FezEngine.Readers.CameraNodeDataReader');
        this.RegisterTypeReaderDirect(Fez_LevelReader,
            'FezEngine.Structure.Level',
            'FezEngine.Readers.LevelReader');

        this.RegisterTypeReaderGenericFactory(Fez_ShaderInstancedIndexedPrimitivesReader_Factory,
            'FezEngine.Structure.Geometry.ShaderInstancedIndexedPrimitives',
            'FezEngine.Readers.ShaderInstancedIndexedPrimitivesReader');
    }
}
