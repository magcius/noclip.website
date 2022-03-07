import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString, Slider, RadioButtons } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from './DebugJunk';
import { Blue, Color, Green, Red, Magenta, Cyan } from './Color';
import { StudioCameraController } from './Camera';
import { clamp, computeEulerAngleRotationFromSRTMatrix, getMatrixAxisZ, lerp, invlerp, Vec3UnitY, Vec3Zero } from './MathHelpers';
import { mat4, ReadonlyMat4, vec3, vec2 } from 'gl-matrix';
import { GlobalSaveManager } from './SaveManager';
import { getPointHermite } from './Spline';

export const CLAPBOARD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="20" fill="white"><path d="M61,22H14.51l3.41-.72h0l7.74-1.64,2-.43h0l6.85-1.46h0l1.17-.25,8.61-1.83h0l.78-.17,9-1.91h0l.4-.08L60,12.33a1,1,0,0,0,.77-1.19L59.3,4.3a1,1,0,0,0-1.19-.77l-19,4-1.56.33h0L28.91,9.74,27.79,10h0l-9.11,1.94-.67.14h0L3.34,15.17a1,1,0,0,0-.77,1.19L4,23.11V60a1,1,0,0,0,1,1H61a1,1,0,0,0,1-1V23A1,1,0,0,0,61,22ZM57,5.8l.65.6.89,4.19-1.45.31L52.6,6.75ZM47.27,7.88,51.8,12,47.36,13,42.82,8.83ZM37.48,10,42,14.11l-4.44.94L33,10.91ZM27.7,12l4.53,4.15-4.44.94L23.26,13Zm-9.78,2.08,4.53,4.15L18,19.21l-4.53-4.15ZM19.49,29H14.94l3.57-5h4.54Zm9-5h4.54l-3.57,5H24.94ZM39,45.88l-11,6A1,1,0,0,1,26.5,51V39A1,1,0,0,1,28,38.12l11,6a1,1,0,0,1,0,1.76ZM39.49,29H34.94l3.57-5h4.54Zm10,0H44.94l3.57-5h4.54ZM60,29H54.94l3.57-5H60Z"/></svg>`;
const UNDO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16"><g transform="translate(0,-952.36218)"><path overflow="visible" style="" d="m 39.999997,975.36218 -31.9999995,25.00002 31.9999995,25 0,-14 c 1.7024,-0.08 31.3771,-0.033 52.000005,18 -8.252999,-25.4273 -34.173805,-35.48722 -52.000005,-40.00002 z" fill="#ffffff" stroke="none"/></g></svg>`;
const REDO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16"><g transform="translate(0,-952.36218)"><path d="m 60,975.36216 32,24.99994 -32,25.0001 0,-12.0001 c -1.7024,-0.08 -31.3771,-2.0334 -52,16.0001 8.253,-25.4274 34.1738,-37.48724 52,-42.00004 z" style="" overflow="visible" fill="#ffffff" stroke="none"/></g></svg>`;
const ZOOM_OUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="white" viewBox="0 -110 700 700"><g><path d="m579.16 503.12-112.61-144.38c35.895-37.285 56.285-86.812 57.051-138.56 0.76172-51.75-18.156-101.86-52.934-140.18-34.777-38.332-82.812-62.02-134.39-66.277-51.578-4.2578-102.85 11.238-143.44 43.348-40.59 32.109-67.469 78.438-75.199 129.61-7.7305 51.172 4.2695 103.37 33.562 146.04 29.297 42.664 73.707 72.609 124.24 83.777 50.535 11.164 103.43 2.7188 147.97-23.629l112.44 144.11c4.5156 5.7656 11.145 9.4922 18.418 10.363 7.2734 0.87109 14.594-1.1914 20.344-5.7266 5.6758-4.5234 9.3359-11.105 10.188-18.316 0.85156-7.207-1.1758-14.461-5.6367-20.184zm-243.52-129.59c-43.453 4.6094-86.871-9.0391-119.87-37.688-33-28.645-52.613-69.715-54.152-113.39-1.543-43.668 15.133-86.02 46.031-116.92 30.898-30.898 73.246-47.57 116.92-46.031s84.742 21.152 113.39 54.152c28.648 33 42.297 76.414 37.684 119.87-3.8008 35.828-19.773 69.27-45.25 94.746-25.477 25.477-58.918 41.449-94.75 45.254z"/><path d="m226.19 194.43h186.64c12.469 0 22.574 12.445 22.574 22.531 0 12.445-10.105 22.531-22.574 22.531h-186.64c-12.469 0-22.574-12.445-22.574-22.531 0-12.445 10.105-22.531 22.574-22.531z"/></g></svg>`;
const ZOOM_IN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="white" viewBox="0 -110 700 700"><g><path d="m579.16 503.12-112.61-144.38c35.895-37.285 56.285-86.812 57.051-138.56 0.76172-51.75-18.156-101.86-52.934-140.18-34.777-38.332-82.812-62.02-134.39-66.277-51.578-4.2578-102.85 11.238-143.44 43.348-40.59 32.109-67.469 78.438-75.199 129.61-7.7305 51.172 4.2695 103.37 33.562 146.04 29.297 42.664 73.707 72.609 124.24 83.777 50.535 11.164 103.43 2.7188 147.97-23.629l112.44 144.11c4.5156 5.7656 11.145 9.4922 18.418 10.363 7.2734 0.87109 14.594-1.1914 20.344-5.7266 5.6758-4.5234 9.3359-11.105 10.188-18.316 0.85156-7.207-1.1758-14.461-5.6367-20.184zm-243.52-129.59c-43.453 4.6094-86.871-9.0391-119.87-37.688-33-28.645-52.613-69.715-54.152-113.39-1.543-43.668 15.133-86.02 46.031-116.92 30.898-30.898 73.246-47.57 116.92-46.031s84.742 21.152 113.39 54.152c28.648 33 42.297 76.414 37.684 119.87-3.8008 35.828-19.773 69.27-45.25 94.746-25.477 25.477-58.918 41.449-94.75 45.254z"/><path d="m401.45 202.91h-67.375v-69.215c0.3125-3.9648-1.0469-7.8789-3.7461-10.797-2.6992-2.9219-6.4961-4.582-10.473-4.582-3.9766 0-7.7734 1.6602-10.473 4.582-2.6992 2.918-4.0547 6.832-3.7461 10.797v69.211h-67.375v0.003906c-5.1562 0-9.9219 2.75-12.504 7.2188-2.5781 4.4648-2.5781 9.9688 0 14.438 2.582 4.4648 7.3477 7.2188 12.504 7.2188h67.375v69.211c0.58203 7.4219 6.7773 13.145 14.219 13.145 7.4453 0 13.637-5.7227 14.219-13.145v-69.211h67.375c5.1602 0 9.9258-2.7539 12.504-7.2188 2.5781-4.4688 2.5781-9.9727 0-14.438-2.5781-4.4688-7.3438-7.2188-12.504-7.2188z"/></g></svg>`;
const MILLISECONDS_IN_SECOND = 1000.0;
const MIN_ANIMATION_LENGTH_SEC = 1;
const MAX_ANIMATION_LENGTH_SEC = 300;
const MAX_ZOOM_LEVEL = 5;
const ZOOM_STEP = 0.25;

const enum InterpolationType {
    Ease,
    Linear,
    Hold
}

export interface Keyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
    interpInType: InterpolationType;
    interpOutType: InterpolationType;
    easeInCoeff: number;
    easeOutCoeff: number;
}

export class InterpolationStep {
    public pos: vec3 = vec3.create();
    public lookAtPos: vec3 = vec3.create();
    public bank: number = 0;
}

export interface CameraAnimation {
    posXTrack: KeyframeTrack;
    posYTrack: KeyframeTrack;
    posZTrack: KeyframeTrack;
    lookAtXTrack: KeyframeTrack;
    lookAtYTrack: KeyframeTrack;
    lookAtZTrack: KeyframeTrack;
    bankTrack: KeyframeTrack;
    loop: boolean;
}

const enum KeyframeTrackType {
    posXTrack    = 0b0000001,
    posYTrack    = 0b0000010,
    posZTrack    = 0b0000100,
    lookAtXTrack = 0b0001000,
    lookAtYTrack = 0b0010000,
    lookAtZTrack = 0b0100000,
    bankTrack    = 0b1000000,
    allTracks    = 0b1111111,
}

class KeyframeTrack {
    public keyframes: Keyframe[] = [];

    public addKeyframe(kf: Keyframe) {
        const nextKfIndex = this.getNextKeyframeIndexAtTime(kf.time);
        if (nextKfIndex === -1)
            this.keyframes.push(kf);
        else if (this.keyframes[nextKfIndex].time === kf.time)
            this.keyframes.splice(nextKfIndex, 1, kf);
        else
            this.keyframes.splice(nextKfIndex, 0, kf);
    }

    public getNextKeyframeIndexAtTime(t: number) {
        let nextKfIndex = -1;
        for (let i = 0; i < this.keyframes.length; i++) {
            if (t <= this.keyframes[i].time) {
                nextKfIndex = i;
                break;
            }
        }
        return nextKfIndex;
    }

    public setAllCatmullRomTangents(loop: boolean) {
        if (this.keyframes.length < 3 || loop && this.keyframes.length === 3) {
            for (const kf of this.keyframes) {
                kf.tangentIn = 0;
                kf.tangentOut = 0;
            }
            return;
        }

        if (loop) {
            // To properly calculate the speed scale value for the tangents on a looping animation,
            // we need the duration between the final keyframe position and the first. Keyframes use
            // absolute time values, so add the time value of the loop keyframe to the first and second
            // before calculating the tangents.
            const origTime = this.keyframes[1].time;
            this.keyframes[0].time += this.keyframes[this.keyframes.length - 1].time;
            this.keyframes[1].time += this.keyframes[this.keyframes.length - 1].time;
            this.setCatmullRomTangent(this.keyframes[this.keyframes.length - 2], this.keyframes[0], this.keyframes[1]);
            this.setCatmullRomTangent(this.keyframes[this.keyframes.length - 2], this.keyframes[this.keyframes.length - 1], this.keyframes[1]);
            this.keyframes[0].time = 0;
            this.keyframes[1].time = origTime;
        } else {
            this.setCatmullRomTangent(this.keyframes[0], this.keyframes[0], this.keyframes[1]);
            this.setCatmullRomTangent(this.keyframes[this.keyframes.length - 2], this.keyframes[this.keyframes.length - 1], this.keyframes[this.keyframes.length - 1]);
            this.keyframes[this.keyframes.length - 1].tangentOut = 0;
            this.keyframes[0].tangentIn = 0;
        }

        for (let i = 1; i < this.keyframes.length - 1; i++)
            this.setCatmullRomTangent(this.keyframes[i - 1], this.keyframes[i], this.keyframes[i + 1]);
    }

    // Speed scaling calculated as per Nils Pipenbrinck:
    // https://www.cubic.org/docs/hermite.htm - section "Speed Control".
    private setCatmullRomTangent(k0: Keyframe, k1: Keyframe, k2: Keyframe) {
        // Catmull-Rom tangent
        const val = (k2.value - k0.value) * 0.5;
        const prevDuration = k1.time - k0.time;
        const nextDuration = k2.time - k1.time;
        k1.tangentIn = k1.easeInCoeff * val * (2 * prevDuration) / (prevDuration + nextDuration);
        k1.tangentOut = k1.easeOutCoeff * val * (2 * nextDuration) / (prevDuration + nextDuration);
    }

    public setValue(kf: Keyframe, v: number) {
        const index = this.keyframes.indexOf(kf);
        if (index > -1)
            this.keyframes[index].value = v;
    }

    public reSort(): void {
        this.keyframes.sort((a, b) => a.time - b.time);
    }

}

/**
 * Enumeration describing keyframe icon types. Start keyframe icons are immovable. End keyframe icons only exist
 * in looping animations. End keyframes have the same values as the Start keyframes, and can be repositioned on
 * the timeline to change the speed or curve shape when moving from the last regular keyframe back to the start position.
 */
const enum KeyframeIconType {
    Default,
    Start,
    Loop_End,
};

class Playhead {
    static readonly WIDTH: number = 15;
    static readonly HALF_WIDTH: number = Playhead.WIDTH / 2;
    static readonly HEIGHT: number = 15;
    static readonly POINTER_HEIGHT: number = 10;
    static readonly COLOR: string = '#FF0000'

    constructor() {
        this.updatePath();
    }

    private x: number = 0;
    private t: number = 0;

    public playheadPath: Path2D;

    private updatePath() {
        this.playheadPath = new Path2D();
        this.playheadPath.moveTo(this.x, Playhead.HEIGHT + Playhead.POINTER_HEIGHT);
        this.playheadPath.lineTo(this.x - (Playhead.HALF_WIDTH), Playhead.HEIGHT);
        this.playheadPath.lineTo(this.x - (Playhead.HALF_WIDTH), 0);
        this.playheadPath.lineTo(this.x + (Playhead.HALF_WIDTH), 0);
        this.playheadPath.lineTo(this.x + (Playhead.HALF_WIDTH), Playhead.HEIGHT);
        this.playheadPath.moveTo(this.x, Playhead.HEIGHT + Playhead.POINTER_HEIGHT);
    }

    public draw(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = Playhead.COLOR;
        ctx.fill(this.playheadPath);
    }

    public drawLine(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.strokeStyle = Playhead.COLOR;
        ctx.lineWidth = 1.5;
        ctx.moveTo(this.x, Playhead.HEIGHT + Playhead.POINTER_HEIGHT - 1);
        ctx.lineTo(this.x, 85);
        ctx.stroke();
    }

    public updatePosition(x: number, t: number) {
        this.x = x;
        this.t = t;
        this.updatePath();
    }

    public getX(): number {
        return this.x;
    }

    public getT(): number {
        return this.t;
    }
}

class KeyframeIcon {
    static readonly SIDE_LENGTH: number = 10;
    static readonly HEIGHT = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH * 2);
    static readonly MIDLINE_HEIGHT = KeyframeIcon.HEIGHT / 3;
    static readonly MIDLINE_Y = (KeyframeIcon.HEIGHT / 2) - KeyframeIcon.MIDLINE_HEIGHT / 2;
    static readonly XY_DIST = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH / 2);
    static readonly COLOR: string = '#FFFFFF';
    static readonly SELECTED_COLOR: string = '#FF500B';
    static readonly ENDFRAME_COLOR: string = '#4EB0FF';

    constructor(public keyframesMap: Map<KeyframeTrackType, Keyframe>, private x: number, private y: number, private t: number, public type: KeyframeIconType) {
        this.updatePaths();
    }

    private displayPath = new Path2D();
    public selectionPath = new Path2D();
    public selected: boolean = false;

    public draw(ctx: CanvasRenderingContext2D) {
        if (this.selected)
            ctx.fillStyle = KeyframeIcon.SELECTED_COLOR;
        else if (this.type === KeyframeIconType.Loop_End || this.type === KeyframeIconType.Start)
            ctx.fillStyle = KeyframeIcon.ENDFRAME_COLOR;
        else
            ctx.fillStyle = KeyframeIcon.COLOR;
        ctx.fill(this.displayPath);
    }

    public updatePosition(x: number, t: number) {
        this.x = x;
        this.t = t;
        this.updatePaths();
        this.keyframesMap.forEach((k) => { k.time = t });
    }

    public getX(): number {
        return this.x;
    }

    public getY(): number {
        return this.y;
    }

    public getT(): number {
        return this.t;
    }

    public updatePaths() {
        this.displayPath = new Path2D();
        this.selectionPath = new Path2D();
        const kf = this.keyframesMap.values().next().value;
        const interpInType = kf.interpInType;
        const interpOutType = kf.interpOutType;
        
        if (interpInType === InterpolationType.Ease) {
            this.displayPath.moveTo(this.x, this.y);
            this.displayPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y + KeyframeIcon.XY_DIST);
            this.displayPath.lineTo(this.x, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x, this.y);
        } else if (interpInType === InterpolationType.Hold) {
            this.displayPath.moveTo(this.x - 2, this.y);
            this.displayPath.lineTo(this.x - 6, this.y);
            this.displayPath.lineTo(this.x - 6, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x - 2, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x - 2, this.y);
        } else if (interpInType === InterpolationType.Linear) {
            this.displayPath.moveTo(this.x, this.y + KeyframeIcon.MIDLINE_Y);
            this.displayPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y + KeyframeIcon.MIDLINE_Y);
            this.displayPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y + KeyframeIcon.MIDLINE_Y + KeyframeIcon.MIDLINE_HEIGHT);
            this.displayPath.lineTo(this.x, this.y + KeyframeIcon.MIDLINE_Y + KeyframeIcon.MIDLINE_HEIGHT);
            this.displayPath.lineTo(this.x, this.y + 3);
        }

        if (interpOutType === InterpolationType.Ease) {
            this.displayPath.moveTo(this.x, this.y);
            this.displayPath.lineTo(this.x, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y + KeyframeIcon.XY_DIST);
            this.displayPath.lineTo(this.x, this.y);
        } else if (interpOutType === InterpolationType.Hold) {
            this.displayPath.moveTo(this.x + 2, this.y);
            this.displayPath.lineTo(this.x + 6, this.y);
            this.displayPath.lineTo(this.x + 6, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x + 2, this.y + KeyframeIcon.HEIGHT);
            this.displayPath.lineTo(this.x + 2, this.y);
        } else if (interpOutType === InterpolationType.Linear) {
            this.displayPath.moveTo(this.x, this.y + KeyframeIcon.MIDLINE_Y);
            this.displayPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y + KeyframeIcon.MIDLINE_Y);
            this.displayPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y + KeyframeIcon.MIDLINE_Y + KeyframeIcon.MIDLINE_HEIGHT);
            this.displayPath.lineTo(this.x, this.y + KeyframeIcon.MIDLINE_Y + KeyframeIcon.MIDLINE_HEIGHT);
            this.displayPath.lineTo(this.x, this.y + 3);
        }

        this.selectionPath.moveTo(this.x - KeyframeIcon.XY_DIST, this.y);
        this.selectionPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y + KeyframeIcon.HEIGHT);
        this.selectionPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y + KeyframeIcon.HEIGHT);
        this.selectionPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y);
        this.selectionPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y);
    }
}

class Timeline {
    static readonly DEFAULT_LENGTH_MS = 30000;
    static readonly MIN_MARKER_WIDTH_PX: number = 50;
    static readonly MARKER_COLOR: string = '#f3f3f3';
    static readonly SELECTION_BOX_STROKE_COLOR: string = "#63BBFF";
    static readonly SELECTION_BOX_FILL_COLOR: string = "rgba(53, 77, 255, 0.4)";
    static readonly DEFAULT_SECONDS_PER_MARKER: number = 5;
    static readonly SNAP_DISTANCE_PX: number = 10;
    static readonly HEADER_HEIGHT: number = 25;
    static readonly TRACK_HEIGHT: number = 20;
    static readonly KEYFRAME_ICONS_BASE_Y_POS = Timeline.HEADER_HEIGHT + ((Timeline.TRACK_HEIGHT - KeyframeIcon.HEIGHT) * 0.5);

    constructor(private markersCtx: CanvasRenderingContext2D, private elementsCtx: CanvasRenderingContext2D, timelineLengthMs: number) {
        this.playhead = new Playhead();
        this.elementsCtx.restore();
        this.markersCtx.restore();
        this.elementsCtx.save();
        this.markersCtx.save();
        this.setupContexts();
        this.setScaleAndDrawMarkers(timelineLengthMs);
    }

    public setupContexts() {
        this.elementsCtx.translate(Playhead.HALF_WIDTH, 0);
        this.markersCtx.translate(Playhead.HALF_WIDTH, 0);
        this.markersCtx.strokeStyle = Timeline.MARKER_COLOR;
        this.markersCtx.fillStyle = Timeline.MARKER_COLOR;
    }

    private width: number;
    private height: number;
    private lengthMs: number;
    private timelineHeaderPath: Path2D;
    private playhead: Playhead;
    private pixelsPerSecond: number;
    private timelineScaleFactor: number = 1;
    private selectionBoxPath: Path2D = new Path2D();
    private selectionBoxStartVertex: vec2 = vec2.create();
    private selectionBoxEndVertex: vec2 = vec2.create();
    private selectionBoxActive: boolean = false;
    private selectionBoxIcons: KeyframeIcon[] = [];
    private grabbedIcon: KeyframeIcon | undefined = undefined;
    private grabbedIconInitialXPos: number = -1;
    public keyframeIcons: KeyframeIcon[] = [];
    public selectedKeyframeIcons: KeyframeIcon[] = [];
    public playheadGrabbed: boolean = false;
    public keyframeIconGrabbed: boolean = false;
    public snappingEnabled: boolean = false;
    public livePreview: boolean = false;

    // Calculates the scale and redraws the time markers when changing the width of the canvas, or the max time value on the timeline.
    public setScaleAndDrawMarkers(lengthMs?: number) {
        this.width = this.elementsCtx.canvas.width;
        this.height = this.elementsCtx.canvas.height;
        if (lengthMs)
            this.lengthMs = lengthMs;
        this.timelineHeaderPath = new Path2D();
        this.timelineHeaderPath.lineTo(this.width, 0);
        this.timelineHeaderPath.lineTo(this.width, Timeline.HEADER_HEIGHT);
        this.timelineHeaderPath.lineTo(0, Timeline.HEADER_HEIGHT);
        this.timelineHeaderPath.lineTo(0, 0);
        this.markersCtx.clearRect(-Playhead.HALF_WIDTH, 0, this.width, Timeline.HEADER_HEIGHT);
        let secondsPerMarker = Timeline.DEFAULT_SECONDS_PER_MARKER;
        let markerCount = (this.lengthMs / MILLISECONDS_IN_SECOND) / secondsPerMarker;
        this.pixelsPerSecond = ((this.width - Playhead.WIDTH) / markerCount) / (secondsPerMarker);
        if (this.width / markerCount < Timeline.MIN_MARKER_WIDTH_PX) {
            markerCount = this.width / Timeline.MIN_MARKER_WIDTH_PX;
            secondsPerMarker = (this.lengthMs / MILLISECONDS_IN_SECOND) / markerCount;
            this.timelineScaleFactor = secondsPerMarker / Timeline.DEFAULT_SECONDS_PER_MARKER;
            this.pixelsPerSecond *= this.timelineScaleFactor;
        } else {
            this.timelineScaleFactor = 1;
        }

        const totalMarkers = (markerCount * 5) + 1;

        this.markersCtx.beginPath();
        let x = 0;
        let labelSize = null;
        const halfMarkerHeight = Timeline.HEADER_HEIGHT / 1.5;
        const markerHeight = Timeline.HEADER_HEIGHT / 2;
        const labelHeight = markerHeight - 3;
        for (let i = 0; i < totalMarkers; i++) {
            x = Math.trunc(i * this.pixelsPerSecond);
            // We don't want to draw any markers past where the playhead can be placed.
            if (x > this.width - Playhead.WIDTH)
                break;
            this.markersCtx.moveTo(x, Timeline.HEADER_HEIGHT);
            if (i % 5 === 0) {
                this.markersCtx.lineTo(x, markerHeight);
                const label = (Math.trunc((i / 5) * secondsPerMarker)).toString();
                labelSize = this.markersCtx.measureText(label);
                this.markersCtx.fillText(label, x - (labelSize.width / 2), labelHeight);
            } else {
                this.markersCtx.lineTo(x, halfMarkerHeight);
            }
        }
        this.markersCtx.stroke();

        // Rescale keyframe icon positions
        for (const kfIcon of this.keyframeIcons) {
            const timeMs = kfIcon.keyframesMap.values().next().value.time;
            kfIcon.updatePosition((timeMs / MILLISECONDS_IN_SECOND) * (this.pixelsPerSecond / this.timelineScaleFactor), timeMs);
        }
        this.markersCtx.save();
    }

    public getTimelineLengthMs(): number {
        return this.lengthMs;
    }

    public getTimelineLengthSeconds(): string {
        return (this.lengthMs / MILLISECONDS_IN_SECOND).toFixed(2);
    }

    public draw() {
        this.elementsCtx.restore();
        this.elementsCtx.clearRect(-Playhead.WIDTH, 0, this.width + Playhead.WIDTH, this.height);
        this.playhead.draw(this.elementsCtx);
        for (const kfIcon of this.keyframeIcons) {
            kfIcon.draw(this.elementsCtx);
        }
        if (this.selectionBoxActive) {
            this.elementsCtx.fillStyle = Timeline.SELECTION_BOX_FILL_COLOR;
            this.elementsCtx.strokeStyle = Timeline.SELECTION_BOX_STROKE_COLOR;
            this.elementsCtx.beginPath();
            this.elementsCtx.fill(this.selectionBoxPath);
            this.elementsCtx.stroke(this.selectionBoxPath);
        }
        this.playhead.drawLine(this.elementsCtx);
        this.elementsCtx.save();
    }

    public addKeyframeIcon(kfs: Map<KeyframeTrackType, Keyframe>, t: number, y: number, type: KeyframeIconType, selectAfterAdd: boolean) {
        const xPos = (t / MILLISECONDS_IN_SECOND) * (this.pixelsPerSecond / this.timelineScaleFactor);
        const kfIcon = new KeyframeIcon(kfs, xPos, y, t, type);
        this.keyframeIcons.push(kfIcon);
        this.keyframeIcons.sort((a, b) => a.getX() - b.getX());
        if (selectAfterAdd) {
            this.deselectAllKeyframeIcons();
            this.selectKeyframeIcon(kfIcon);
        }
    }

    public deleteSelectedKeyframeIcons() {
        if (!this.selectedKeyframeIcons.length)
            return;

        for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
            const index = this.keyframeIcons.indexOf(this.selectedKeyframeIcons[i]);

            if (index === -1 || this.keyframeIcons[index].type !== KeyframeIconType.Default)
                continue;
    
            this.keyframeIcons.splice(index, 1);
        }
        this.deselectAllKeyframeIcons();
    }

    public deleteEndframeIcons() {
        while (this.keyframeIcons[this.keyframeIcons.length - 1].type === KeyframeIconType.Loop_End) {
            this.keyframeIcons.pop();
        }
    }

    public onMouseDown(e: MouseEvent) {
        e.stopPropagation();
        // Check if click landed on playhead, or the part of the timeline where markers are displayed
        if (this.elementsCtx.isPointInPath(this.playhead.playheadPath, e.offsetX, e.offsetY) ||
            this.elementsCtx.isPointInPath(this.timelineHeaderPath, e.offsetX, e.offsetY)) {
            this.playheadGrabbed = true;
            this.deselectAllKeyframeIcons();
            this.onMouseMove(e);
            return;
        }
        // Check if click landed on a currently-selected keyframe icon
        let selectedIconClicked = false;
        for (const kfIcon of this.selectedKeyframeIcons) {
            if (kfIcon.type !== KeyframeIconType.Start
                && this.elementsCtx.isPointInPath(kfIcon.selectionPath, e.offsetX, e.offsetY)) {
                selectedIconClicked = true;
                if (e.ctrlKey) {
                    this.deselectKeyframeIcon(kfIcon);
                } else {
                    this.keyframeIconGrabbed = true;
                    this.grabbedIcon = kfIcon;
                    this.grabbedIconInitialXPos = kfIcon.getX();
                }
                break;
            }
        }
        if (!selectedIconClicked) {
            // Check if click landed on any keyframe icon.
            for (const kfIcon of this.keyframeIcons) {
                if (this.elementsCtx.isPointInPath(kfIcon.selectionPath, e.offsetX, e.offsetY)) {
                    if (!e.ctrlKey)
                        this.deselectAllKeyframeIcons();
                    this.selectKeyframeIcon(kfIcon);
                    this.keyframeIconGrabbed = true;
                    this.grabbedIcon = kfIcon;
                    this.grabbedIconInitialXPos = kfIcon.getX();
                    break;
                }
            }
            if (!this.keyframeIconGrabbed) {
                if (!e.ctrlKey)
                    this.deselectAllKeyframeIcons();
                this.selectionBoxActive = true;
                this.selectionBoxStartVertex[0] = e.offsetX - Playhead.HALF_WIDTH;
                this.selectionBoxStartVertex[1] = e.offsetY;
                this.selectionBoxPath = new Path2D();
            }
        }
        this.draw();
    }

    public onMouseUp() {
        this.playheadGrabbed = false;
        this.keyframeIconGrabbed = false;
        this.selectionBoxActive = false;
        this.selectionBoxIcons = [];
        this.grabbedIcon = undefined;
        this.grabbedIconInitialXPos = -1;
        this.draw();
    }

    public onMouseMove(e: MouseEvent) {
        if ((!this.playheadGrabbed && !this.keyframeIconGrabbed && !this.selectionBoxActive)
            || (this.keyframeIconGrabbed && this.selectedKeyframeIcons.some((icon) => icon.type === KeyframeIconType.Start)))
            return;

        let targetX = e.offsetX;
        if (e.target !== this.elementsCtx.canvas)
            targetX = e.clientX - this.elementsCtx.canvas.getBoundingClientRect().x;

        targetX = clamp(targetX, Playhead.HALF_WIDTH, this.width - Playhead.HALF_WIDTH);
        targetX -= Playhead.HALF_WIDTH;

        const snappingEnabled = this.snappingEnabled || e.shiftKey;

        if (this.playheadGrabbed) {
            const snapKfIndex = this.getClosestSnappingIconIndex(targetX);
            this.deselectAllKeyframeIcons();
            if (snapKfIndex > -1) {
                if (snappingEnabled)
                    targetX = this.keyframeIcons[snapKfIndex].getX();

                // If the playhead is directly on a keyframe, highlight it.
                if (targetX === this.keyframeIcons[snapKfIndex].getX())
                    this.selectKeyframeIcon(this.keyframeIcons[snapKfIndex]);
            }

            const t = targetX / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
            this.playhead.updatePosition(targetX, t);
        } else if (this.keyframeIconGrabbed && this.selectedKeyframeIcons.length) {
            if (this.selectedKeyframeIcons.length === 1) {
                // Don't allow a loop keyframe icon to be moved before any other keyframes.
                if (this.selectedKeyframeIcons[0].type === KeyframeIconType.Loop_End)
                    targetX = clamp(targetX, this.keyframeIcons[this.keyframeIcons.length - 2].getX() + Timeline.SNAP_DISTANCE_PX, this.width - Playhead.HALF_WIDTH);
                else if (this.keyframeIcons[this.keyframeIcons.length - 1].type === KeyframeIconType.Loop_End)
                    targetX = clamp(targetX, this.keyframeIcons[0].getX() + Timeline.SNAP_DISTANCE_PX, this.keyframeIcons[this.keyframeIcons.length - 1].getX() - Timeline.SNAP_DISTANCE_PX);
                if (snappingEnabled && Math.abs(targetX - this.playhead.getX()) < Timeline.SNAP_DISTANCE_PX)
                    this.updateKeyframeIconPosition(this.selectedKeyframeIcons[0], this.playhead.getX());
                else
                    this.updateKeyframeIconPosition(this.selectedKeyframeIcons[0], targetX);
            } else {
                // Moving multiple icons. Check if moving all of them will cause
                // any of them to be in an illegal position.
                if (this.canMoveGroupTo(targetX)) {
                    const grabbedX = this.grabbedIcon!.getX();
                    for (const kfIcon of this.selectedKeyframeIcons) {
                        this.updateKeyframeIconPosition(kfIcon, targetX + (kfIcon.getX() - grabbedX));
                    }
                }
            }
        } else if (this.selectionBoxActive) {
            this.selectionBoxEndVertex[0] = e.offsetX - Playhead.HALF_WIDTH;
            this.selectionBoxEndVertex[1] = e.offsetY;
            if (e.target !== this.elementsCtx.canvas) {
                this.selectionBoxEndVertex[0] = e.clientX - this.elementsCtx.canvas.getBoundingClientRect().x - Playhead.HALF_WIDTH;
                this.selectionBoxEndVertex[1] = e.clientY - this.elementsCtx.canvas.getBoundingClientRect().y;
            }
            this.selectionBoxPath = new Path2D();
            this.selectionBoxPath.moveTo(this.selectionBoxStartVertex[0], this.selectionBoxStartVertex[1]);
            this.selectionBoxPath.lineTo(this.selectionBoxEndVertex[0], this.selectionBoxStartVertex[1]);
            this.selectionBoxPath.lineTo(this.selectionBoxEndVertex[0], this.selectionBoxEndVertex[1]);
            this.selectionBoxPath.lineTo(this.selectionBoxStartVertex[0], this.selectionBoxEndVertex[1]);
            this.selectionBoxPath.closePath();
            for (const kfIcon of this.keyframeIcons) {
                const kfInBox = this.elementsCtx.isPointInPath(this.selectionBoxPath, kfIcon.getX() + KeyframeIcon.XY_DIST, kfIcon.getY() + KeyframeIcon.XY_DIST)
                                || this.elementsCtx.isPointInPath(this.selectionBoxPath, kfIcon.getX() + KeyframeIcon.XY_DIST / 2, kfIcon.getY() + KeyframeIcon.XY_DIST / 2)
                                || this.elementsCtx.isPointInPath(this.selectionBoxPath, kfIcon.getX() + KeyframeIcon.XY_DIST / 2, kfIcon.getY() + KeyframeIcon.XY_DIST * 3 / 2)
                                || this.elementsCtx.isPointInPath(this.selectionBoxPath, kfIcon.getX() + KeyframeIcon.XY_DIST * 3 / 2, kfIcon.getY() + KeyframeIcon.XY_DIST / 2)
                                || this.elementsCtx.isPointInPath(this.selectionBoxPath, kfIcon.getX() + KeyframeIcon.XY_DIST * 3 / 2, kfIcon.getY() + KeyframeIcon.XY_DIST * 3 / 2);
                if (e.ctrlKey) {
                    // When the control key is held, toggle the selection state of any icons we add/remove.
                    if (kfInBox) {
                        if (!this.selectionBoxIcons.includes(kfIcon)) {
                            this.selectionBoxIcons.push(kfIcon);
                            if (kfIcon.selected)
                                this.deselectKeyframeIcon(kfIcon);
                            else
                                this.selectKeyframeIcon(kfIcon);
                        }
                    } else if (this.selectionBoxIcons.includes(kfIcon)) {
                        this.selectionBoxIcons.splice(this.selectionBoxIcons.indexOf(kfIcon), 1);
                        if (kfIcon.selected)
                            this.deselectKeyframeIcon(kfIcon);
                        else
                            this.selectKeyframeIcon(kfIcon);
                    }
                } else {
                    if (kfInBox) {
                        if (!this.selectionBoxIcons.includes(kfIcon)) {
                            this.selectionBoxIcons.push(kfIcon);
                            this.selectKeyframeIcon(kfIcon);
                        }
                    } else if (this.selectionBoxIcons.includes(kfIcon)) {
                        this.selectionBoxIcons.splice(this.selectionBoxIcons.indexOf(kfIcon), 1);
                        this.deselectKeyframeIcon(kfIcon);
                    }
                }
                
            }
        }

        this.draw();
    }

    /**
     * Checks if the currently-selected group of keyframes can be moved to the target position.
     * targetX refers to the position of the keyframe icon that the user is currently clicking.
     * The positions of the other selected keyframes are determined as offsets from this position.
     */
    private canMoveGroupTo(targetX: number): boolean {
        const grabbedIconX = this.grabbedIcon!.getX();
        for (const selectedIcon of this.selectedKeyframeIcons) {
            if (selectedIcon.type === KeyframeIconType.Start)
                return false;
            const diffFromGrabbed = selectedIcon.getX() - grabbedIconX;
            const newX = targetX + diffFromGrabbed;
            // Check this new position against all non-selected keyframe icons.
            // If any of the new positions is inside a non-selected icon's snapping
            // range, or results in any keyframe moving past a loop keyframe icon,
            // prevent the update.
            for (const kfIcon of this.keyframeIcons) {
                if (kfIcon.selected)
                    continue;
                if (newX < Timeline.SNAP_DISTANCE_PX
                    || (newX > kfIcon.getX() - Timeline.SNAP_DISTANCE_PX
                        && newX < kfIcon.getX() + Timeline.SNAP_DISTANCE_PX)
                    || (kfIcon.type === KeyframeIconType.Loop_End
                        && newX > kfIcon.getX() - Timeline.SNAP_DISTANCE_PX)
                    || (newX > this.width - Playhead.HALF_WIDTH)
                    || (selectedIcon.type === KeyframeIconType.Loop_End 
                        && newX < kfIcon.getX() + Timeline.SNAP_DISTANCE_PX))
                    return false;
            }
        }
        return true;
    }

    public hasGrabbedIconMoved(): boolean {
        if (!this.selectedKeyframeIcons.length || !this.grabbedIcon)
            return false;
        return this.keyframeIconGrabbed
          && this.grabbedIconInitialXPos !== -1
          && this.grabbedIconInitialXPos !== this.grabbedIcon.getX();
    }

    private selectKeyframeIcon(kfIcon: KeyframeIcon) {
        if (this.selectedKeyframeIcons.includes(kfIcon))
            return;
        kfIcon.selected = true;
        this.selectedKeyframeIcons.push(kfIcon);
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeSelected', { bubbles: false }));
    }
    
    private deselectKeyframeIcon(kfIcon: KeyframeIcon) {
        this.selectedKeyframeIcons.splice(this.selectedKeyframeIcons.indexOf(kfIcon), 1);
        kfIcon.selected = false;
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeDeselected', { bubbles: false }));
    }

    public deselectAllKeyframeIcons() {
        for (const kfIcon of this.selectedKeyframeIcons) {
            kfIcon.selected = false;
        }
        this.selectedKeyframeIcons = [];
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeDeselected', { bubbles: false }));
    }

    private ensureIconDistance(v: number, c: number, r: number): number {
        if (v <= Timeline.SNAP_DISTANCE_PX)
            return Timeline.SNAP_DISTANCE_PX;
        else if (v < c || c + r > this.width - Playhead.WIDTH)
            return Math.min(v, c - r);
        else
            return Math.max(v, c + r);
    }

    private updateKeyframeIconPosition(icon: KeyframeIcon, x: number) {
        const snapKfIndex = this.getClosestSnappingIconIndex(x);
        if (snapKfIndex > -1) {
            x = this.ensureIconDistance(x, this.keyframeIcons[snapKfIndex].getX(), Timeline.SNAP_DISTANCE_PX);
        }
        const t = x / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
        icon.updatePosition(x, t);
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeIconMovedEvent', { bubbles: false }));
    }

    /**
     * Returns the index of the closest icon within snapping distance, or -1 if there are no icons that can be snapped to.
     */
    private getClosestSnappingIconIndex(x: number): number {
        let closestDist = Timeline.SNAP_DISTANCE_PX;
        let snapKfIndex = -1;
        for (let i = 0; i < this.keyframeIcons.length && closestDist > 0; i++) {
            // If we're moving a keyframe icon, don't check distance against itself.
            // TODO - will have to check only against icons on the same track when multi-track editor is added.
            if (this.keyframeIconGrabbed && this.keyframeIcons[i].selected)
                continue;
            const dist = Math.abs(x - this.keyframeIcons[i].getX());
            if (dist < closestDist) {
                snapKfIndex = i;
                closestDist = dist;
            }
        }
        return snapKfIndex;
    }

    public setPlayheadTimeSeconds(t: number, animationPlaying: boolean) {
        const x = t * this.pixelsPerSecond / this.timelineScaleFactor;
        this.playhead.updatePosition(x, t * MILLISECONDS_IN_SECOND);
        if (!animationPlaying) {
            this.deselectAllKeyframeIcons();
            const snapKfIndex = this.getClosestSnappingIconIndex(x);
            if (snapKfIndex > -1 && x === this.keyframeIcons[snapKfIndex].getX()) {
                // If the playhead is directly on a keyframe, highlight it.
                this.selectKeyframeIcon(this.keyframeIcons[snapKfIndex]);
            }
        }
        this.draw();
    }

    public jumpToNextKeyframe() {
        const curT = this.playhead.getT();
        for (let i = 1; i < this.keyframeIcons.length; i++) {
            if (curT < this.keyframeIcons[i].getT()) {
                const jumpIcon = this.keyframeIcons[i];
                this.deselectAllKeyframeIcons();
                this.playhead.updatePosition(jumpIcon.getX(), jumpIcon.getT());
                this.selectKeyframeIcon(jumpIcon);
                break;
            }
        }
        this.draw();
    }

    public jumpToPreviousKeyframe() {
        const curT = this.playhead.getT();
        for (let i = this.keyframeIcons.length - 1; i > -1; i--) {
            if (curT > this.keyframeIcons[i].getT()) {
                const jumpIcon = this.keyframeIcons[i];
                this.deselectAllKeyframeIcons();
                this.playhead.updatePosition(jumpIcon.getX(), jumpIcon.getT());
                this.selectKeyframeIcon(jumpIcon);
                break;
            }
        }
        this.draw();
    }

    /**
     * Return the playhead time in milliseconds, for logic purposes.
     */
    public getPlayheadTimeMs(): number {
        return this.playhead.getT();
    }

    /**
     * Return the playhead time rounded in seconds, for display purposes.
     */
    public getPlayheadTimeSeconds(): string {
        return (this.playhead.getT() / MILLISECONDS_IN_SECOND).toFixed(2);
    }

    public getPlayheadX(): number {
        return this.playhead.getX();
    }

    public getLastKeyframeTimeMs(): number {
        return Math.max(...this.keyframeIcons.map((k) => { return k.keyframesMap.values().next().value.time }));
    }

    public getLastKeyframeTimeSeconds(): string {
        return (this.getLastKeyframeTimeMs() * MILLISECONDS_IN_SECOND).toFixed(2);
    }

    public playheadIsOnIcon(): boolean {
        for (const kfIcon of this.keyframeIcons) {
            if (this.playhead.getX() === kfIcon.getX())
                return true;
        }
        return false;
    }
}

export class CameraAnimationManager {
    // The animation to play back.
    private animation: Readonly<CameraAnimation>;
    private elapsedTimeMs: number;

    // The animation's duration.
    public durationMs: number;


    private findKeyframe(frames: Readonly<Keyframe[]>, time: number): number {
        for (let i = 0; i < frames.length; i++)
            if (time < frames[i].time)
                return i;
        return -1;
    }

    private calcTrackDuration(track: Readonly<KeyframeTrack>): number {
        // Assume it's sorted.
        if (track.keyframes.length > 0)
            return track.keyframes[track.keyframes.length - 1].time;
        else
            return 0;
    }

    private calcAnimationDuration(animation: Readonly<CameraAnimation>): number {
        let duration = 0;
        duration = Math.max(duration, this.calcTrackDuration(animation.posXTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.posYTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.posZTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.lookAtXTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.lookAtYTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.lookAtZTrack));
        duration = Math.max(duration, this.calcTrackDuration(animation.bankTrack));
        return duration;
    }

    private getCurrentTrackValue(track: KeyframeTrack, time: number): number {
        const idx1 = this.findKeyframe(track.keyframes, time);
        if (idx1 === 0)
            return track.keyframes[0].value;
        if (idx1 < 0)
            return track.keyframes[track.keyframes.length - 1].value;

        const idx0 = idx1 - 1;
        const k0 = track.keyframes[idx0], k1 = track.keyframes[idx1];

        const t = invlerp(k0.time, k1.time, time);
        
        let interpType;
        if (t < 0.5)
            interpType = k0.interpOutType;
        else
            interpType = k1.interpInType;
        
        if (interpType === InterpolationType.Ease)
            return getPointHermite(k0.value, k1.value, k0.tangentOut, k1.tangentIn, t);
        else if (interpType === InterpolationType.Linear)
            return lerp(k0.value, k1.value, t);
        else if (interpType === InterpolationType.Hold)
            return k0.value;
        else
            throw "whoops";
    }

    private calcAnimationPose(dst: InterpolationStep, animation: Readonly<CameraAnimation>, time: number): void {
        const posX = this.getCurrentTrackValue(animation.posXTrack, time);
        const posY = this.getCurrentTrackValue(animation.posYTrack, time);
        const posZ = this.getCurrentTrackValue(animation.posZTrack, time);
        const lookAtX = this.getCurrentTrackValue(animation.lookAtXTrack, time);
        const lookAtY = this.getCurrentTrackValue(animation.lookAtYTrack, time);
        const lookAtZ = this.getCurrentTrackValue(animation.lookAtZTrack, time);
        vec3.set(dst.pos, posX, posY, posZ);
        vec3.set(dst.lookAtPos, lookAtX, lookAtY, lookAtZ);
        dst.bank = this.getCurrentTrackValue(animation.bankTrack, time);
    }

    public initAnimationPlayback(animation: Readonly<CameraAnimation>, startTimeMs: number) {
        this.animation = animation;
        this.elapsedTimeMs = startTimeMs;
        this.durationMs = this.calcAnimationDuration(animation);
    }

    public setElapsedTime(t: number): void {
        this.elapsedTimeMs = t;

        if (this.animation.loop)
            this.elapsedTimeMs = this.elapsedTimeMs % this.durationMs;
    }

    public updateElapsedTime(dt: number): void {
        this.setElapsedTime(this.elapsedTimeMs + dt);
    }

    public getAnimFrame(outInterpStep: InterpolationStep, time: number = this.elapsedTimeMs) {
        this.calcAnimationPose(outInterpStep, this.animation, time);
    }

    public isAnimationFinished(): boolean {
        return !this.animation.loop && this.elapsedTimeMs >= this.durationMs;
    }

    public getElapsedTimeSeconds(): number {
        return this.elapsedTimeMs / MILLISECONDS_IN_SECOND;
    }
}

interface StudioState {
    animation: CameraAnimation;
    timelineLengthMs: number;
}

export class StudioPanel extends FloatingPanel {
    private animationManager: CameraAnimationManager;
    public studioCameraController: StudioCameraController;

    private animation: CameraAnimation;
    private studioStates: StudioState[] = [];
    private currentStateIndex: number = -1;
    public animationPreviewSteps: InterpolationStep[] = [];

    private studioPanelContents: HTMLElement;
    private studioHelpText: HTMLElement;

    private undoRedoBtnContainer: HTMLElement;
    private undoBtn: HTMLButtonElement;
    private redoBtn: HTMLButtonElement;

    private studioDataTabBtn: HTMLButtonElement;
    private optionsTabBtn: HTMLButtonElement;
    private newAnimationBtn: HTMLButtonElement;
    private loadAnimationBtn: HTMLButtonElement;
    private saveAnimationBtn: HTMLButtonElement;
    private importAnimationBtn: HTMLButtonElement;
    private exportAnimationBtn: HTMLButtonElement;

    private studioControlsContainer: HTMLElement;

    private timeLineContainerElement: HTMLElement;
    private timelineControlsContainer: HTMLElement;
    private snapBtn: HTMLButtonElement;
    private playheadTimePositionInput: HTMLInputElement;
    private timelineLengthInput: HTMLInputElement;

    private timelineMarkersCanvas: HTMLCanvasElement;
    private timelineElementsCanvas: HTMLCanvasElement;

    private keyframeControlsDock: HTMLElement;
    private keyframeControlsContents: HTMLElement;
    private valuesTabBtn: HTMLButtonElement;
    private interpTabBtn: HTMLButtonElement;
    private selectKeyframeMsg: HTMLElement;
    private editKeyframeWithCamBtn: HTMLButtonElement;

    private interpolationTab: HTMLElement;
    private interpInTypeBtns: RadioButtons;
    private interpOutTypeBtns: RadioButtons;
    private easeInSlider: Slider;
    private easeOutSlider: Slider;

    private customValuesContainer: HTMLElement;
    private posXValueInputContainer: HTMLElement;
    private posYValueInputContainer: HTMLElement;
    private posZValueInputContainer: HTMLElement;
    private lookAtXValueInputContainer: HTMLElement;
    private lookAtYValueInputContainer: HTMLElement;
    private lookAtZValueInputContainer: HTMLElement;
    private bankValueInputContainer: HTMLElement;
    private posXValueInput: HTMLInputElement;
    private posYValueInput: HTMLInputElement;
    private posZValueInput: HTMLInputElement;
    private lookAtXValueInput: HTMLInputElement;
    private lookAtYValueInput: HTMLInputElement;
    private lookAtZValueInput: HTMLInputElement;
    private bankValueInput: HTMLInputElement;
    private lockPerspectiveBracket: HTMLElement;
    private lockPerspectiveDiv: HTMLElement;
    private lockPerspectiveBtn: HTMLButtonElement;
    private lockPerspective: boolean = true;

    private editingKeyframe: boolean = false;
    private persistHelpText: boolean = false;

    public timeline: Timeline;
    private selectedTracks: number = KeyframeTrackType.allTracks;

    private zoomLevel: number = 1;
    private zoomOutBtn: HTMLButtonElement;
    private zoomInBtn: HTMLButtonElement;

    private previewOptionsContainer: HTMLElement;
    private showPreviewLineCheckbox: Checkbox;
    private livePreviewCheckbox: Checkbox;

    private loopAnimationBtn: HTMLButtonElement;
    private playAnimationBtn: HTMLButtonElement;
    private stopAnimationBtn: HTMLButtonElement;
    private prevKeyframeBtn: HTMLButtonElement;
    private nextKeyframeBtn: HTMLButtonElement;

    private scratchVec: vec3 = vec3.create();
    private scratchVecUp: vec3 = vec3.create();
    private scratchMat: mat4 = mat4.create();
    private previewLineColor: Color = Magenta;
    private previewLineLookAtColor: Color = Blue;
    private previewLineYAxisColor: Color = Green;
    private previewLineKfDotColor: Color = Cyan;
    private previewLineKfDotSelectedColor: Color = Red;

    private selectedNumericInput: HTMLInputElement | undefined;

    constructor(private ui: UI, private viewer: Viewer.Viewer) {
        super();

        this.mainPanel.parentElement!.style.minWidth = '100%';
        this.mainPanel.parentElement!.style.height = '350px';
        this.mainPanel.parentElement!.style.left = '0px';
        this.mainPanel.parentElement!.style.bottom = '0px';
        this.mainPanel.parentElement!.style.top = '';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 1)';
        this.mainPanel.style.height = '100%';
        // Closing the panel will be done by disabling studio mode
        this.closeButton.style.display = 'none';
        this.header.ondblclick = null;
        this.header.onmousedown = null;

        this.elem.onmouseover = () => {
            this.elem.style.opacity = '1';
        };
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.8';
        };

        this.elem.id = 'studioPanel';
        this.elem.style.display = 'none';
        this.elem.style.zIndex = '1';
        this.elem.style.opacity = '0.8';
        this.elem.style.userSelect = 'none';

        this.contents.style.maxHeight = '';
        this.contents.style.overflow = '';
        this.contents.style.height='100%';
        this.setTitle(CLAPBOARD_ICON, 'Studio');
        this.contents.insertAdjacentHTML('beforeend', `
        <div id="studioPanelContents" hidden></div>
        `);
        this.contents.style.lineHeight = '36px';
        this.studioPanelContents = this.contents.querySelector('#studioPanelContents') as HTMLElement;

        this.setWidth('100%');
    }

    public show(): void {
        this.elem.style.display = '';
        const bBar = document.querySelector('#BottomBar') as HTMLElement;
        if (bBar) {
            bBar.dataset.ob = bBar.style.bottom;
            bBar.style.bottom = (this.elem.getBoundingClientRect().height + 24) + 'px';
        }
        document.addEventListener('keydown', this.handleGlobalInput);
    }

    public hide(): void {
        this.elem.style.display = 'none';
        const bBar = document.querySelector('#BottomBar') as HTMLElement;
        if (bBar && bBar.dataset.ob) {
            bBar.style.bottom = bBar.dataset.ob;
        }
        document.removeEventListener('keydown', this.handleGlobalInput);
    }

    public initStudio(): void {
        if (this.studioPanelContents.children.length)
            return;

        this.animationManager = new CameraAnimationManager();
        this.studioCameraController = new StudioCameraController(this.animationManager, this);

        this.studioPanelContents.insertAdjacentHTML('afterbegin', `
        <style>
            #studioPanel {
                font: 16px monospace;
                color: #fefefe;
            }
            #studioPanel .disabled,
            .SettingsButton.disabled {
                cursor: not-allowed!important;
                opacity: 0.5;
            }
            #studioPanelContents {
                height: 100%;
                display: grid;
                grid-auto-flow: column;
                grid-template-columns: 1fr 4fr 1fr;
            }
            #studioPanel select {
                background: #000;
                border-radius: 5px;
                margin-right: 1rem;
                padding: 3px 0;
                font: 16px monospace;
                color: #fefefe;
            }
            #undoRedoBtnContainer .SettingsButton,
            #saveAnimationBtn {
                width: 5rem;
            }
            #studioSaveLoadControls {
                width: 85%;
                margin: auto;
            }
            #studioHelpText {
                line-height: 1.5;
                min-height: 1rem;
                text-align: center;
            }
            #studioPanel small {
                line-height: 1.7;
                font-size: 12px;
            }
            #trackLabels {
                margin: 25px 0 0 10px;
            }
            .label-container {
                display: flex;
                align-items: center;
                justify-content: flex-end;
            }
            .label-col {
                display: flex;
                flex-direction: column;
                margin-left: 0.5rem;
                align-content: flex-end;
                text-align: right;
            }
            #timelineContainer {
                padding: 0 15px;
                margin-bottom: 10px;
                overflow: auto hidden;
                position: relative;
                height: 225px;
                flex: 1;
            }
            #timelineContainer > canvas {
                position: absolute;
            }
            #timelineContainer > div {
                position: absolute;
                left: 5px;
                right: 15px;
            }
            #timelineHeaderBg {
                height: ${Timeline.HEADER_HEIGHT}px;
                background: linear-gradient(#494949, #2f2f2f);
                z-index: 2;
            }
            #timelineTracksBg {
                position: absolute;
                height: ${Timeline.TRACK_HEIGHT}px;
                top: ${Timeline.HEADER_HEIGHT}px;
                background: repeating-linear-gradient(#494949, #494949 20px, #2f2f2f 20px, #2f2f2f 40px);
                z-index: 1;
            }
            #timelineMarkersCanvas {
                z-index: 3;
            }
            #timelineElementsCanvas {
                z-index: 4;
            }
            #timelineControlsContainer {
                display: grid;
                grid-gap: 12px;
                grid-auto-flow: column;
                justify-content: space-between;
                margin: 5px 32px;
            }
            #zoomControls {
                display: grid;
                grid-gap: 10px;
                grid-template-columns: 3rem 3rem;
            }
            #keyframeControlsDock {
                min-width: 360px;
                line-height: 1.2;
                border-left: 2px dotted #696969;
                padding: 0 0.5rem;
            }
            #keyframeControls input {
                background: #000;
                font-weight: bold;
                border: 1px solid #444444;
                font: 16px monospace;
                color: #fefefe;
            }
            .KeyframeSettingsName {
                margin-top: 0.5rem;
                margin-bottom: 0.25rem;
            }
            .StudioNumericInput {
                width: 4rem;
                background: #000;
                height: 1.5rem;
                border-radius: 5px;
                font: 16px monospace;
                color: #fefefe;
            }
            #customValuesContainer {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                text-align: center;
            }
            #customValuesContainer .StudioNumericInput {
                width: 5rem;
            }
            #lockPerspective {
                grid-column-start: 1;
                grid-column-end: 3;
                position: relative;
            }
            #lockPerspectiveBracket {
                grid-column-start: 1;
                grid-column-end: 3;
                margin: -10px 16px 0 16px;
                height: 20px;
                border-bottom: 1px solid #ffffff;
                border-radius: 20px;
                margin-bottom: 0.7rem;
                position: relative;
            }
            #lockPerspectiveBracket::after {
                content: '\\25BC';
                position: absolute;
                left: 50%;
                transform: translate(-50%, 15px);
                margin: auto;
            }
            #interpolationTab {
                margin: 0.5rem;
            }
            #interpolationTab > div {
                margin: 0 0.75rem 0.5rem;
            }
            .SettingsButton.IconButton {
                width: 36px;
                height: 36px;
                padding: 0 0 0 0.05rem;
                line-height: 2.4;
            }
            #playbackControls {
                display: grid;
                grid-gap: 1rem;
                grid-template-columns: 3rem 10rem 3rem;
            }
        </style>
        <div style="padding: 0.5rem; border-right: 2px dotted #696969">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <div id="undoRedoBtnContainer" hidden>
                    <button type="button" id="undoBtn" class="SettingsButton disabled" disabled></button>
                    <button type="button" id="redoBtn" class="SettingsButton disabled" disabled></button>
                </div>
                <button type="button" id="saveAnimationBtn" class="SettingsButton" hidden>Save</button>
            </div>
            <div style="display: flex;">
                <button id="studioDataTabBtn" class="SettingsButton TabBtn" data-tab-group="StudioPanelTab" data-target="#studioSaveLoadControls">📁</button>
                <button id="optionsTabBtn" class="SettingsButton TabBtn" data-tab-group="StudioPanelTab" data-target="#optionsTab">⚙</button>
            </div>
            <div>
                <div id="studioSaveLoadControls" class="StudioPanelTab" hidden>
                    <div style="display: grid;grid-template-columns: 1fr 1fr; gap: 0.25rem 1rem; margin-top: 0.5rem;">
                        <button type="button" id="newAnimationBtn" class="SettingsButton">New</button>
                        <button type="button" id="loadAnimationBtn" class="SettingsButton">Load</button>
                        <button type="button" id="importAnimationBtn" class="SettingsButton">Import</button>
                        <button type="button" id="exportAnimationBtn" class="SettingsButton">Export</button>
                    </div>
                </div>
                <div id="optionsTab" class="StudioPanelTab" hidden>
                    <div id="previewOptionsContainer">
                        <div style="text-align: center;">Preview Options</div>
                    </div>
                </div>
            </div>
        </div>
        <div>
            <div id="studioHelpText"></div>
            <div id="studioControlsContainer" hidden>
                <div id="timelineControlsContainer">
                    <div id="zoomControls">
                        <button type="button" id="zoomOutBtn" class="SettingsButton disabled" disabled></button>
                        <button type="button" id="zoomInBtn" class="SettingsButton"></button>
                    </div>
                    <div id="playbackControls">
                        <button type="button" id="prevKeyframeBtn" class="SettingsButton">«</button>
                        <button type="button" id="playAnimationBtn" class="SettingsButton">▶</button>
                        <button type="button" id="stopAnimationBtn" class="SettingsButton" hidden>■</button>
                        <button type="button" id="nextKeyframeBtn" class="SettingsButton">»</button>
                    </div>
                    <div>
                        <input id="playheadTimePositionInput" class="StudioNumericInput" type="number" min="0" max="300" step="0.1" value="0"><span>/</span>
                        <input id="timelineLengthInput" class="StudioNumericInput" type="number" min="1" max="300" step="0.1" value="${Timeline.DEFAULT_LENGTH_MS / MILLISECONDS_IN_SECOND}"><span>s</span>
                        <button type="button" id="loopAnimationBtn" title="Loop" class="SettingsButton IconButton">🔁</button>
                        <button type="button" id="snapBtn" title="Snap" class="SettingsButton IconButton">🧲</button>
                    </div>
                </div>
                <div style="display: flex;">
                    <div id="trackLabels">
                        <div id="positionLookAtBankLabels" hidden>
                            <div class="label-col">
                                <small>Position</small>
                                <small>LookAt</small>
                                <small>Bank</small>
                            </div>
                        </div>
                        <div id="fullLabels" hidden>
                            <div class="label-container">
                                <span>Position</span>
                                <div class="label-col">
                                    <small>X</small>
                                    <small>Y</small>
                                    <small>Z</small>
                                </div>
                            </div>
                            <div class="label-container">
                                <span>LookAt</span>
                                <div class="label-col">
                                    <small>X</small>
                                    <small>Y</small>
                                    <small>Z</small>
                                </div>
                            </div>
                            <div class="label-container">
                                <small>Bank</small>
                            </div>
                        </div>
                    </div>
                    <div id="timelineContainer">
                        <div id="timelineHeaderBg"></div>
                        <div id="timelineTracksBg"></div>
                        <canvas id="timelineMarkersCanvas" width="1000" height="${Timeline.HEADER_HEIGHT}"></canvas>
                        <canvas id="timelineElementsCanvas" width="1000" height="${Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT}" tabindex="-1"></canvas>
                    </div>
                </div>
            </div>
        </div>
        <div id="keyframeControlsDock" hidden>
            <div style="text-align: center; border-bottom: 1px solid #696969;">Keyframe Settings</div>
            <div id="selectKeyframeMsg" style="text-align: center;">Select a keyframe.</div>
            <div id="keyframeControlsContents" hidden>
                <div style="display: flex;">
                    <button id="valuesTabBtn" class="SettingsButton TabBtn" data-tab-group="KeyframeControlsTab" data-target="#valuesTab">Values</button>
                    <button id="interpTabBtn" class="SettingsButton TabBtn" data-tab-group="KeyframeControlsTab" data-target="#interpolationTab">Interpolation</button>
                </div>
                <div>
                    <div id="valuesTab" class="KeyframeControlsTab">
                        <div style="width: 33%;margin: 0.5rem auto;">
                            <button type="button" id="editKeyframeWithCamBtn" class="SettingsButton">Re-Place Keyframe</button>
                        </div>
                        <div id="customValuesContainer">
                            <div>
                                <div id="posXValueInputContainer"><span>X Position:</span> <input id="posXValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                <div id="posYValueInputContainer"><span>Y Position:</span> <input id="posYValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                <div id="posZValueInputContainer"><span>Z Position:</span> <input id="posZValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                            </div>
                            <div>
                                <div id="lookAtXValueInputContainer"><span>LookAt X:</span> <input id="lookAtXValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                <div id="lookAtYValueInputContainer"><span>LookAt Y:</span> <input id="lookAtYValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                <div id="lookAtZValueInputContainer"><span>LookAt Z:</span> <input id="lookAtZValueInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                            </div>
                            <div id="bankValueInputContainer">
                                <span>Bank rotation:</span> <input id="bankValueInput" class="StudioNumericInput" type="number" step="0.01" value="0">
                            </div>
                            <div id="lockPerspectiveBracket" hidden></div>
                            <div id="lockPerspective" hidden>
                                <button id="lockPerspectiveBtn" class="SettingsButton IconButton">🔒</button>
                                <span style="position: absolute; white-space: nowrap; top: 9px; margin-left: 0.2rem;">Lock Perspective</span>
                            </div>
                        </div>
                    </div>
                    <div id="interpolationTab" class="KeyframeControlsTab" hidden>
                    </div>
                </div>
            </div>
        </div>`);
        this.studioHelpText = this.contents.querySelector('#studioHelpText') as HTMLElement;
        this.studioHelpText.dataset.startPosHelpText = 'Move the camera to the desired starting position and press Enter.';
        this.studioHelpText.dataset.editPosHelpText = 'Move the camera to the desired position and press Enter. Press Escape to cancel.';
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.studioHelpText.innerText = this.studioHelpText.dataset.startPosHelpText;

        this.undoRedoBtnContainer = this.contents.querySelector('#undoRedoBtnContainer') as HTMLElement;
        this.undoBtn = this.contents.querySelector('#undoBtn') as HTMLButtonElement;
        this.undoBtn.onclick = () => this.undo();
        this.undoBtn.insertAdjacentElement('afterbegin', createDOMFromString(UNDO_ICON).querySelector('svg')!);
        this.redoBtn = this.contents.querySelector('#redoBtn') as HTMLButtonElement;
        this.redoBtn.onclick = () => this.redo();
        this.redoBtn.insertAdjacentElement('afterbegin', createDOMFromString(REDO_ICON).querySelector('svg')!);

        this.studioDataTabBtn = this.contents.querySelector('#studioDataTabBtn') as HTMLButtonElement;
        this.studioDataTabBtn.title = 'Save the current animation, or load a previously-saved animation.';
        this.optionsTabBtn = this.contents.querySelector('#optionsTabBtn') as HTMLButtonElement;
        this.optionsTabBtn.title = 'Options';

        this.newAnimationBtn = this.contents.querySelector('#newAnimationBtn') as HTMLButtonElement;
        this.newAnimationBtn.title = 'Clear the current keyframes and create a new animation.';

        this.loadAnimationBtn = this.contents.querySelector('#loadAnimationBtn') as HTMLButtonElement;
        this.loadAnimationBtn.title = 'Load the previously-saved animation for this map. Overwrites the current keyframes!';

        this.saveAnimationBtn = this.contents.querySelector('#saveAnimationBtn') as HTMLButtonElement;
        this.saveAnimationBtn.title = 'Save the current animation for this map to your browser\'s local storage.';

        this.importAnimationBtn = this.contents.querySelector('#importAnimationBtn') as HTMLButtonElement;
        this.importAnimationBtn.title = 'Load an animation from a JSON file.';

        this.exportAnimationBtn = this.contents.querySelector('#exportAnimationBtn') as HTMLButtonElement;
        this.exportAnimationBtn.title = 'Save the current animation as a JSON file.';

        this.studioControlsContainer = this.contents.querySelector('#studioControlsContainer') as HTMLElement;

        this.timeLineContainerElement = this.contents.querySelector('#timelineContainer') as HTMLElement;
        this.timelineControlsContainer = this.contents.querySelector('#timelineControlsContainer') as HTMLElement;

        this.timelineMarkersCanvas = this.contents.querySelector('#timelineMarkersCanvas') as HTMLCanvasElement;
        this.timelineElementsCanvas = this.contents.querySelector('#timelineElementsCanvas') as HTMLCanvasElement;

        const markersCtx = this.timelineMarkersCanvas.getContext('2d') as CanvasRenderingContext2D;
        const elementsCtx = this.timelineElementsCanvas.getContext('2d') as CanvasRenderingContext2D;
        this.timeline = new Timeline(markersCtx, elementsCtx, Timeline.DEFAULT_LENGTH_MS);

        this.snapBtn = this.contents.querySelector('#snapBtn') as HTMLButtonElement;
        this.snapBtn.onclick = () => {
            this.timeline.snappingEnabled = !this.timeline.snappingEnabled;
            setElementHighlighted(this.snapBtn, this.timeline.snappingEnabled);
        };
        this.snapBtn.title = 'Snap keyframes to the playhead, and vice-versa.';
        setElementHighlighted(this.snapBtn, this.timeline.snappingEnabled);

        this.playheadTimePositionInput = this.contents.querySelector('#playheadTimePositionInput') as HTMLInputElement;
        this.playheadTimePositionInput.dataset.prevValue = this.playheadTimePositionInput.value;
        this.playheadTimePositionInput.onfocus = () => {
            this.playheadTimePositionInput.dataset.prevValue = this.playheadTimePositionInput.value;
        }
        this.playheadTimePositionInput.onchange = () => {
            let timePosValue = parseFloat(this.playheadTimePositionInput.value);
            if (Number.isNaN(timePosValue)) {
                this.playheadTimePositionInput.value = this.playheadTimePositionInput.dataset.prevValue!.toString();
                return;
            } else if (this.playheadTimePositionInput.value === this.playheadTimePositionInput.dataset.prevValue!.toString()) {
                return;
            } else {
                timePosValue = clamp(timePosValue, 0, this.timeline.getTimelineLengthMs() / MILLISECONDS_IN_SECOND);
                this.playheadTimePositionInput.value = timePosValue.toString();
            }

            this.timeline.setPlayheadTimeSeconds(timePosValue, this.studioCameraController.isAnimationPlaying);
            this.playheadTimePositionInput.dataset.prevValue = timePosValue.toString();

            if (!this.studioCameraController.isAnimationPlaying && this.timeline.livePreview)
                this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
        }

        this.timelineLengthInput = this.contents.querySelector('#timelineLengthInput') as HTMLInputElement;
        this.timelineLengthInput.dataset.prevValue = this.timelineLengthInput.value;
        this.timelineLengthInput.onfocus = () => {
            this.timelineLengthInput.dataset.prevValue = this.timelineLengthInput.value;
        }
        this.timelineLengthInput.onchange = () => {
            let lengthVal = parseFloat(this.timelineLengthInput.value)
            if (Number.isNaN(lengthVal)) {
                this.timelineLengthInput.value = this.timelineLengthInput.dataset.prevValue!.toString();
                return;
            } else {
                lengthVal = clamp(lengthVal, Math.max(MIN_ANIMATION_LENGTH_SEC, this.timeline.getLastKeyframeTimeMs() / MILLISECONDS_IN_SECOND), MAX_ANIMATION_LENGTH_SEC);
                this.timelineLengthInput.value = lengthVal.toString();
            }

            this.timeline.setScaleAndDrawMarkers(lengthVal * MILLISECONDS_IN_SECOND);
            this.timelineLengthInput.dataset.prevValue = this.timelineLengthInput.value;

            this.onTimelineScaleChanged(lengthVal);
        };

        this.loopAnimationBtn = this.contents.querySelector('#loopAnimationBtn') as HTMLButtonElement;
        this.loopAnimationBtn.title = 'Loop the animation until manually stopped.';
        this.loopAnimationBtn.onclick = () => {
            this.animation.loop = !this.animation.loop;
            setElementHighlighted(this.loopAnimationBtn, this.animation.loop);
            if (this.animation.loop) {
                this.addLoopEndFrames();
            } else {
                this.animation.posXTrack.keyframes.pop();
                this.animation.posYTrack.keyframes.pop();
                this.animation.posZTrack.keyframes.pop();
                this.animation.lookAtXTrack.keyframes.pop();
                this.animation.lookAtYTrack.keyframes.pop();
                this.animation.lookAtZTrack.keyframes.pop();
                this.animation.bankTrack.keyframes.pop();
                this.timeline.deleteEndframeIcons();
            }
            this.updatePreviewSteps();
            this.timeline.draw();
        };
        setElementHighlighted(this.loopAnimationBtn, false);

        this.keyframeControlsDock = this.contents.querySelector('#keyframeControlsDock') as HTMLElement;
        this.keyframeControlsContents = this.contents.querySelector('#keyframeControlsContents') as HTMLElement;
        this.valuesTabBtn = this.contents.querySelector('#valuesTabBtn') as HTMLButtonElement;
        this.interpTabBtn = this.contents.querySelector('#interpTabBtn') as HTMLButtonElement;
        
        this.valuesTabBtn.addEventListener('click', this.onTabBtnClick);
        this.interpTabBtn.addEventListener('click', this.onTabBtnClick);
        setElementHighlighted(this.valuesTabBtn, true);
        setElementHighlighted(this.interpTabBtn, false);

        this.selectKeyframeMsg = this.contents.querySelector('#selectKeyframeMsg') as HTMLElement;

        this.editKeyframeWithCamBtn = this.contents.querySelector('#editKeyframeWithCamBtn') as HTMLButtonElement;
        this.editKeyframeWithCamBtn.title = 'Edit the camera position represented by this keyframe.';
        setElementHighlighted(this.editKeyframeWithCamBtn, false);
        this.editKeyframeWithCamBtn.onclick = () => { this.beginEditKeyframePosition(); };

        this.interpolationTab = this.contents.querySelector('#interpolationTab') as HTMLElement;

        this.customValuesContainer = this.contents.querySelector('#customValuesContainer') as HTMLElement;
        this.posXValueInputContainer = this.contents.querySelector('#posXValueInputContainer') as HTMLElement;
        this.posYValueInputContainer = this.contents.querySelector('#posYValueInputContainer') as HTMLElement;
        this.posZValueInputContainer = this.contents.querySelector('#posZValueInputContainer') as HTMLElement;
        this.lookAtXValueInputContainer = this.contents.querySelector('#lookAtXValueInputContainer') as HTMLElement;
        this.lookAtYValueInputContainer = this.contents.querySelector('#lookAtYValueInputContainer') as HTMLElement;
        this.lookAtZValueInputContainer = this.contents.querySelector('#lookAtZValueInputContainer') as HTMLElement;
        this.bankValueInputContainer = this.contents.querySelector('#bankValueInputContainer') as HTMLElement;
        this.posXValueInput = this.contents.querySelector('#posXValueInput') as HTMLInputElement;
        this.posXValueInput.dataset.track = KeyframeTrackType.posXTrack.toString();
        this.posYValueInput = this.contents.querySelector('#posYValueInput') as HTMLInputElement;
        this.posYValueInput.dataset.track = KeyframeTrackType.posYTrack.toString();
        this.posZValueInput = this.contents.querySelector('#posZValueInput') as HTMLInputElement;
        this.posZValueInput.dataset.track = KeyframeTrackType.posZTrack.toString();
        this.lookAtXValueInput = this.contents.querySelector('#lookAtXValueInput') as HTMLInputElement;
        this.lookAtXValueInput.dataset.track = KeyframeTrackType.lookAtXTrack.toString();
        this.lookAtYValueInput = this.contents.querySelector('#lookAtYValueInput') as HTMLInputElement;
        this.lookAtYValueInput.dataset.track = KeyframeTrackType.lookAtYTrack.toString();
        this.lookAtZValueInput = this.contents.querySelector('#lookAtZValueInput') as HTMLInputElement;
        this.lookAtZValueInput.dataset.track = KeyframeTrackType.lookAtZTrack.toString();
        this.bankValueInput = this.contents.querySelector('#bankValueInput') as HTMLInputElement;
        this.bankValueInput.dataset.track = KeyframeTrackType.bankTrack.toString();

        this.lockPerspectiveDiv = this.contents.querySelector('#lockPerspective') as HTMLElement;
        this.lockPerspectiveBracket = this.contents.querySelector('#lockPerspectiveBracket') as HTMLElement;
        this.lockPerspectiveBtn = this.contents.querySelector('#lockPerspectiveBtn') as HTMLButtonElement;
        this.lockPerspectiveBtn.title = 'Maintain this keyframe\'s rotation when modifying its position.'
        this.lockPerspectiveBtn.onclick = () => {
            this.lockPerspective = !this.lockPerspective;
            setElementHighlighted(this.lockPerspectiveBtn, this.lockPerspective);
        }
        setElementHighlighted(this.lockPerspectiveBtn, this.lockPerspective);

        this.interpInTypeBtns = new RadioButtons('Interpolation In', ['Ease', 'Linear', 'Hold']);
        this.interpInTypeBtns.onselectedchange = () => {
            if (this.interpInTypeBtns.selectedIndex !== InterpolationType.Ease)
                this.easeInSlider.elem.style.display = 'none';
            else
                this.easeInSlider.elem.style.display = 'grid';

            if (this.interpInTypeBtns.selectedIndex === -1)
                return;

            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf) => {
                        kf.interpInType = this.interpInTypeBtns.selectedIndex;
                    });
                    kfIcon.updatePaths();
                    let linkedKfIcon = undefined;
                    if (this.animation.loop) {
                        if (kfIcon.type === KeyframeIconType.Loop_End)
                            linkedKfIcon = this.timeline.keyframeIcons[0];
                        else if (kfIcon.type === KeyframeIconType.Start)
                            linkedKfIcon = this.timeline.keyframeIcons[this.timeline.keyframeIcons.length - 1];
                        // TODO - multi-track
                    }
                    if (linkedKfIcon) {
                        linkedKfIcon.keyframesMap.forEach((kf) => {
                            kf.interpInType = this.interpInTypeBtns.selectedIndex;
                        });
                        linkedKfIcon.updatePaths();
                    }
                }
                this.timeline.draw();
                this.updatePreviewSteps();
            }
        };
        this.interpolationTab.appendChild(this.interpInTypeBtns.elem);
        this.interpOutTypeBtns = new RadioButtons('Interpolation Out', ['Ease', 'Linear', 'Hold']);
        this.interpOutTypeBtns.onselectedchange = () => {
            if (this.interpOutTypeBtns.selectedIndex !== InterpolationType.Ease)
                this.easeOutSlider.elem.style.display = 'none';
            else
                this.easeOutSlider.elem.style.display = 'grid';

            if (this.interpOutTypeBtns.selectedIndex === -1)
                return;

            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf) => {
                        kf.interpOutType = this.interpOutTypeBtns.selectedIndex;
                    });
                    kfIcon.updatePaths();
                    let linkedKfIcon = undefined;
                    if (this.animation.loop) {
                        if (kfIcon.type === KeyframeIconType.Loop_End)
                            linkedKfIcon = this.timeline.keyframeIcons[0];
                        else if (kfIcon.type === KeyframeIconType.Start)
                            linkedKfIcon = this.timeline.keyframeIcons[this.timeline.keyframeIcons.length - 1];
                        // TODO - multi-track
                    }
                    if (linkedKfIcon) {
                        linkedKfIcon.keyframesMap.forEach((kf) => {
                            kf.interpOutType = this.interpOutTypeBtns.selectedIndex;
                        });
                        linkedKfIcon.updatePaths();
                    }
                }
                this.timeline.draw();
                this.updatePreviewSteps();
            }
        };
        this.interpolationTab.appendChild(this.interpOutTypeBtns.elem);

        this.easeInSlider = new Slider();
        this.easeInSlider.setLabel("Ease In Amount");
        this.easeInSlider.setRange(0, 1);
        this.easeInSlider.setValue(1);
        this.easeInSlider.onvalue = (value) => {
            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf) => {
                        kf.easeInCoeff = value;
                    });
                    let linkedKfIcon = undefined;
                    if (this.animation.loop) {
                        if (kfIcon.type === KeyframeIconType.Loop_End)
                            linkedKfIcon = this.timeline.keyframeIcons[0];
                        else if (kfIcon.type === KeyframeIconType.Start)
                            linkedKfIcon = this.timeline.keyframeIcons[this.timeline.keyframeIcons.length - 1];
                        // TODO - multi-track
                    }
                    if (linkedKfIcon) {
                        linkedKfIcon.keyframesMap.forEach((kf) => {
                            kf.easeInCoeff = value;
                        });
                    }
                }
                this.updatePreviewSteps();
            }
        };
        this.interpolationTab.appendChild(this.easeInSlider.elem);

        this.easeOutSlider = new Slider();
        this.easeOutSlider.setLabel("Ease Out Amount");
        this.easeOutSlider.setRange(0, 1);
        this.easeOutSlider.setValue(1);
        this.easeOutSlider.onvalue = (value) => {
            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf) => {
                        kf.easeOutCoeff = value;
                    });
                    let linkedKfIcon = undefined;
                    if (this.animation.loop) {
                        if (kfIcon.type === KeyframeIconType.Loop_End)
                            linkedKfIcon = this.timeline.keyframeIcons[0];
                        else if (kfIcon.type === KeyframeIconType.Start)
                            linkedKfIcon = this.timeline.keyframeIcons[this.timeline.keyframeIcons.length - 1];
                        // TODO - multi-track
                    }
                    if (linkedKfIcon) {
                        linkedKfIcon.keyframesMap.forEach((kf) => {
                            kf.easeOutCoeff = value;
                        });
                    }
                }
                this.updatePreviewSteps();
            }
        };
        this.interpolationTab.appendChild(this.easeOutSlider.elem);

        this.studioDataTabBtn.addEventListener('click', this.onTabBtnClick);
        setElementHighlighted(this.studioDataTabBtn, false);
        this.newAnimationBtn.onclick = () => {
            this.newAnimation();
            this.saveState();
        }
        this.loadAnimationBtn.onclick = () => this.loadAnimation();
        this.saveAnimationBtn.onclick = () => this.saveAnimation();
        this.exportAnimationBtn.onclick = () => this.exportAnimation();
        this.importAnimationBtn.onclick = () => this.importAnimation();

        this.optionsTabBtn.addEventListener('click', this.onTabBtnClick);
        setElementHighlighted(this.optionsTabBtn, false);
        this.showPreviewLineCheckbox = new Checkbox('Show Animation Preview Line', true);
        this.showPreviewLineCheckbox.elem.title = 'Show/Hide the line indicating the path of the animation.';
        this.showPreviewLineCheckbox.onchanged = () => {
            if (this.showPreviewLineCheckbox.checked)
                this.updatePreviewSteps();
            // TODO - Customize preview line colours?
        };
        this.livePreviewCheckbox = new Checkbox('Live Preview');
        this.livePreviewCheckbox.elem.title = 'Preview the animation when moving the playhead or keyframes.';
        this.livePreviewCheckbox.onchanged = () => {
            if (this.livePreviewCheckbox.checked)
                this.updatePreviewSteps();
            this.timeline.livePreview = this.livePreviewCheckbox.checked;
        }

        this.previewOptionsContainer = this.contents.querySelector('#previewOptionsContainer') as HTMLElement;
        this.previewOptionsContainer.insertAdjacentElement('beforeend', this.showPreviewLineCheckbox.elem);
        this.previewOptionsContainer.insertAdjacentElement('beforeend', this.livePreviewCheckbox.elem);

        this.posXValueInput.onchange = () => this.onChangeValueInput(this.posXValueInput);
        this.posYValueInput.onchange = () => this.onChangeValueInput(this.posYValueInput);
        this.posZValueInput.onchange = () => this.onChangeValueInput(this.posZValueInput);
        this.lookAtXValueInput.onchange = () => this.onChangeValueInput(this.lookAtXValueInput);
        this.lookAtYValueInput.onchange = () => this.onChangeValueInput(this.lookAtYValueInput);
        this.lookAtZValueInput.onchange = () => this.onChangeValueInput(this.lookAtZValueInput);
        this.bankValueInput.onchange = () => this.onChangeValueInput(this.bankValueInput);

        this.zoomOutBtn = this.contents.querySelector('#zoomOutBtn') as HTMLButtonElement;
        this.zoomOutBtn.insertAdjacentElement('afterbegin', createDOMFromString(ZOOM_OUT_ICON).querySelector('svg')!);
        this.zoomOutBtn.onclick = () => this.zoomOut();
        this.zoomInBtn = this.contents.querySelector('#zoomInBtn') as HTMLButtonElement;
        this.zoomInBtn.insertAdjacentElement('afterbegin', createDOMFromString(ZOOM_IN_ICON).querySelector('svg')!);
        this.zoomInBtn.onclick = () => this.zoomIn();

        this.playAnimationBtn = this.contents.querySelector('#playAnimationBtn') as HTMLButtonElement;
        this.stopAnimationBtn = this.contents.querySelector('#stopAnimationBtn') as HTMLButtonElement;
        this.prevKeyframeBtn = this.contents.querySelector('#prevKeyframeBtn') as HTMLButtonElement;
        this.prevKeyframeBtn.title = 'Jump to the previous keyframe on the timeline. Hotkey: J';
        this.nextKeyframeBtn = this.contents.querySelector('#nextKeyframeBtn') as HTMLButtonElement;
        this.nextKeyframeBtn.title = 'Jump to the next keyframe on the timeline. Hotkey: K';

        this.playAnimationBtn.onclick = (e) => {
            e.stopPropagation();
            this.playAnimation();
            this.stopAnimationBtn.focus();
        }

        this.stopAnimationBtn.onclick = (e) => {
            e.stopPropagation();
            this.stopAnimation();
            this.playAnimationBtn.focus();
        }

        this.prevKeyframeBtn.onclick = (e) => {
            e.stopPropagation();
            this.prevKeyframe();
        }

        this.nextKeyframeBtn.onclick = (e) => {
            e.stopPropagation();
            this.nextKeyframe();
        }

        const numericInputs: NodeList = document.querySelectorAll('#studioPanelContents .StudioNumericInput');
        for (let i = 0; i < numericInputs.length; i++) {
            const element = numericInputs[i] as HTMLInputElement;
            element.addEventListener('mousedown', (e: MouseEvent) => {
                if (!element.disabled)
                    this.selectedNumericInput = element;
            });
        }

        document.addEventListener('mousemove', (e: MouseEvent) => {
            // Only need to update if the primary mouse button is pressed while moving.
            if (e.buttons === 1 && this.timeline && this.playheadTimePositionInput
                && !this.studioCameraController.isAnimationPlaying && !this.editingKeyframe) {
                if (this.selectedNumericInput) {
                    let distance = (e.movementX - e.movementY) * parseFloat(this.selectedNumericInput.step);
                    if (e.ctrlKey)
                        distance *= .1;
                    else if (e.shiftKey)
                        distance *= 10;
                    this.selectedNumericInput.value = (parseFloat(this.selectedNumericInput.value) + distance).toFixed(2);
                    this.selectedNumericInput.dispatchEvent(new Event('change', { 'bubbles': true }));
                } else {
                    this.timeline.onMouseMove(e);
                    if (this.timeline.playheadGrabbed)
                        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();

                    if (this.timeline.keyframeIconGrabbed)
                        this.updatePreviewSteps();

                    if (this.timeline.livePreview && (this.timeline.keyframeIconGrabbed || this.timeline.playheadGrabbed))
                        this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
                }
            }
        });

        this.timelineElementsCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            if (this.timeline && !this.editingKeyframe) {
                this.timeline.onMouseDown(e);
                if (this.timeline.playheadGrabbed) {
                    this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
                    if (this.timeline.livePreview)
                        this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
                }
            }
        });

        this.timelineElementsCanvas.addEventListener('keyframeSelected', (e: Event) => this.onKeyframeSelected());
        this.timelineElementsCanvas.addEventListener('keyframeDeselected', (e: Event) => this.onKeyframeDeselected());
        this.timelineElementsCanvas.addEventListener('keyframeIconMovedEvent', (e: Event) => {
            for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                kfIcon.keyframesMap.forEach((v, trackType) => {
                    this.getTrackByType(this.animation, trackType).reSort();
                });
            }
        });

        this.mainPanel.addEventListener('wheel', (ev: WheelEvent) => {
            ev.preventDefault();
            if (ev.ctrlKey) {
                if (ev.deltaY < 0)
                    this.zoomIn();
                else if (ev.deltaY > 0)
                    this.zoomOut();
            } else {
                this.timeLineContainerElement.scrollBy(ev.deltaY, 0);
            }
        })

        document.addEventListener('mouseup', () => {
            if (this.timeline && !this.editingKeyframe) {
                if (this.timeline.hasGrabbedIconMoved())
                    this.saveState();

                this.timeline.onMouseUp();
                if (this.selectedNumericInput) {
                    this.selectedNumericInput = undefined;
                    this.saveState();
                }
            }
        });

        this.newAnimation();
        this.studioPanelContents.removeAttribute('hidden');

        window.addEventListener('resize', () => {
            this.rescaleTimelineContainer();
        });
    }

    public playAnimation(theater?: boolean) {
        if (this.timeline.keyframeIcons.length > 1) {
            this.disableControls();
            this.playAnimationBtn.setAttribute('hidden', '');
            this.stopAnimationBtn.removeAttribute('disabled');
            this.stopAnimationBtn.classList.remove('disabled');
            this.stopAnimationBtn.removeAttribute('hidden');

            let startTime = this.timeline.getPlayheadTimeMs();
            if (!this.animation.loop && startTime >= this.timeline.getLastKeyframeTimeMs())
                startTime = 0;

            if (theater) {
                this.ui.toggleUI(false);
                this.elem.style.display = 'none';
                setTimeout(() => {
                    this.animationManager.initAnimationPlayback(this.animation, startTime);
                    this.studioCameraController.isAnimationPlaying = true;
                }, 2000);
            } else {
                this.animationManager.initAnimationPlayback(this.animation, startTime);
                this.studioCameraController.isAnimationPlaying = true;
            }
        }
    }

    public stopAnimation() {
        this.studioCameraController.isAnimationPlaying = false;
        this.enableControls();
        this.playAnimationBtn.removeAttribute('hidden');
        this.stopAnimationBtn.setAttribute('hidden', '');
        this.ui.toggleUI(true);
        this.elem.style.display = '';
    }

    public drawWorldHelpers(clipFromWorldMatrix: mat4) {
        if (this.showPreviewLineCheckbox.checked && this.timeline.keyframeIcons.length > 1) {
            for (let i = 0; i <= this.animationPreviewSteps.length - 2; i++) {
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.animationPreviewSteps[i + 1].pos, this.previewLineColor);
                if (i % 30 === 0) {
                    drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.animationPreviewSteps[i].lookAtPos, this.previewLineLookAtColor);
    
                    mat4.targetTo(this.scratchMat, this.animationPreviewSteps[i].pos, this.animationPreviewSteps[i].lookAtPos, Vec3UnitY);
                    mat4.rotateZ(this.scratchMat, this.scratchMat, -this.animationPreviewSteps[i].bank);
                    computeEulerAngleRotationFromSRTMatrix(this.scratchVec, this.scratchMat);
                    vec3.copy(this.scratchVecUp, Vec3UnitY);
                    vec3.rotateZ(this.scratchVecUp, this.scratchVecUp, Vec3Zero, -this.scratchVec[2]);
                    vec3.rotateY(this.scratchVecUp, this.scratchVecUp, Vec3Zero, -this.scratchVec[1]);
                    vec3.rotateX(this.scratchVecUp, this.scratchVecUp, Vec3Zero, -this.scratchVec[0]);
                    this.scratchVecUp[2] = 0;
                    vec3.normalize(this.scratchVecUp, this.scratchVecUp);
                    vec3.scaleAndAdd(this.scratchVecUp, this.animationPreviewSteps[i].pos, this.scratchVecUp, 100);
                    drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.scratchVecUp, this.previewLineYAxisColor);
                    // TODO - draw arrow head lines or cone to better communicate direction?
                }
            }

            for (const kfIcon of this.timeline.keyframeIcons) {
                const stepIndex = Math.floor(kfIcon.getT() / 16);
                const color = kfIcon.selected ? this.previewLineKfDotSelectedColor : this.previewLineKfDotColor;
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[stepIndex].pos, color, 16);
            }
        }
    }

    private movePlayhead(moveAmountSeconds: number) {
        const moveTime = parseFloat(this.timeline.getPlayheadTimeSeconds()) + moveAmountSeconds;
        if (moveTime * MILLISECONDS_IN_SECOND > this.timeline.getTimelineLengthMs()) {
            this.timelineLengthInput.value = moveTime.toFixed(2);
            this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        this.playheadTimePositionInput.value = (moveTime).toFixed(2);
        this.playheadTimePositionInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    private prevKeyframe(): void {
        this.timeline.jumpToPreviousKeyframe();
        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
        if (this.timeline.livePreview)
            this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
    }

    private nextKeyframe(): void {
        this.timeline.jumpToNextKeyframe();
        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
        if (this.timeline.livePreview)
            this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
    }

    private redo() {
        if (this.currentStateIndex < this.studioStates.length - 1) {
            this.currentStateIndex++;
            this.loadState(this.studioStates[this.currentStateIndex]);
            this.undoBtn.removeAttribute('disabled');
            this.undoBtn.classList.remove('disabled');
            if (this.currentStateIndex === this.studioStates.length - 1) {
                this.redoBtn.setAttribute('disabled', '');
                this.redoBtn.classList.add('disabled');
            }
        }
    }

    private undo() {
        if (this.currentStateIndex > 0) {
            this.currentStateIndex--;
            this.loadState(this.studioStates[this.currentStateIndex]);
            this.redoBtn.removeAttribute('disabled');
            this.redoBtn.classList.remove('disabled');
            if (this.currentStateIndex === 0) {
                this.undoBtn.setAttribute('disabled', '');
                this.undoBtn.classList.add('disabled');
            }
        }
    }

    private saveState() {
        if (!this.animation || !this.timeline) {
            return;
        }
        if (this.currentStateIndex > -1 && this.currentStateIndex < this.studioStates.length - 1) {
            this.studioStates.length = this.currentStateIndex + 1;
            this.redoBtn.setAttribute('disabled', '');
            this.redoBtn.classList.add('disabled');
        }
        const state: StudioState = {
            animation: JSON.parse(JSON.stringify(this.animation)),
            timelineLengthMs: this.timeline.getTimelineLengthMs()
        };
        this.studioStates.push(state);
        this.currentStateIndex++;
        if (this.currentStateIndex > 0) {
            this.undoBtn.removeAttribute('disabled');
            this.undoBtn.classList.remove('disabled');
        }
    }

    private loadState(state: StudioState) {
        this.timeline.deselectAllKeyframeIcons();
        const loadedAnimation = JSON.parse(JSON.stringify(state.animation));
        if (loadedAnimation.loop === undefined)
            loadedAnimation.loop = false;

        const conformKf = (kf:Keyframe) => {
            if (kf.easeInCoeff === undefined) {
                kf.easeInCoeff = 1;
                kf.easeOutCoeff = 1;
            }

            if (kf.interpInType === undefined)
                kf.interpInType = InterpolationType.Ease;
            
            if (kf.interpOutType === undefined)
                kf.interpOutType = InterpolationType.Ease;
        };
        
        for (const kf of loadedAnimation.posXTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.posYTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.posZTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.lookAtXTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.lookAtYTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.lookAtZTrack.keyframes) {
            conformKf(kf);
        }
        
        for (const kf of loadedAnimation.bankTrack.keyframes) {
            conformKf(kf);
        }

        if (loadedAnimation.posXTrack.keyframes.length === 0) {
            this.newAnimation();
            return;
        }
        // If loading out of a "new timeline" state, we'll need to unhide the UI.
        this.showEditingUI();
        this.rescaleTimelineContainer();
        this.studioHelpText.dataset.default = 'Move the playhead to the desired time, then move the camera and press Enter to place a keyframe.';
        this.animation.posXTrack.keyframes = loadedAnimation.posXTrack.keyframes;
        this.animation.posYTrack.keyframes = loadedAnimation.posYTrack.keyframes;
        this.animation.posZTrack.keyframes = loadedAnimation.posZTrack.keyframes;
        this.animation.lookAtXTrack.keyframes = loadedAnimation.lookAtXTrack.keyframes;
        this.animation.lookAtYTrack.keyframes = loadedAnimation.lookAtYTrack.keyframes;
        this.animation.lookAtZTrack.keyframes = loadedAnimation.lookAtZTrack.keyframes;
        this.animation.bankTrack.keyframes = loadedAnimation.bankTrack.keyframes;
        this.animation.loop = loadedAnimation.loop;
        this.timeline.keyframeIcons = [];
        this.timeline.setScaleAndDrawMarkers(state.timelineLengthMs);
        // TODO - Handle multi-track timelines. This is a bit of a kludge as-is, but is fine for the consolidated view.
        for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
            let kfType = KeyframeIconType.Default;
            if (this.timeline.keyframeIcons.length === 0)
                kfType = KeyframeIconType.Start;
            else if (this.animation.loop && i === this.animation.posXTrack.keyframes.length - 1)
                kfType = KeyframeIconType.Loop_End;

            const kfMap = new Map<KeyframeTrackType, Keyframe>();
            kfMap.set(KeyframeTrackType.posXTrack, this.animation.posXTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.posYTrack, this.animation.posYTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.posZTrack, this.animation.posZTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.lookAtXTrack, this.animation.lookAtXTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.lookAtYTrack, this.animation.lookAtYTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.lookAtZTrack, this.animation.lookAtZTrack.keyframes[i]);
            kfMap.set(KeyframeTrackType.bankTrack, this.animation.bankTrack.keyframes[i]);
            this.timeline.addKeyframeIcon(kfMap, this.animation.posXTrack.keyframes[i].time, Timeline.KEYFRAME_ICONS_BASE_Y_POS, kfType, false);
        }
        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
        this.playheadTimePositionInput.dispatchEvent(new Event('change', { bubbles: true }));
        this.timelineLengthInput.value = this.timeline.getTimelineLengthSeconds();
        this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        setElementHighlighted(this.loopAnimationBtn, this.animation.loop);
        this.timeline.draw();
        this.updatePreviewSteps();
    }

    private getTrackByType(animation: CameraAnimation, trackType: KeyframeTrackType): KeyframeTrack {
        if (trackType === KeyframeTrackType.posXTrack)
            return animation.posXTrack;
        else if (trackType === KeyframeTrackType.posYTrack)
            return animation.posYTrack;
        else if (trackType === KeyframeTrackType.posZTrack)
            return animation.posZTrack;
        else if (trackType === KeyframeTrackType.lookAtXTrack)
            return animation.lookAtXTrack;
        else if (trackType === KeyframeTrackType.lookAtYTrack)
            return animation.lookAtYTrack;
        else if (trackType === KeyframeTrackType.lookAtZTrack)
            return animation.lookAtZTrack;
        else if (trackType === KeyframeTrackType.bankTrack)
            return animation.bankTrack;
        else
            throw "whoops";
    }

    private onChangeValueInput(input: HTMLInputElement): void {
        if (this.timeline.selectedKeyframeIcons.length === 1 && input.value) {
            const val = parseFloat(input.value);
            if (!Number.isNaN(val)) {
                const trackType = parseInt(input.dataset.track!, 10);
                const kf = this.timeline.selectedKeyframeIcons[0].keyframesMap.get(trackType)!;
                let linkedKf = undefined;
                if (this.animation.loop) {
                    if (this.timeline.selectedKeyframeIcons[0].type === KeyframeIconType.Loop_End)
                        linkedKf = this.timeline.keyframeIcons[0].keyframesMap.get(trackType);
                    else if (this.timeline.selectedKeyframeIcons[0].type === KeyframeIconType.Start)
                        linkedKf = this.timeline.keyframeIcons[this.timeline.keyframeIcons.length - 1].keyframesMap.get(trackType);
                    // TODO - multi-track
                }
                if (this.lockPerspective) {
                    const diff = val - parseInt(input.dataset.prevValue!);
                    if (trackType === KeyframeTrackType.posXTrack) {
                        const corVal = parseInt(this.lookAtXValueInput.value) + diff;
                        this.lookAtXValueInput.value = corVal.toString();
                        this.lookAtXValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    } else if (trackType === KeyframeTrackType.posYTrack) {
                        const corVal = parseInt(this.lookAtYValueInput.value) + diff;
                        this.lookAtYValueInput.value = corVal.toString();
                        this.lookAtYValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    } else if (trackType === KeyframeTrackType.posZTrack) {
                        const corVal = parseInt(this.lookAtZValueInput.value) + diff;
                        this.lookAtZValueInput.value = corVal.toString();
                        this.lookAtZValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    }
                }
                this.getTrackByType(this.animation, trackType).setValue(kf, val);
                if (linkedKf)
                    this.getTrackByType(this.animation, trackType).setValue(linkedKf, val);
                this.updatePreviewSteps();
                input.dataset.prevValue = input.value.toString();
            }
        }
    }

    private getValueInput(trackType: KeyframeTrackType): HTMLInputElement {
        if (trackType === KeyframeTrackType.posXTrack)
            return this.posXValueInput;
        else if (trackType === KeyframeTrackType.posYTrack)
            return this.posYValueInput;
        else if (trackType === KeyframeTrackType.posZTrack)
            return this.posZValueInput;
        else if (trackType === KeyframeTrackType.lookAtXTrack)
            return this.lookAtXValueInput;
        else if (trackType === KeyframeTrackType.lookAtYTrack)
            return this.lookAtYValueInput;
        else if (trackType === KeyframeTrackType.lookAtZTrack)
            return this.lookAtZValueInput;
        else if (trackType === KeyframeTrackType.bankTrack)
            return this.bankValueInput;
        else
            throw "whoops";
    }

    private onKeyframeSelected() {
        const icon = this.timeline.selectedKeyframeIcons[0];
        let selectedTracks = 0;
        let commonEaseInVal = 1;
        let commonEaseOutVal = 1;
        let commonInterpInType = 0;
        let commonInterpOutType = 0;
        
        icon.keyframesMap.forEach((kf, trackType) => {
            selectedTracks |= trackType;
            const input = this.getValueInput(trackType);
            input.value = kf.value.toFixed(0).toString();
            input.dataset.prevValue = input.value;
            commonEaseInVal = kf.easeInCoeff;
            commonEaseOutVal = kf.easeOutCoeff;
            commonInterpInType = kf.interpInType;
            commonInterpOutType = kf.interpOutType;
        });
        
        for (let i = 1; i < this.timeline.selectedKeyframeIcons.length; i++) {
            const kfIcon = this.timeline.selectedKeyframeIcons[i];
            kfIcon.keyframesMap.forEach((kf, trackType) => {
                if (selectedTracks !== 0) {
                    if (selectedTracks & trackType) {
                        selectedTracks = 0;
                    } else {
                        selectedTracks |= trackType;
                        const input = this.getValueInput(trackType);
                        input.value = kf.value.toFixed(0).toString();
                        input.dataset.prevValue = input.value;
                    }
                }

                if (commonEaseInVal !== -1 && kf.easeInCoeff !== commonEaseInVal)
                    commonEaseInVal = -1;
                
                if (commonEaseOutVal !== -1 && kf.easeOutCoeff !== commonEaseOutVal)
                    commonEaseOutVal = -1;
                
                if (commonInterpInType !== -1 && kf.interpInType !== commonInterpInType)
                    commonInterpInType = -1;
                
                if (commonInterpOutType !== -1 && kf.interpOutType !== commonInterpOutType)
                    commonInterpOutType = -1;
            });
        }
        
        this.selectKeyframeMsg.setAttribute('hidden', '');
        this.keyframeControlsContents.removeAttribute('hidden');
        this.editKeyframeWithCamBtn.setAttribute('hidden', '');
        this.posXValueInputContainer.setAttribute('hidden','');
        this.posYValueInputContainer.setAttribute('hidden','');
        this.posZValueInputContainer.setAttribute('hidden','');
        this.lookAtXValueInputContainer.setAttribute('hidden','');
        this.lookAtYValueInputContainer.setAttribute('hidden','');
        this.lookAtZValueInputContainer.setAttribute('hidden','');
        this.bankValueInputContainer.setAttribute('hidden','');
        this.lockPerspectiveBracket.setAttribute('hidden', '');
        this.lockPerspectiveDiv.setAttribute('hidden', '');

        if (selectedTracks !== 0) {
            this.editKeyframeWithCamBtn.removeAttribute('hidden');

            if (selectedTracks & KeyframeTrackType.posXTrack)
                this.posXValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.posYTrack)
                this.posYValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.posZTrack)
                this.posZValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.lookAtXTrack)
                this.lookAtXValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.lookAtYTrack)
                this.lookAtYValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.lookAtZTrack)
                this.lookAtZValueInputContainer.removeAttribute('hidden');
                
            if (selectedTracks & KeyframeTrackType.bankTrack)
                this.bankValueInputContainer.removeAttribute('hidden');
        }

            
        if (((selectedTracks & KeyframeTrackType.posXTrack) && (selectedTracks & KeyframeTrackType.lookAtXTrack))
            || ((selectedTracks & KeyframeTrackType.posYTrack) && (selectedTracks & KeyframeTrackType.lookAtYTrack))
            || ((selectedTracks & KeyframeTrackType.posZTrack) && (selectedTracks & KeyframeTrackType.lookAtZTrack))) {
            this.lockPerspectiveBracket.removeAttribute('hidden');
            this.lockPerspectiveDiv.removeAttribute('hidden');
        } 

        if (commonEaseInVal !== -1) {
            this.easeInSlider.setValue(commonEaseInVal);
        } else {
            (this.easeInSlider.elem.querySelector('.Slider') as HTMLInputElement).value = '1';
        }

        if (commonEaseOutVal !== -1) {
            this.easeOutSlider.setValue(commonEaseOutVal);
        } else {
            (this.easeOutSlider.elem.querySelector('.Slider') as HTMLInputElement).value = '1';
        }

        this.interpInTypeBtns.setSelectedIndex(commonInterpInType);
        this.interpOutTypeBtns.setSelectedIndex(commonInterpOutType);
    }
    
    private onKeyframeDeselected(): void {
        if (this.timeline.selectedKeyframeIcons.length === 0) {
            this.hideKeyframeControls();
        } else {
            // Call onKeyframeSelected to update relevant keyframe editing inputs
            this.onKeyframeSelected();
        }
    }

    private hideKeyframeControls() {
        this.posXValueInput.value = '';
        this.posYValueInput.value = '';
        this.posZValueInput.value = '';
        this.lookAtXValueInput.value = '';
        this.lookAtYValueInput.value = '';
        this.lookAtZValueInput.value = '';
        this.bankValueInput.value = '';
        this.keyframeControlsContents.setAttribute('hidden', '');
        this.lockPerspectiveBracket.setAttribute('hidden', '');
        this.lockPerspectiveDiv.setAttribute('hidden', '');
        this.selectKeyframeMsg.removeAttribute('hidden');
    }

    private initTimeline() {
        this.studioHelpText.dataset.default = 'Move the playhead to the desired time, then move the camera and press Enter to place a keyframe.';
        this.studioHelpText.innerText = this.studioHelpText.dataset.default;
        this.showEditingUI();
        this.rescaleTimelineContainer();
        this.timeline.draw();
    }

    private getPreviewSteps(): InterpolationStep[] {
        const steps: InterpolationStep[] = [];

        if (this.timeline.keyframeIcons.length > 1) {
            // TODO(jstpierre): Don't rely on animationManager for this.
            const PREVIEW_STEP_TIME_MS = 16;
            for (let time = 0; time <= this.animationManager.durationMs; time += PREVIEW_STEP_TIME_MS) {
                const step = new InterpolationStep();
                this.animationManager.getAnimFrame(step, time);
                steps.push(step);
            }
        }

        return steps;
    }

    private updatePreviewSteps() {
        this.animationManager.initAnimationPlayback(this.animation, 0);
        this.updateAutoTangents();

        this.animationPreviewSteps = this.getPreviewSteps();
    }

    private updateAutoTangents() {
        this.animation.posXTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.posYTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.posZTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtXTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtYTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtZTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.bankTrack.setAllCatmullRomTangents(this.animation.loop);
    }

    private goToPreviewStepAtTime(t: number) {
        this.animationManager.setElapsedTime(t);

        // TODO(jstpierre): Have this driven by CameraAnimationManager.
        const interpStep = new InterpolationStep();
        this.animationManager.getAnimFrame(interpStep);
        this.studioCameraController.setToPosition(interpStep);
    }

    public onAnimationAdvance(t: number) {
        this.playheadTimePositionInput.value = t.toFixed(2);
        this.playheadTimePositionInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    private beginEditKeyframePosition() {
        this.editingKeyframe = true;
        setElementHighlighted(this.editKeyframeWithCamBtn, true);
        this.studioHelpText.innerText = this.studioHelpText.dataset.editPosHelpText as string;
        this.disableControls();
    }

    public endEditKeyframePosition() {
        if (this.editingKeyframe) {
            this.editingKeyframe = false;
            setElementHighlighted(this.editKeyframeWithCamBtn, false);
            this.resetHelpText();
            this.enableControls();
        }
    }

    public deleteSelectedKeyframeIcons() {
        for (const kfIcon of this.timeline.selectedKeyframeIcons) {
            const type = kfIcon.type;
            if (type === KeyframeIconType.Default) {
                const posXTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posXTrack);
                const posYTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posYTrack);
                const posZTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posZTrack);
                const lookAtXTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtXTrack);
                const lookAtYTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtYTrack);
                const lookAtZTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtZTrack);
                const bankTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.bankTrack);
                if (posXTrackKf) {
                    const index = this.animation.posXTrack.keyframes.indexOf(posXTrackKf);
                    if (index > 0)
                        this.animation.posXTrack.keyframes.splice(index, 1);
                }
                if (posYTrackKf) {
                    const index = this.animation.posYTrack.keyframes.indexOf(posYTrackKf);
                    if (index > 0)
                        this.animation.posYTrack.keyframes.splice(index, 1);
                }
                if (posZTrackKf) {
                    const index = this.animation.posZTrack.keyframes.indexOf(posZTrackKf);
                    if (index > 0)
                        this.animation.posZTrack.keyframes.splice(index, 1);
                }
                if (lookAtXTrackKf) {
                    const index = this.animation.lookAtXTrack.keyframes.indexOf(lookAtXTrackKf);
                    if (index > 0)
                        this.animation.lookAtXTrack.keyframes.splice(index, 1);
                }
                if (lookAtYTrackKf) {
                    const index = this.animation.lookAtYTrack.keyframes.indexOf(lookAtYTrackKf);
                    if (index > 0)
                        this.animation.lookAtYTrack.keyframes.splice(index, 1);
                }
                if (lookAtZTrackKf) {
                    const index = this.animation.lookAtZTrack.keyframes.indexOf(lookAtZTrackKf);
                    if (index > 0)
                        this.animation.lookAtZTrack.keyframes.splice(index, 1);
                }
                if (bankTrackKf) {
                    const index = this.animation.bankTrack.keyframes.indexOf(bankTrackKf);
                    if (index > 0)
                        this.animation.bankTrack.keyframes.splice(index, 1);
                }
            }
        }
        this.timeline.deleteSelectedKeyframeIcons();
        this.timeline.draw();
        this.updatePreviewSteps();
        this.saveState();
    }

    private scratchVecPos: vec3 = vec3.create();
    private scratchVecLook: vec3 = vec3.create();
    private scratchVecZAxis: vec3 = vec3.create();

    public addKeyframesFromMat4(worldMatrix: ReadonlyMat4): void {
        if (!this.timeline || this.timeline.keyframeIcons.length === 0)
            this.initTimeline();

        if (this.timeline.selectedKeyframeIcons.length && !this.editingKeyframe)
            return;

        if (!this.timeline.selectedKeyframeIcons.length && this.timeline.playheadIsOnIcon())
            return;

        const time = this.timeline.getPlayheadTimeMs();
        const tracks = this.selectedTracks;

        mat4.getTranslation(this.scratchVecPos, worldMatrix);
        getMatrixAxisZ(this.scratchVecZAxis, worldMatrix);
        vec3.normalize(this.scratchVecZAxis, this.scratchVecZAxis);
        vec3.scaleAndAdd(this.scratchVecLook, this.scratchVecPos, this.scratchVecZAxis, -100);

        const posXKf: Keyframe = { time, value: this.scratchVecPos[0], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };
        const posYKf: Keyframe = { time, value: this.scratchVecPos[1], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };
        const posZKf: Keyframe = { time, value: this.scratchVecPos[2], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };
        const lookAtXKf: Keyframe = { time, value: this.scratchVecLook[0], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };
        const lookAtYKf: Keyframe = { time, value: this.scratchVecLook[1], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };
        const lookAtZKf: Keyframe = { time, value: this.scratchVecLook[2], tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };

        computeEulerAngleRotationFromSRTMatrix(this.scratchVecPos, worldMatrix);
        vec3.copy(this.scratchVecLook, Vec3UnitY);
        vec3.rotateZ(this.scratchVecLook, this.scratchVecLook, Vec3Zero, -this.scratchVecPos[2]);
        vec3.rotateY(this.scratchVecLook, this.scratchVecLook, Vec3Zero, -this.scratchVecPos[1]);
        vec3.rotateX(this.scratchVecLook, this.scratchVecLook, Vec3Zero, -this.scratchVecPos[0]);
        this.scratchVecLook[2] = 0;
        vec3.normalize(this.scratchVecLook, this.scratchVecLook);
        let bank = vec3.angle(this.scratchVecLook, Vec3UnitY)
        if (this.scratchVecLook[0] < 0) {
            bank *= -1;
        }
        const bankKf: Keyframe = { time, value: bank, tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };

        if (this.editingKeyframe) {
            for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                if (kfIcon.type === KeyframeIconType.Start
                    || kfIcon.type === KeyframeIconType.Loop_End) {
                    this.animation.posXTrack.keyframes[0].value = posXKf.value;
                    this.animation.posYTrack.keyframes[0].value = posYKf.value;
                    this.animation.posZTrack.keyframes[0].value = posZKf.value;
                    this.animation.lookAtXTrack.keyframes[0].value = lookAtXKf.value;
                    this.animation.lookAtYTrack.keyframes[0].value = lookAtYKf.value;
                    this.animation.lookAtZTrack.keyframes[0].value = lookAtZKf.value;
                    this.animation.bankTrack.keyframes[0].value = bankKf.value;
                    if (this.animation.loop) {
                        this.animation.posXTrack.keyframes[this.animation.posXTrack.keyframes.length - 1].value = posXKf.value;
                        this.animation.posYTrack.keyframes[this.animation.posYTrack.keyframes.length - 1].value = posYKf.value;
                        this.animation.posZTrack.keyframes[this.animation.posZTrack.keyframes.length - 1].value = posZKf.value;
                        this.animation.lookAtXTrack.keyframes[this.animation.lookAtXTrack.keyframes.length - 1].value = lookAtXKf.value;
                        this.animation.lookAtYTrack.keyframes[this.animation.lookAtYTrack.keyframes.length - 1].value = lookAtYKf.value;
                        this.animation.lookAtZTrack.keyframes[this.animation.lookAtZTrack.keyframes.length - 1].value = lookAtZKf.value;
                        this.animation.bankTrack.keyframes[this.animation.bankTrack.keyframes.length - 1].value = bankKf.value;
                    }
                } else {
                    const currentPosXTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posXTrack);
                    const currentPosYTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posYTrack);
                    const currentPosZTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.posZTrack);
                    const currentLookAtXTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtXTrack);
                    const currentLookAtYTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtYTrack);
                    const currentLookAtZTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.lookAtZTrack);
                    const currentBankTrackKf = kfIcon.keyframesMap.get(KeyframeTrackType.bankTrack);
                    if (currentPosXTrackKf)
                        currentPosXTrackKf.value = posXKf.value;
                    if (currentPosYTrackKf)
                        currentPosYTrackKf.value = posYKf.value;
                    if (currentPosZTrackKf)
                        currentPosZTrackKf.value = posZKf.value;
                    if (currentLookAtXTrackKf)
                        currentLookAtXTrackKf.value = lookAtXKf.value;
                    if (currentLookAtYTrackKf)
                        currentLookAtYTrackKf.value = lookAtYKf.value;
                    if (currentLookAtZTrackKf)
                        currentLookAtZTrackKf.value = lookAtZKf.value;
                    if (currentBankTrackKf)
                        currentBankTrackKf.value = bankKf.value;
                }
                this.updatePreviewSteps();
            }
            this.endEditKeyframePosition();
            return;
        }

        if (tracks & KeyframeTrackType.posXTrack)
            this.animation.posXTrack.addKeyframe(posXKf);
        if (tracks & KeyframeTrackType.posYTrack)
            this.animation.posYTrack.addKeyframe(posYKf);
        if (tracks & KeyframeTrackType.posZTrack)
            this.animation.posZTrack.addKeyframe(posZKf);
        if (tracks & KeyframeTrackType.lookAtXTrack)
            this.animation.lookAtXTrack.addKeyframe(lookAtXKf);
        if (tracks & KeyframeTrackType.lookAtYTrack)
            this.animation.lookAtYTrack.addKeyframe(lookAtYKf);
        if (tracks & KeyframeTrackType.lookAtZTrack)
            this.animation.lookAtZTrack.addKeyframe(lookAtZKf);
        if (tracks & KeyframeTrackType.bankTrack)
            this.animation.bankTrack.addKeyframe(bankKf);

        const kfType = this.timeline.keyframeIcons.length === 0 ? KeyframeIconType.Start : KeyframeIconType.Default;
        // TODO - Update for multi-track editor.
        const kfMap = new Map<KeyframeTrackType, Keyframe>();
        kfMap.set(KeyframeTrackType.posXTrack, posXKf);
        kfMap.set(KeyframeTrackType.posYTrack, posYKf);
        kfMap.set(KeyframeTrackType.posZTrack, posZKf);
        kfMap.set(KeyframeTrackType.lookAtXTrack, lookAtXKf);
        kfMap.set(KeyframeTrackType.lookAtYTrack, lookAtYKf);
        kfMap.set(KeyframeTrackType.lookAtZTrack, lookAtZKf);
        kfMap.set(KeyframeTrackType.bankTrack, bankKf);

        // If we're past the time of the last keyframe, advance.
        const advancePlayhead = time > this.timeline.getLastKeyframeTimeMs();

        this.timeline.addKeyframeIcon(kfMap, time, Timeline.KEYFRAME_ICONS_BASE_Y_POS, kfType, !advancePlayhead);

        this.updatePreviewSteps();

        if (advancePlayhead)
            this.movePlayhead(3);

        this.timeline.draw();
        this.saveState();
    }

    private addLoopEndFrames() {
        const time = this.timeline.getLastKeyframeTimeMs() + 5000;

        function makeLoopKeyframe(track: KeyframeTrack): Keyframe {
            const { value, tangentIn, tangentOut, interpInType, interpOutType, easeInCoeff, easeOutCoeff } = track.keyframes[0];
            return { time, value, tangentIn, tangentOut, interpInType, interpOutType, easeInCoeff, easeOutCoeff };
        }

        const kfMap = new Map<KeyframeTrackType, Keyframe>();

        const addLoopKeyframe = (trackType: KeyframeTrackType): void => {
            const track = this.getTrackByType(this.animation, trackType);
            const loopKeyframe = makeLoopKeyframe(track);
            track.addKeyframe(loopKeyframe);
            kfMap.set(trackType, loopKeyframe);
        };

        // TODO - Handle multi-track animations
        addLoopKeyframe(KeyframeTrackType.posXTrack);
        addLoopKeyframe(KeyframeTrackType.posYTrack);
        addLoopKeyframe(KeyframeTrackType.posZTrack);
        addLoopKeyframe(KeyframeTrackType.lookAtXTrack);
        addLoopKeyframe(KeyframeTrackType.lookAtYTrack);
        addLoopKeyframe(KeyframeTrackType.lookAtZTrack);
        addLoopKeyframe(KeyframeTrackType.bankTrack);

        this.timeline.addKeyframeIcon(kfMap, time, Timeline.KEYFRAME_ICONS_BASE_Y_POS, KeyframeIconType.Loop_End, false);

        if (time > this.timeline.getTimelineLengthMs()) {
            this.timelineLengthInput.value = (time / MILLISECONDS_IN_SECOND).toFixed(2);
            this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    private newAnimation(): void {
        this.animation = {
            posXTrack: new KeyframeTrack(),
            posYTrack: new KeyframeTrack(),
            posZTrack: new KeyframeTrack(),
            lookAtXTrack: new KeyframeTrack(),
            lookAtYTrack: new KeyframeTrack(),
            lookAtZTrack: new KeyframeTrack(),
            bankTrack: new KeyframeTrack(),
            loop: false,
        };
        this.timeline.deselectAllKeyframeIcons();
        this.timeline.keyframeIcons = [];
        this.playheadTimePositionInput.value = '0';
        this.timelineLengthInput.value = (Timeline.DEFAULT_LENGTH_MS / MILLISECONDS_IN_SECOND).toFixed(2);
        this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        this.livePreviewCheckbox.setChecked(false);
        this.showPreviewLineCheckbox.setChecked(true);
        this.selectedTracks |= KeyframeTrackType.allTracks;
        this.hideEditingUI();
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.resetHelpText();
    }

    private resetHelpText() {
        if (!this.editingKeyframe && !this.persistHelpText)
            this.studioHelpText.innerText = this.studioHelpText.dataset.default as string;
    }

    private displayMessage(m: string) {
        this.studioHelpText.innerText = m;
        this.persistHelpText = true;
        window.setTimeout(() => {
            this.persistHelpText = false;
            this.resetHelpText();
        }, 3000);
    }

    private displayError(e: string) {
        this.studioHelpText.innerText = e;
        this.studioHelpText.style.color = '#ff4141';
        this.studioHelpText.style.fontWeight = '700';
        this.persistHelpText = true;
        window.setTimeout(() => {
            this.studioHelpText.style.color = '';
            this.studioHelpText.style.fontWeight = '';
            this.persistHelpText = false;
            this.resetHelpText();
        }, 5000);
    }

    private loadAnimation() {
        const jsonAnim = window.localStorage.getItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId());
        if (jsonAnim) {
            const obj: any = JSON.parse(jsonAnim);
            if (this.isValidAnimationObj(obj)) {
                this.loadState(obj.studioState);
                this.displayMessage('Loaded animation from local storage.');
                this.saveState();
            } else {
                // Unlikely, but better not to keep garbage data saved.
                console.error('Animation saved in localStorage is invalid and will be deleted. Existing animation JSON: ', jsonAnim);
                window.localStorage.removeItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId());
                this.displayError('Saved animation invalid. See console for details.');
            }
        }
    }

    private isValidAnimationObj(obj: any): boolean {
        if (!obj || !obj.version)
            return false;

        // TODO - Maybe support older versions?
        if (obj.version === 2) {
            return obj.studioState
                && obj.studioState.timelineLengthMs
                && obj.studioState.animation
                && obj.studioState.animation.posXTrack
                && obj.studioState.animation.posYTrack
                && obj.studioState.animation.posZTrack
                && obj.studioState.animation.lookAtXTrack
                && obj.studioState.animation.lookAtYTrack
                && obj.studioState.animation.lookAtZTrack
                && obj.studioState.animation.bankTrack;
        }
        return false;
    }

    private serializeAnimation(): string {
        const studioState: StudioState = {
            animation: this.animation,
            timelineLengthMs: this.timeline.getTimelineLengthMs()
        };
        const dataObj = { version: 2, studioState };
        return JSON.stringify(dataObj);
    }

    private saveAnimation() {
        const jsonAnim: string = this.serializeAnimation();
        window.localStorage.setItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId(), jsonAnim);
        this.displayMessage('Saved animation to local storage.');
    }

    private exportAnimation() {
        if (!this.animation || !this.timeline) {
            this.displayError('Export failed - No animation is currently loaded.');
            return;
        }
        const a = document.createElement('a');
        const anim = new Blob([this.serializeAnimation()], { type: 'application/json' });
        a.href = URL.createObjectURL(anim);
        a.download = 'studio-animation-' + GlobalSaveManager.getCurrentSceneDescId() + '.json';
        a.click();
    }

    private importAnimation() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
            if (!input.files || !input.files.item(0))
                return;
            try {
                const fileContents = await this.loadFile(input.files.item(0) as File);
                const obj = JSON.parse(fileContents);
                if (this.isValidAnimationObj(obj)) {
                    this.loadState(obj.studioState);
                    this.displayMessage('Successfully loaded animation from file.');
                    this.saveState();
                } else {
                    throw new Error('File is not a valid animation.');
                }
            } catch (e) {
                console.error('Failed to load animation from JSON file.', e);
                this.displayError('Failed to load file. See console for details.');
            }
        }
        input.click();
    }

    private loadFile(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                resolve(reader.result as string);
            }
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    public onSceneChange() {
        this.newAnimation();
        this.loadAnimation();
        this.viewer.setCameraController(this.studioCameraController);
    }

    private disableControls(): void {
        this.studioControlsContainer.querySelectorAll(`button, input`).forEach((e) => {
            e.setAttribute('disabled', '');
            e.classList.add('disabled');
        });
    }

    private enableControls(): void {
        this.studioControlsContainer.querySelectorAll(`button, input`).forEach((e) => {
            if (!e.classList.contains('keep-disabled')) {
                e.removeAttribute('disabled');
                e.classList.remove('disabled');
            }
        });
    }

    private zoomIn(): void {
        if (this.zoomLevel < MAX_ZOOM_LEVEL) {
            this.zoomLevel += ZOOM_STEP;
            this.rescaleTimelineContainer();
            if (this.zoomLevel === MAX_ZOOM_LEVEL) {
                this.zoomInBtn.setAttribute('disabled', '');
                this.zoomInBtn.classList.add('disabled', 'keep-disabled');
            }
            this.zoomOutBtn.removeAttribute('disabled');
            this.zoomOutBtn.classList.remove('disabled', 'keep-disabled');
        }
    }

    private zoomOut(): void {
        if (this.zoomLevel > 1) {
            this.zoomLevel -= ZOOM_STEP;
            this.rescaleTimelineContainer();
            if (this.zoomLevel === 1) {
                this.zoomOutBtn.setAttribute('disabled', '');
                this.zoomOutBtn.classList.add('disabled', 'keep-disabled');
            }
            this.zoomInBtn.removeAttribute('disabled');
            this.zoomInBtn.classList.remove('disabled', 'keep-disabled');
        }
    }

    private rescaleTimelineContainer(): void {
        const tlContainerWidth = parseInt(getComputedStyle(this.timeLineContainerElement).width);
        const zoomedWidth = tlContainerWidth * this.zoomLevel;
        this.timelineMarkersCanvas.width = zoomedWidth;
        this.timelineElementsCanvas.width = zoomedWidth;
        (this.contents.querySelector('#timelineHeaderBg') as HTMLElement).style.width = (zoomedWidth + Playhead.WIDTH) + 'px';
        (this.contents.querySelector('#timelineTracksBg') as HTMLElement).style.width = (zoomedWidth + Playhead.WIDTH) + 'px';
        this.timeline.setupContexts();
        this.timeline.setScaleAndDrawMarkers();
        this.onTimelineScaleChanged(parseFloat(this.timelineLengthInput.value));
        this.timeLineContainerElement.scroll(this.timeline.getPlayheadX() - (tlContainerWidth / 2), 0);
        this.timeline.draw();
    }

    private onTimelineScaleChanged(lengthVal: number): void {
        // Update the playhead's position. Clamp it to the timeline length if necessary.
        let playheadTimePosValue = parseFloat(this.playheadTimePositionInput.value);
        if (playheadTimePosValue > lengthVal) {
            playheadTimePosValue = lengthVal;
            this.playheadTimePositionInput.value = lengthVal.toString();
            this.playheadTimePositionInput.dataset.prevValue = lengthVal.toString();
        }
        this.timeline.setPlayheadTimeSeconds(playheadTimePosValue, false);
    }

    private hideEditingUI(): void {
        this.saveAnimationBtn.setAttribute('hidden', '');
        this.keyframeControlsContents.setAttribute('hidden', '');
        this.studioControlsContainer.setAttribute('hidden', '');
        this.keyframeControlsDock.setAttribute('hidden', '');
    }

    private showEditingUI(): void {
        this.studioControlsContainer.removeAttribute('hidden');
        this.undoRedoBtnContainer.removeAttribute('hidden');
        this.saveAnimationBtn.removeAttribute('hidden');
        this.keyframeControlsDock.removeAttribute('hidden');
    }

    private onTabBtnClick = function(this: HTMLButtonElement, ev:MouseEvent) {
        const studioPanel = document.querySelector('#studioPanel');
        const targetId = this.dataset.target;
        const tabGroup = this.dataset.tabGroup;
        if (studioPanel && targetId && tabGroup) {
            const targetElement = studioPanel.querySelector(targetId);
            (this.parentElement?.querySelectorAll('button.TabBtn') as NodeListOf<HTMLElement>)
              .forEach((e) => setElementHighlighted(e, false));
            const clickedActive = !targetElement?.hasAttribute('hidden');
            studioPanel.querySelectorAll('.' + tabGroup).forEach((e) => e.setAttribute('hidden',''));
            if (!clickedActive) {
                targetElement?.removeAttribute('hidden');
                setElementHighlighted(this, true);
            }
        }
    };

    private handleGlobalInput = (ev: KeyboardEvent) => {
        const canvasActive = document.activeElement === document.querySelector('canvas')
        if (ev.key === 'Delete' && this.timeline.selectedKeyframeIcons.length && !ev.repeat) {
            this.deleteSelectedKeyframeIcons();
        } else if (ev.key === 'j' && !canvasActive) {
            this.prevKeyframe();
        } else if (ev.key === 'k' && !canvasActive) {
            this.nextKeyframe();
        } else if (ev.key === ',') {
            this.movePlayhead(-1 / 60);
        } else if (ev.key === '.') {
            this.movePlayhead(1 / 60);
        } else if (ev.key === ' ' && !canvasActive) {
            if (this.studioCameraController.isAnimationPlaying)
                this.stopAnimation();
            else
                this.playAnimation();
        } else if (ev.key === 'Enter') {
            this.addKeyframesFromMat4(mat4.clone(this.studioCameraController.camera.worldMatrix));
        } else if (ev.key === 'Escape') {
            this.stopAnimation();
            this.endEditKeyframePosition();
        } else if (ev.key === 'p') {
            console.log('test');
        }
    }

}
