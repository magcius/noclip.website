import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString, Slider, RadioButtons, HIGHLIGHT_COLOR } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { drawWorldSpaceLine, drawWorldSpacePoint, getDebugOverlayCanvas2D } from './DebugJunk';
import { Blue, Color, Green, Red, Magenta, Cyan } from './Color';
import { StudioCameraController } from './Camera';
import { clamp, computeEulerAngleRotationFromSRTMatrix, getMatrixAxisZ, lerp, invlerp, Vec3UnitY, Vec3Zero, MathConstants } from './MathHelpers';
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

const commonKfFieldsEqual = (kf1: Keyframe, kf2: Keyframe): boolean => {
    return kf1.time === kf2.time
        && kf1.interpInType === kf2.interpInType
        && kf1.interpOutType === kf2.interpOutType
        && kf1.easeInCoeff === kf2.easeInCoeff
        && kf1.easeOutCoeff === kf2.easeOutCoeff;
};

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

const enum TimelineMode {
    Consolidated,
    Position_LookAt_Bank,
    Full
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
        ctx.lineTo(this.x, ctx.canvas.height);
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
    static readonly DISABLED_TRACK_OVERLAY_COLOR: string = "rgba(0, 0, 0, 0.6)";
    static readonly DISABLED_TRACK_LINES_COLOR: string = "#646464";
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
    private selectionBoxIcons: KeyframeIcon[] = [];
    private disabledTrackOverlayPaths: Path2D[] = [];
    public grabbedIcon: KeyframeIcon | undefined = undefined;
    private grabbedIconInitialXPos: number = -1;
    private selectionBoxStartVertex: vec2 = vec2.create();
    private selectionBoxEndVertex: vec2 = vec2.create();
    public selectionBoxActive: boolean = false;
    public keyframeIcons: KeyframeIcon[] = [];
    public selectedKeyframeIcons: KeyframeIcon[] = [];
    public playheadGrabbed: boolean = false;
    public snappingEnabled: boolean = false;

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

    public setTimelineMode(timelineMode: TimelineMode, selectedTracks: KeyframeTrackType): void {
        if (timelineMode === TimelineMode.Consolidated)
            this.elementsCtx.canvas.height = Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT;
        else if (timelineMode === TimelineMode.Position_LookAt_Bank)
            this.elementsCtx.canvas.height = Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT * 3;
        else if (timelineMode === TimelineMode.Full)
            this.elementsCtx.canvas.height = Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT * 7;

        this.setScaleAndDrawMarkers();
        this.updateTrackSelection(timelineMode, selectedTracks);
        this.draw();
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

        this.elementsCtx.fillStyle = Timeline.DISABLED_TRACK_OVERLAY_COLOR;
        this.elementsCtx.strokeStyle = Timeline.DISABLED_TRACK_LINES_COLOR;
        for (let i = 0; i < this.disabledTrackOverlayPaths.length; i++) {
            this.elementsCtx.beginPath();
            this.elementsCtx.fill(this.disabledTrackOverlayPaths[i]);
            this.elementsCtx.stroke(this.disabledTrackOverlayPaths[i]);
        }
        this.elementsCtx.save();
    }

    public addKeyframeIcon(kfs: Map<KeyframeTrackType, Keyframe>, t: number, y: number, type: KeyframeIconType) {
        const xPos = (t / MILLISECONDS_IN_SECOND) * (this.pixelsPerSecond / this.timelineScaleFactor);
        const kfIcon = new KeyframeIcon(kfs, xPos, y, t, type);
        this.keyframeIcons.push(kfIcon);
        this.keyframeIcons.sort((a, b) => a.getX() - b.getX());
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

    public moveLoopEndframeIcons(t: number): void {
        let x = (t / MILLISECONDS_IN_SECOND) * this.pixelsPerSecond / this.timelineScaleFactor
        for (const kfIcon of this.keyframeIcons) {
            if (kfIcon.type === KeyframeIconType.Loop_End) {
                kfIcon.updatePosition(x, t);
            }
        }
    }

    public onMouseDown(e: MouseEvent) {
        e.stopPropagation();
        // Check if click landed on playhead, or the part of the timeline where markers are displayed
        if (this.elementsCtx.isPointInPath(this.playhead.playheadPath, e.offsetX, e.offsetY) ||
            this.elementsCtx.isPointInPath(this.timelineHeaderPath, e.offsetX, e.offsetY)) {
            this.playheadGrabbed = true;
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
                    this.grabbedIcon = kfIcon;
                    this.grabbedIconInitialXPos = kfIcon.getX();
                    break;
                }
            }
            if (!this.grabbedIcon) {
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
        this.selectionBoxActive = false;
        this.selectionBoxIcons = [];
        this.grabbedIcon = undefined;
        this.grabbedIconInitialXPos = -1;
        this.draw();
    }

    public onMouseMove(e: MouseEvent) {
        if ((!this.playheadGrabbed && !this.grabbedIcon && !this.selectionBoxActive)
            || (this.grabbedIcon && this.selectedKeyframeIcons.some((icon) => icon.type === KeyframeIconType.Start)))
            return;

        let targetX = e.offsetX;
        if (e.target !== this.elementsCtx.canvas)
            targetX = e.clientX - this.elementsCtx.canvas.getBoundingClientRect().x;

        targetX = clamp(targetX, Playhead.HALF_WIDTH, this.width - Playhead.HALF_WIDTH);
        targetX -= Playhead.HALF_WIDTH;

        const prevSnapping = this.snappingEnabled;
        this.snappingEnabled = this.snappingEnabled || e.shiftKey;

        if (this.playheadGrabbed) {
            const snapKfIndex = this.getClosestSnappingIconIndex(targetX);
            if (snapKfIndex > -1) {
                if (this.snappingEnabled)
                    targetX = this.keyframeIcons[snapKfIndex].getX();

                // If the playhead is directly on a keyframe, highlight it and any others at the same position.
                if (targetX === this.keyframeIcons[snapKfIndex].getX()) {
                    this.deselectAllKeyframeIcons();
                    this.selectKeyframeIconsAtTime(this.keyframeIcons[snapKfIndex].getT());
                }
            }

            const t = targetX / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
            this.playhead.updatePosition(targetX, t);
        } else if (this.grabbedIcon && this.selectedKeyframeIcons.length) {
            if (this.selectedKeyframeIcons.length === 1) {
                // Don't allow a loop keyframe icon to be moved before any other keyframes.
                if (this.selectedKeyframeIcons[0].type === KeyframeIconType.Loop_End) {
                    let minAllowedX = 0;
                    for (const kfIcon of this.keyframeIcons) {
                        if (kfIcon.type !== KeyframeIconType.Loop_End && kfIcon.getX() > minAllowedX)
                            minAllowedX = kfIcon.getX();
                    }

                    targetX = clamp(targetX, minAllowedX + Timeline.SNAP_DISTANCE_PX, this.width - Playhead.HALF_WIDTH);
                } else if (this.keyframeIcons[this.keyframeIcons.length - 1].type === KeyframeIconType.Loop_End) {
                    targetX = clamp(targetX, this.keyframeIcons[0].getX() + Timeline.SNAP_DISTANCE_PX, this.keyframeIcons[this.keyframeIcons.length - 1].getX() - Timeline.SNAP_DISTANCE_PX);
                }

                if (this.snappingEnabled && Math.abs(targetX - this.playhead.getX()) < Timeline.SNAP_DISTANCE_PX)
                    this.updateKeyframeIconPosition(this.selectedKeyframeIcons[0], this.playhead.getX());
                else
                    this.updateKeyframeIconPosition(this.selectedKeyframeIcons[0], targetX);
            } else {
                if (this.snappingEnabled && Math.abs(targetX - this.playhead.getX()) < Timeline.SNAP_DISTANCE_PX)
                    targetX = this.playhead.getX();
                // Moving multiple icons. Check if moving all of them will cause
                // any of them to be in an illegal position.
                if (this.canMoveGroupTo(targetX)) {
                    const grabbedX = this.grabbedIcon.getX();
                    let movedLoopEndIcons = false;
                    for (const kfIcon of this.selectedKeyframeIcons) {
                        if (kfIcon.type === KeyframeIconType.Loop_End && movedLoopEndIcons)
                            continue;
                        this.updateKeyframeIconPosition(kfIcon, targetX + (kfIcon.getX() - grabbedX));
                        if (kfIcon.type === KeyframeIconType.Loop_End)
                            movedLoopEndIcons = true;
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
        this.snappingEnabled = prevSnapping;

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
                if (selectedIcon.type === KeyframeIconType.Loop_End && !kfIcon.selected
                    && kfIcon.type !== KeyframeIconType.Loop_End
                    && newX < kfIcon.getX() + Timeline.SNAP_DISTANCE_PX)
                    return false;
                else if (kfIcon.selected || kfIcon.getY() !== selectedIcon.getY())
                    continue;
                if (newX < Timeline.SNAP_DISTANCE_PX
                    || (newX > kfIcon.getX() - Timeline.SNAP_DISTANCE_PX
                        && newX < kfIcon.getX() + Timeline.SNAP_DISTANCE_PX)
                    || (kfIcon.type === KeyframeIconType.Loop_End
                        && newX > kfIcon.getX() - Timeline.SNAP_DISTANCE_PX)
                    || (newX > this.width - Playhead.HALF_WIDTH))
                    return false;
            }
        }
        return true;
    }

    public hasGrabbedIconMoved(): boolean {
        return this.grabbedIcon !== undefined
        && this.grabbedIconInitialXPos !== -1 
        && this.grabbedIconInitialXPos !== this.grabbedIcon.getX();
    }

    public selectKeyframeIcon(kfIcon: KeyframeIcon) {
        if (this.selectedKeyframeIcons.includes(kfIcon))
            return;
        kfIcon.selected = true;
        this.selectedKeyframeIcons.push(kfIcon);
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeSelected', { bubbles: false }));
    }

    public selectKeyframeIconsAtTime(t: number) {
        for (const kfIcon of this.keyframeIcons) {
            if (kfIcon.getT() === t && !this.selectedKeyframeIcons.includes(kfIcon)) {
                kfIcon.selected = true;
                this.selectedKeyframeIcons.push(kfIcon);
            }
        }
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeSelected', { bubbles: false }));
    }
    
    public reselectKeyframes(indices: number[]) {
        this.selectedKeyframeIcons = [];
        for (const i of indices) {
            this.selectedKeyframeIcons.push(this.keyframeIcons[i]);
            this.keyframeIcons[i].selected = true;
        }
    }
    
    private deselectKeyframeIcon(kfIcon: KeyframeIcon) {
        const index = this.selectedKeyframeIcons.indexOf(kfIcon);
        if (index !== -1) {
            this.selectedKeyframeIcons.splice(index, 1);
            kfIcon.selected = false;
            if (kfIcon.type === KeyframeIconType.Start || kfIcon.type === KeyframeIconType.Loop_End) {
                for (const icon of this.keyframeIcons) {
                    if (icon.type === kfIcon.type) {
                        const linkedKfIndex = this.selectedKeyframeIcons.indexOf(icon);
                        if (linkedKfIndex !== -1) {
                            this.selectedKeyframeIcons.splice(linkedKfIndex, 1);
                            icon.selected = false;
                        }
                    }
                }
            }
            this.elementsCtx.canvas.dispatchEvent(new Event('keyframeDeselected', { bubbles: false }));
        }
    }

    public deselectAllKeyframeIcons() {
        let deselected = false;
        for (const kfIcon of this.selectedKeyframeIcons) {
            kfIcon.selected = false;
            deselected = true;
        }
        this.selectedKeyframeIcons = [];
        if (deselected)
            this.elementsCtx.canvas.dispatchEvent(new Event('keyframeDeselected', { bubbles: false }));
    }

    public getSelectedKeyframeIndices(): number[] {
        const indices = [];
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            if (this.keyframeIcons[i].selected)
                indices.push(i);
        }
        return indices;
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
        let t = x / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
        const snapKfIndex = this.getClosestSnappingIconIndex(x, icon);
        if (snapKfIndex > -1) {
            if (icon && this.keyframeIcons[snapKfIndex].getY() === icon.getY()) {
                x = this.ensureIconDistance(x, this.keyframeIcons[snapKfIndex].getX(), Timeline.SNAP_DISTANCE_PX);
                t = x / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
            } else if (this.snappingEnabled) {
                x = this.keyframeIcons[snapKfIndex].getX();
                t = this.keyframeIcons[snapKfIndex].getT();
            }
        }
        if (icon.type === KeyframeIconType.Loop_End) {
            for (const kfIcon of this.keyframeIcons) {
                if (kfIcon.type === KeyframeIconType.Loop_End) {
                    kfIcon.updatePosition(x, t);
                }
            }
        } else {
            icon.updatePosition(x, t);
        }
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeIconMovedEvent', { bubbles: false }));
    }

    /**
     * Returns the index of the closest icon within snapping distance, or -1 if there are no icons that can be snapped to.
     */
    private getClosestSnappingIconIndex(x: number, icon?: KeyframeIcon): number {
        let closestDist = Timeline.SNAP_DISTANCE_PX;
        let snapKfIndex = -1;
        for (let i = 0; i < this.keyframeIcons.length && closestDist > 0; i++) {
            // If we're moving a keyframe icon, don't check distance against itself or any other selected icons.
            if (icon && this.keyframeIcons[i].selected)
                continue;
            const dist = Math.abs(x - this.keyframeIcons[i].getX());
            if (dist <= closestDist) {
                if (!icon || snapKfIndex === -1 || (icon.getY() === this.keyframeIcons[i].getY())) {
                    snapKfIndex = i;
                    closestDist = dist;
                }
            }
        }
        return snapKfIndex;
    }

    public setPlayheadTimeSeconds(t: number, selectLandedKeyframe: boolean) {
        const x = t * this.pixelsPerSecond / this.timelineScaleFactor;
        this.playhead.updatePosition(x, t * MILLISECONDS_IN_SECOND);
        if (selectLandedKeyframe) {
            const snapKfIndex = this.getClosestSnappingIconIndex(x);
            if (snapKfIndex > -1 && x === this.keyframeIcons[snapKfIndex].getX()) {
                this.deselectAllKeyframeIcons();
                // If the playhead is directly on a keyframe, highlight it and any others at the same t-val.
                this.selectKeyframeIconsAtTime(this.playhead.getT());
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
                this.selectKeyframeIconsAtTime(jumpIcon.getT());
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
                this.selectKeyframeIconsAtTime(jumpIcon.getT());
                break;
            }
        }
        this.draw();
    }

    public updateTrackSelection(timelineMode: TimelineMode, selectedTracks: number) {
        this.disabledTrackOverlayPaths = [];
        if (timelineMode === TimelineMode.Consolidated || selectedTracks === KeyframeTrackType.allTracks) {
            this.draw();
            return;
        }

        const createOverlayPath = (trackNumber: number): Path2D => {
            const path = new Path2D();
            path.moveTo(-Playhead.WIDTH, Timeline.HEADER_HEIGHT + (Timeline.TRACK_HEIGHT * (trackNumber + 1)));
            const lineCount = Math.ceil((this.elementsCtx.canvas.width + Playhead.WIDTH) / Playhead.WIDTH);
            for (let i = 0; i < lineCount; i++) {
                path.lineTo(i * Playhead.WIDTH, Timeline.HEADER_HEIGHT + (Timeline.TRACK_HEIGHT * trackNumber));
                path.moveTo(i * Playhead.WIDTH, Timeline.HEADER_HEIGHT + (Timeline.TRACK_HEIGHT * (trackNumber + 1)));
            }
            const subPath = new Path2D();
            subPath.rect(-Playhead.WIDTH, Timeline.HEADER_HEIGHT + (Timeline.TRACK_HEIGHT * trackNumber), this.elementsCtx.canvas.width + Playhead.WIDTH, Timeline.TRACK_HEIGHT);
            path.addPath(subPath);
            return path;
        }

        if (timelineMode === TimelineMode.Position_LookAt_Bank) {   
            if ((selectedTracks & KeyframeTrackType.posXTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(0));
            
            if ((selectedTracks & KeyframeTrackType.lookAtXTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(1));

            if ((selectedTracks & KeyframeTrackType.bankTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(2));
        } else {
            if ((selectedTracks & KeyframeTrackType.posXTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(0));
    
            if ((selectedTracks & KeyframeTrackType.posYTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(1));
                
            if ((selectedTracks & KeyframeTrackType.posZTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(2));
                
            if ((selectedTracks & KeyframeTrackType.lookAtXTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(3));
                
            if ((selectedTracks & KeyframeTrackType.lookAtYTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(4));
                
            if ((selectedTracks & KeyframeTrackType.lookAtZTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(5));
                
            if ((selectedTracks & KeyframeTrackType.bankTrack) === 0)
                this.disabledTrackOverlayPaths.push(createOverlayPath(6));
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

    public playheadIsOnIcon(): boolean {
        for (const kfIcon of this.keyframeIcons) {
            if (this.playhead.getT() === kfIcon.getT())
                return true;
        }
        return false;
    }

    public getSelectedIconForTrack(trackType: KeyframeTrackType): KeyframeIcon {
        for (const kfIcon of this.selectedKeyframeIcons) {
            if (kfIcon.keyframesMap.has(trackType))
                return kfIcon;
        }
        throw 'Attempted to get icon of non-selected track';
    }
    
    public getLoopEndKeyframeForTrack(trackType: KeyframeTrackType): Keyframe {
        for (const kfIcon of this.keyframeIcons) {
            if (kfIcon.type === KeyframeIconType.Loop_End) {
                const kf = kfIcon.keyframesMap.get(trackType);
                if (kf !== undefined)
                    return kf;
            }
        }
        throw 'No end loop keyframe icon exists for track.';
    }

    public getStartKeyframeForTrack(trackType: KeyframeTrackType): Keyframe {
        for (const kfIcon of this.keyframeIcons) {
            if (kfIcon.type === KeyframeIconType.Start) {
                const kf = kfIcon.keyframesMap.get(trackType);
                if (kf !== undefined)
                    return kf;
            }
        }
        // Should never happen... obviously.
        throw 'No start keyframe icon exists for track.';
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

    private getCurrentTrackValue(track: KeyframeTrack, time: number, normalizeBankForLoop?: boolean): number {
        const idx1 = this.findKeyframe(track.keyframes, time);
        if (idx1 === 0)
            return track.keyframes[0].value;
        if (idx1 < 0)
            return track.keyframes[track.keyframes.length - 1].value;

        const idx0 = idx1 - 1;
        const k0 = track.keyframes[idx0], k1 = track.keyframes[idx1];

        let t = invlerp(k0.time, k1.time, time);
        
        let p0 = k0.value;
        let p1 = k1.value;
        if (normalizeBankForLoop && idx1 === track.keyframes.length - 1)
            p0 %= MathConstants.TAU;
        let tOut = k0.tangentOut;
        let tIn = k1.tangentIn;
        let interpType = k0.interpOutType;
    
        // Here we have some makeshift logic for mixed interpolation types between keyframes.
        // We lerp to/from the midpoint of the hermite curve rather than to the other keyframe.
        // TODO - Improve this. There are no value discontinuities with this approach, but it's still very janky.
        if (k0.interpOutType !== k1.interpInType) {
            if (t > 0.5) {
                interpType = k1.interpInType;
                if (interpType === InterpolationType.Linear) {
                    t -= 0.5;
                    t /= 0.5;
                    p0 = getPointHermite(p0, p1, tOut, tIn, 0.5);
                }
            } else if (interpType === InterpolationType.Linear) {
                t /= 0.5;
                p1 = getPointHermite(p0, p1, tOut, tIn, 0.5);
            }
        }
        
        if (interpType === InterpolationType.Ease)
            return getPointHermite(p0, p1, tOut, tIn, t);
        else if (interpType === InterpolationType.Linear)
            return lerp(p0, p1, t);
        else if (interpType === InterpolationType.Hold)
            return p0;
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
        dst.bank = this.getCurrentTrackValue(animation.bankTrack, time, animation.loop);
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
    timelineMode: TimelineMode;
    selectedKeyframeIndices: number[];
}

interface studioSettings {
    drawPreviewLine: boolean;
    livePreview: boolean;
    autoSave: boolean;
}

export class StudioPanel extends FloatingPanel {
    static readonly FULL_TIMELINE_BG: string = 'repeating-linear-gradient(#494949, #494949 20px, #2f2f2f 20px, #2f2f2f 40px, #494949 40px, #494949 59px, #a5a5a5 59px, #a5a5a5 61px, #2f2f2f 61px, #2f2f2f 80px, #494949 80px, #494949 100px, #2f2f2f 100px, #2f2f2f 119px, #a5a5a5 119px, #a5a5a5 121px)';
    static readonly DEFAULT_TIMELINE_BG: string = 'repeating-linear-gradient(#494949, #494949 20px, #2f2f2f 20px, #2f2f2f 40px)';
    static readonly PREVIEW_STEP_TIME_MS: number = 16;

    private animationManager: CameraAnimationManager;
    public studioCameraController: StudioCameraController;

    private animation: CameraAnimation;
    private studioStates: StudioState[] = [];
    private currentStateIndex: number = -1;
    private animationPreviewSteps: InterpolationStep[] = [];

    private studioPanelContents: HTMLElement;
    private studioHelpText: HTMLElement;

    private undoRedoBtnContainer: HTMLElement;
    private undoBtn: HTMLButtonElement;
    private redoBtn: HTMLButtonElement;

    private studioControlsContainer: HTMLElement;
    private studioDataTabBtn: HTMLButtonElement;
    private settingsTabBtn: HTMLButtonElement;
    private newAnimationBtn: HTMLButtonElement;
    private loadAnimationBtn: HTMLButtonElement;
    private saveAnimationBtn: HTMLButtonElement;
    private importAnimationBtn: HTMLButtonElement;
    private exportAnimationBtn: HTMLButtonElement;
    private helpBtn: HTMLButtonElement;
    private studioSettingsContainer: HTMLElement;
    private timelineModeSelect: HTMLSelectElement;
    private showPreviewLineCheckbox: Checkbox;
    private livePreviewCheckbox: Checkbox;
    private autoSaveCheckbox: Checkbox;

    private recordPlaybackBtn: HTMLButtonElement;

    private timeLineContainerElement: HTMLElement;
    private snapBtn: HTMLButtonElement;
    private playheadTimePositionInput: HTMLInputElement;
    private timelineLengthInput: HTMLInputElement;

    private positionLookAtBankLabels: HTMLElement;
    private fullLabels: HTMLElement;
    private trackSelectBoxes: NodeListOf<HTMLElement>;
    private timelineMarkersCanvas: HTMLCanvasElement;
    private timelineElementsCanvas: HTMLCanvasElement;
    private timelineHeaderBg: HTMLElement;
    private timelineTracksBg: HTMLElement;

    private zoomLevel: number = 1;
    private zoomOutBtn: HTMLButtonElement;
    private zoomInBtn: HTMLButtonElement;

    private loopAnimationBtn: HTMLButtonElement;
    private playAnimationBtn: HTMLButtonElement;
    private stopAnimationBtn: HTMLButtonElement;
    private prevKeyframeBtn: HTMLButtonElement;
    private nextKeyframeBtn: HTMLButtonElement;

    private keyframeControlsDock: HTMLElement;
    private keyframeControlsContents: HTMLElement;
    private valuesTabBtn: HTMLButtonElement;
    private interpTabBtn: HTMLButtonElement;
    private selectKeyframeMsg: HTMLElement;

    private interpolationTab: HTMLElement;
    private interpInTypeBtns: RadioButtons;
    private interpOutTypeBtns: RadioButtons;
    private easeInSlider: Slider;
    private easeOutSlider: Slider;

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
    private bankRotationValCanvas: HTMLCanvasElement;
    private bankRotationValCanvasCtx: CanvasRenderingContext2D;
    private bankValueInput: HTMLInputElement;
    private lockPerspectiveBracket: HTMLElement;
    private lockPerspectiveDiv: HTMLElement;
    private lockPerspectiveBtn: HTMLButtonElement;
    private lockPerspective: boolean = true;

    private persistHelpText: boolean = false;

    public timeline: Timeline;
    private timelineMode: TimelineMode = TimelineMode.Consolidated;
    private selectedTracks: number = KeyframeTrackType.allTracks;

    private scratchVec3a: vec3 = vec3.create();
    private scratchVec3b: vec3 = vec3.create();
    private scratchVec3c: vec3 = vec3.create();
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
        this.mainPanel.parentElement!.style.height = '300px';
        this.mainPanel.parentElement!.style.left = '0px';
        this.mainPanel.parentElement!.style.bottom = '0px';
        this.mainPanel.parentElement!.style.top = '';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 1)';
        this.mainPanel.style.height = '100%';
        // Closing the panel will be done by disabling studio mode
        this.closeButton.style.display = 'none';

        const toggleMinimize = () => {
            const bBar = document.querySelector('#BottomBar') as HTMLElement;
            if (this.mainPanel.parentElement!.style.bottom === '-270px'){
                this.mainPanel.parentElement!.style.bottom = '0px';
                if (bBar)
                    bBar.style.bottom = (this.elem.getBoundingClientRect().height + 24) + 'px';
            }else {
                this.mainPanel.parentElement!.style.bottom = '-270px';
                if (bBar && bBar.dataset.ob)
                    bBar.style.bottom = bBar.dataset.ob;
            }
        }

        this.header.ondblclick = toggleMinimize;
        this.minimizeButton.onclick = toggleMinimize;
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
            #studioPanel a:visited {
                color: #eee;
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
            #recordPlaybackBtn {
                width: 10rem;
                margin: auto;
                height: 3rem;
            }
            #studioHelpText {
                line-height: 1.5;
                min-height: 1rem;
                text-align: center;
            }
            #trackLabels {
                line-height: 1.7;
                font-size: 12px;
                margin: 25px 0 0 10px;
            }
            #trackLabels .TrackSelectBox {
                cursor: pointer;
                width: 10px;
                height: 10px;
                justify-self: center;
                margin: 0 5px 0 10px;
                border-radius: 4px;
                border: 2px solid #aaa;
                background-color: transparent;
            }
            #trackLabels .TrackSelectBox.Selected {
                border: 2px solid white;
                background-color: rgb(210, 30, 30);
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
            .label-col > div {
                height: 20px;
            }
            .label-col > div, .label-container > div {
                display: flex;
                align-items: center;
                justify-content: end;
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
                background: ${StudioPanel.DEFAULT_TIMELINE_BG};
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
                cursor: grab;
                user-select: none;
            }
            .StudioNumericInput.manual-entry {
                cursor: text;
                user-select: text;
            }
            #customValuesContainer {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                text-align: center;
                margin-top: 0.5rem;
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
        <div style="padding: 0.5rem; border-right: 2px dotted #696969; position: relative;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <div id="undoRedoBtnContainer" hidden>
                    <button type="button" id="undoBtn" class="SettingsButton disabled" disabled></button>
                    <button type="button" id="redoBtn" class="SettingsButton disabled" disabled></button>
                </div>
                <button type="button" id="saveAnimationBtn" class="SettingsButton" hidden>Save</button>
            </div>
            <div style="display: flex;">
                <button id="studioDataTabBtn" class="SettingsButton TabBtn" data-tab-group="StudioPanelTab" data-target="#studioSaveLoadControls">📁</button>
                <button id="settingsTabBtn" class="SettingsButton TabBtn" data-tab-group="StudioPanelTab" data-target="#settingsTab">⚙</button>
            </div>
            <div>
                <div id="studioSaveLoadControls" class="StudioPanelTab" hidden>
                    <div style="display: grid;grid-template-columns: 1fr 1fr; gap: 0.25rem 1rem; margin-top: 0.5rem;">
                        <button type="button" id="newAnimationBtn" class="SettingsButton">New</button>
                        <button type="button" id="loadAnimationBtn" class="SettingsButton">Load</button>
                        <button type="button" id="importAnimationBtn" class="SettingsButton">Import</button>
                        <button type="button" id="exportAnimationBtn" class="SettingsButton">Export</button>
                        <button type="button" id="helpBtn" class="SettingsButton">Help</button>
                    </div>
                    <div style="position: absolute; bottom: 3rem; height: 3rem; left: 50%; transform: translate(-50%, 0);">
                        <button type="button" id="recordPlaybackBtn" class="SettingsButton"></button>
                    </div>
                </div>
                <div id="settingsTab" class="StudioPanelTab" hidden>
                    <div id="studioSettingsContainer">
                        <div style="text-align: center;">Studio Settings</div>
                        <div>
                            <span>Timeline Mode:</span>
                            <select id="timelineModeSelect">
                                <option value="${TimelineMode.Consolidated}">Consolidated</option>
                                <option value="${TimelineMode.Position_LookAt_Bank}">Pos/LookAt/Bank</option>
                                <option value="${TimelineMode.Full}">Full</option>
                            </select>
                        </div>
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
                                <div>Position <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.posXTrack},${KeyframeTrackType.posYTrack},${KeyframeTrackType.posZTrack}"></div></div>
                                <div>LookAt <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.lookAtXTrack},${KeyframeTrackType.lookAtYTrack},${KeyframeTrackType.lookAtZTrack}"></div></div>
                                <div>Bank <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.bankTrack}"></div></div>
                            </div>
                        </div>
                        <div id="fullLabels" hidden>
                            <div class="label-container" style="border-bottom: 1px solid white;">
                                <span>Position</span>
                                <div class="label-col">
                                    <div>X <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.posXTrack}"></div></div>
                                    <div>Y <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.posYTrack}"></div></div>
                                    <div>Z <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.posZTrack}"></div></div>
                                </div>
                            </div>
                            <div class="label-container" style="margin-top: -1px; border-bottom: 1px solid white;">
                                <span>LookAt</span>
                                <div class="label-col">
                                    <div>X <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.lookAtXTrack}"></div></div>
                                    <div>Y <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.lookAtYTrack}"></div></div>
                                    <div>Z <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.lookAtZTrack}"></div></div>
                                </div>
                            </div>
                            <div class="label-container">
                                <div>Bank <div class="TrackSelectBox Selected" data-tracks="${KeyframeTrackType.bankTrack}"></div></div>
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
                        <div id="customValuesContainer">
                            <div>
                                <div id="posXValueInputContainer"><span>X Position:</span> <input id="posXValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.posXTrack}" type="number" step="1.0" value="0"></div>
                                <div id="posYValueInputContainer"><span>Y Position:</span> <input id="posYValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.posYTrack}" type="number" step="1.0" value="0"></div>
                                <div id="posZValueInputContainer"><span>Z Position:</span> <input id="posZValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.posZTrack}" type="number" step="1.0" value="0"></div>
                            </div>
                            <div>
                                <div id="lookAtXValueInputContainer"><span>LookAt X:</span> <input id="lookAtXValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.lookAtXTrack}" type="number" step="1.0" value="0"></div>
                                <div id="lookAtYValueInputContainer"><span>LookAt Y:</span> <input id="lookAtYValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.lookAtYTrack}" type="number" step="1.0" value="0"></div>
                                <div id="lookAtZValueInputContainer"><span>LookAt Z:</span> <input id="lookAtZValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.lookAtZTrack}" type="number" step="1.0" value="0"></div>
                            </div>
                            <div id="bankValueInputContainer">
                                <span>Bank rotation:</span>
                                <canvas id="bankRotationValCanvas" width="80" height="80"></canvas>
                                <input id="bankValueInput" class="StudioNumericInput" data-track="${KeyframeTrackType.bankTrack}" type="number" step="1" value="0">
                            </div>
                            <div id="lockPerspectiveBracket"></div>
                            <div id="lockPerspective">
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
        this.settingsTabBtn = this.contents.querySelector('#settingsTabBtn') as HTMLButtonElement;
        this.settingsTabBtn.title = 'Settings';

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

        this.helpBtn = this.contents.querySelector('#helpBtn') as HTMLButtonElement;
        this.helpBtn.onclick = () => {
            const helpLink = document.createElement('a') as HTMLAnchorElement;
            helpLink.rel = 'noopener noreferrer';
            helpLink.target = '_blank';
            helpLink.href = 'https://github.com/magcius/noclip.website/wiki/Studio';
            helpLink.click();
        }

        this.studioControlsContainer = this.contents.querySelector('#studioControlsContainer') as HTMLElement;

        this.studioDataTabBtn.addEventListener('click', this.onTabBtnClick);
        setElementHighlighted(this.studioDataTabBtn, false);
        this.newAnimationBtn.onclick = () => {
            this.newAnimation();
            this.saveState();
        }
        this.loadAnimationBtn.onclick = () => this.loadAnimation();
        this.saveAnimationBtn.onclick = () => {
            this.saveAnimation();
            this.displayMessage('Saved animation to local storage.');
        }
        this.exportAnimationBtn.onclick = () => this.exportAnimation();
        this.importAnimationBtn.onclick = () => this.importAnimation();

        this.settingsTabBtn.addEventListener('click', this.onTabBtnClick);
        setElementHighlighted(this.settingsTabBtn, false);

        const canChangeToMode = (newMode: TimelineMode): boolean => {
            // We're always able to switch to a larger timeline.
            if (this.timelineMode === TimelineMode.Consolidated 
                || (this.timelineMode === TimelineMode.Position_LookAt_Bank && newMode === TimelineMode.Full))
                return true;
            
            if (newMode === TimelineMode.Consolidated) {
                if (this.animation.posXTrack.keyframes.length !== this.animation.posYTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.posZTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.lookAtXTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.lookAtYTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.lookAtZTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.bankTrack.keyframes.length) {
                        return false;
                }
                for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
                    if (!commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.posYTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.posZTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.lookAtXTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.lookAtYTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.lookAtZTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.bankTrack.keyframes[i]))
                        return false;
                }
            } else if (newMode === TimelineMode.Position_LookAt_Bank) {
                if (this.animation.posXTrack.keyframes.length !== this.animation.posYTrack.keyframes.length
                    || this.animation.posXTrack.keyframes.length !== this.animation.posZTrack.keyframes.length
                    || this.animation.lookAtXTrack.keyframes.length !== this.animation.lookAtYTrack.keyframes.length
                    || this.animation.lookAtXTrack.keyframes.length !== this.animation.lookAtZTrack.keyframes.length) {
                        return false;
                }
                for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
                    if (!commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.posYTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.posXTrack.keyframes[i], this.animation.posZTrack.keyframes[i]))
                        return false;
                }
                for (let i = 0; i < this.animation.lookAtXTrack.keyframes.length; i++) {
                    if (!commonKfFieldsEqual(this.animation.lookAtXTrack.keyframes[i], this.animation.lookAtYTrack.keyframes[i])
                        || !commonKfFieldsEqual(this.animation.lookAtXTrack.keyframes[i], this.animation.lookAtZTrack.keyframes[i]))
                        return false;
                }
            }

            return true;
        };

        this.timelineModeSelect = this.contents.querySelector('#timelineModeSelect') as HTMLSelectElement;
        this.timelineModeSelect.onchange = () => {
            const newMode = parseInt(this.timelineModeSelect.value);
            if (!canChangeToMode(newMode)) {
                this.displayError('Cannot flatten timeline unless keyframes are aligned. ',
                  'See Help for details.', 'https://github.com/magcius/noclip.website/wiki/Studio#consolidating-timeline');
                this.timelineModeSelect.selectedIndex = this.timelineMode;
                return;
            }

            this.trackSelectBoxes.forEach((e) => e.classList.add('Selected'));
            this.timelineTracksBg.style.background = StudioPanel.DEFAULT_TIMELINE_BG;
            if (newMode === TimelineMode.Consolidated) {
                this.positionLookAtBankLabels.setAttribute('hidden','');
                this.fullLabels.setAttribute('hidden','');
                this.selectedTracks = KeyframeTrackType.allTracks;
            } else {
                this.trackSelectBoxes.forEach((e) => {
                    const tracks: number[] = e.dataset.tracks!.split(',').map(v => parseInt(v));
                    if (tracks.every((v) => (this.selectedTracks & v) === 0))
                        e.classList.remove('Selected');
                    else
                        tracks.forEach((t) => this.selectedTracks |= t);
                });
                if (newMode === TimelineMode.Position_LookAt_Bank) {
                    this.positionLookAtBankLabels.removeAttribute('hidden');
                    this.fullLabels.setAttribute('hidden','');
                } else if (newMode === TimelineMode.Full) {
                    this.timelineTracksBg.style.background = StudioPanel.FULL_TIMELINE_BG;
                    this.positionLookAtBankLabels.setAttribute('hidden','');
                    this.fullLabels.removeAttribute('hidden');
                }
            }

            this.timelineMode = newMode;
            this.reAddAllKeyframeIcons();
            this.timeline.setTimelineMode(this.timelineMode, this.selectedTracks);
            this.timelineTracksBg.style.height = (this.timelineElementsCanvas.height - Timeline.HEADER_HEIGHT) + 'px';
            this.rescaleTimelineContainer();
        }

        this.showPreviewLineCheckbox = new Checkbox('Show Animation Preview Line', true);
        this.showPreviewLineCheckbox.elem.title = 'Show/Hide the line indicating the path of the animation.';
        this.showPreviewLineCheckbox.onchanged = () => {
            if (this.showPreviewLineCheckbox.checked)
                this.updatePreviewSteps();
            // TODO - Customize preview line colours?
            this.saveStudioSettings();
        };
        this.livePreviewCheckbox = new Checkbox('Live Preview');
        this.livePreviewCheckbox.elem.title = 'Preview the animation when moving the playhead or keyframes.';
        this.livePreviewCheckbox.onchanged = () => {
            if (this.livePreviewCheckbox.checked)
                this.updatePreviewSteps();
            this.saveStudioSettings();
        }
        this.autoSaveCheckbox = new Checkbox('Auto-Save');
        this.autoSaveCheckbox.elem.title = 'Auto-save the current animation on every modification.';
        this.autoSaveCheckbox.checked = true;
        this.autoSaveCheckbox.onchanged = () => this.saveStudioSettings();

        this.studioSettingsContainer = this.contents.querySelector('#studioSettingsContainer') as HTMLElement;
        this.studioSettingsContainer.insertAdjacentElement('beforeend', this.showPreviewLineCheckbox.elem);
        this.studioSettingsContainer.insertAdjacentElement('beforeend', this.livePreviewCheckbox.elem);
        this.studioSettingsContainer.insertAdjacentElement('beforeend', this.autoSaveCheckbox.elem);

        this.recordPlaybackBtn = this.contents.querySelector('#recordPlaybackBtn') as HTMLButtonElement;
        const icon = createDOMFromString(CLAPBOARD_ICON).querySelector('svg')!;
        icon.setAttribute('height','30');
        this.recordPlaybackBtn.appendChild(icon);
        this.recordPlaybackBtn.onclick = () => this.playAnimation(true);

        this.timeLineContainerElement = this.contents.querySelector('#timelineContainer') as HTMLElement;

        this.positionLookAtBankLabels = this.contents.querySelector('#positionLookAtBankLabels') as HTMLElement;
        this.fullLabels = this.contents.querySelector('#fullLabels') as HTMLElement;
        this.trackSelectBoxes = this.contents.querySelectorAll('.TrackSelectBox') as NodeListOf<HTMLElement>;
        this.trackSelectBoxes.forEach((e) => {
            e.addEventListener('click', () => {
                e.classList.toggle('Selected');
                const tracks: number[] = e.dataset.tracks!.split(',').map(v => parseInt(v));
                if (e.classList.contains('Selected')) {
                    tracks.forEach((t) => this.selectedTracks |= t);
                } else {
                    tracks.forEach((t) => this.selectedTracks ^= t);
                }
                this.timeline.updateTrackSelection(this.timelineMode, this.selectedTracks);
            });
        });

        this.timelineMarkersCanvas = this.contents.querySelector('#timelineMarkersCanvas') as HTMLCanvasElement;
        this.timelineElementsCanvas = this.contents.querySelector('#timelineElementsCanvas') as HTMLCanvasElement;
        this.timelineHeaderBg = this.contents.querySelector('#timelineHeaderBg') as HTMLElement;
        this.timelineTracksBg = this.contents.querySelector('#timelineTracksBg') as HTMLElement;

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

            this.timeline.setPlayheadTimeSeconds(timePosValue, !this.studioCameraController.isAnimationPlaying);
            this.playheadTimePositionInput.dataset.prevValue = timePosValue.toString();

            if (!this.studioCameraController.isAnimationPlaying && this.livePreviewCheckbox.checked)
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
                this.deleteLoopEndFrames();
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
        this.interpolationTab = this.contents.querySelector('#interpolationTab') as HTMLElement;

        this.posXValueInputContainer = this.contents.querySelector('#posXValueInputContainer') as HTMLElement;
        this.posYValueInputContainer = this.contents.querySelector('#posYValueInputContainer') as HTMLElement;
        this.posZValueInputContainer = this.contents.querySelector('#posZValueInputContainer') as HTMLElement;
        this.lookAtXValueInputContainer = this.contents.querySelector('#lookAtXValueInputContainer') as HTMLElement;
        this.lookAtYValueInputContainer = this.contents.querySelector('#lookAtYValueInputContainer') as HTMLElement;
        this.lookAtZValueInputContainer = this.contents.querySelector('#lookAtZValueInputContainer') as HTMLElement;
        this.bankValueInputContainer = this.contents.querySelector('#bankValueInputContainer') as HTMLElement;
        this.posXValueInput = this.contents.querySelector('#posXValueInput') as HTMLInputElement;
        this.posYValueInput = this.contents.querySelector('#posYValueInput') as HTMLInputElement;
        this.posZValueInput = this.contents.querySelector('#posZValueInput') as HTMLInputElement;
        this.lookAtXValueInput = this.contents.querySelector('#lookAtXValueInput') as HTMLInputElement;
        this.lookAtYValueInput = this.contents.querySelector('#lookAtYValueInput') as HTMLInputElement;
        this.lookAtZValueInput = this.contents.querySelector('#lookAtZValueInput') as HTMLInputElement;
        this.bankValueInput = this.contents.querySelector('#bankValueInput') as HTMLInputElement;
        this.bankRotationValCanvas = this.contents.querySelector('#bankRotationValCanvas') as HTMLCanvasElement;
        this.bankRotationValCanvasCtx = this.bankRotationValCanvas.getContext('2d') as CanvasRenderingContext2D;
        const bankRotationLinGrad = this.bankRotationValCanvasCtx.createLinearGradient(20,20,20,60);
        bankRotationLinGrad.addColorStop(0, '#494949');
        bankRotationLinGrad.addColorStop(1, '#2f2f2f');
        this.bankRotationValCanvasCtx.fillStyle = bankRotationLinGrad
        this.bankRotationValCanvasCtx.save();

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
                let linkedKfIconEdited = false;
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf, track) => {
                        kf.interpInType = this.interpInTypeBtns.selectedIndex;
                        let linkedKf = undefined;
                        if (this.animation.loop) {
                            if (kfIcon.type === KeyframeIconType.Loop_End)
                                linkedKf = this.timeline.getStartKeyframeForTrack(track);
                            else if (kfIcon.type === KeyframeIconType.Start)
                                linkedKf = this.timeline.getLoopEndKeyframeForTrack(track);
                        }
                        if (linkedKf) {
                            linkedKfIconEdited = true;
                            linkedKf.interpInType = this.interpInTypeBtns.selectedIndex;
                        }
                            
                    });
                    kfIcon.updatePaths();
                }
                if (linkedKfIconEdited) {
                    for (const kfIcon of this.timeline.keyframeIcons) {
                        kfIcon.updatePaths();
                    }
                }
                this.timeline.draw();
                this.updatePreviewSteps();
            }
        };
        this.interpInTypeBtns.options.forEach((e) => {
            e.addEventListener('click', () => this.saveState());
        });
        this.interpOutTypeBtns = new RadioButtons('Interpolation Out', ['Ease', 'Linear', 'Hold']);
        this.interpOutTypeBtns.onselectedchange = () => {
            if (this.interpOutTypeBtns.selectedIndex !== InterpolationType.Ease)
                this.easeOutSlider.elem.style.display = 'none';
            else
                this.easeOutSlider.elem.style.display = 'grid';

            if (this.interpOutTypeBtns.selectedIndex === -1)
                return;

            if (this.timeline.selectedKeyframeIcons.length) {
                let linkedKfIconEdited = false;
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf, track) => {
                        kf.interpOutType = this.interpOutTypeBtns.selectedIndex;
                        let linkedKf = undefined;
                        if (this.animation.loop) {
                            if (kfIcon.type === KeyframeIconType.Loop_End)
                                linkedKf = this.timeline.getStartKeyframeForTrack(track);
                            else if (kfIcon.type === KeyframeIconType.Start)
                                linkedKf = this.timeline.getLoopEndKeyframeForTrack(track);
                        }
                        if (linkedKf) {
                            linkedKfIconEdited = true;
                            linkedKf.interpOutType = this.interpOutTypeBtns.selectedIndex;
                        }
                    });
                    kfIcon.updatePaths();
                }
                if (linkedKfIconEdited) {
                    for (const kfIcon of this.timeline.keyframeIcons) {
                        kfIcon.updatePaths();
                    }
                }
                this.timeline.draw();
                this.updatePreviewSteps();
            }
        };
        this.interpOutTypeBtns.options.forEach((e) => {
            e.addEventListener('click', () => this.saveState());
        });
        this.interpolationTab.appendChild(this.interpInTypeBtns.elem);
        this.interpolationTab.appendChild(this.interpOutTypeBtns.elem);

        this.easeInSlider = new Slider();
        this.easeInSlider.setLabel("Ease In Amount");
        this.easeInSlider.setRange(0, 1);
        this.easeInSlider.setValue(1);
        this.easeInSlider.onvalue = (value) => {
            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf, track) => {
                        kf.easeInCoeff = value;
                        let linkedKf = undefined;
                        if (this.animation.loop) {
                            if (kfIcon.type === KeyframeIconType.Loop_End)
                                linkedKf = this.timeline.getStartKeyframeForTrack(track);
                            else if (kfIcon.type === KeyframeIconType.Start)
                                linkedKf = this.timeline.getLoopEndKeyframeForTrack(track);
                        }
                        if (linkedKf)
                            linkedKf.easeInCoeff = value;
                    });
                }
                this.updatePreviewSteps();
            }
        };
        this.easeInSlider.elem.addEventListener('mousedown', () => {
            this.easeInSlider.elem.dataset.prevValue = this.easeInSlider.getValue().toFixed(2);
        });
        this.easeInSlider.elem.addEventListener('mouseup', () => {
            if (this.easeInSlider.elem.dataset.prevValue
                && this.easeInSlider.elem.dataset.prevValue !== this.easeInSlider.getValue().toFixed(2))
                this.saveState();
        })
        this.interpolationTab.appendChild(this.easeInSlider.elem);

        this.easeOutSlider = new Slider();
        this.easeOutSlider.setLabel("Ease Out Amount");
        this.easeOutSlider.setRange(0, 1);
        this.easeOutSlider.setValue(1);
        this.easeOutSlider.onvalue = (value) => {
            if (this.timeline.selectedKeyframeIcons.length) {
                for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                    kfIcon.keyframesMap.forEach((kf, track) => {
                        kf.easeOutCoeff = value;
                        let linkedKf = undefined;
                        if (this.animation.loop) {
                            if (kfIcon.type === KeyframeIconType.Loop_End)
                                linkedKf = this.timeline.getStartKeyframeForTrack(track);
                            else if (kfIcon.type === KeyframeIconType.Start)
                                linkedKf = this.timeline.getLoopEndKeyframeForTrack(track);
                        }
                        if (linkedKf)
                            linkedKf.easeOutCoeff = value;
                    });
                }
                this.updatePreviewSteps();
            }
        };
        this.easeOutSlider.elem.addEventListener('mousedown', () => {
            this.easeOutSlider.elem.dataset.prevValue = this.easeOutSlider.getValue().toFixed(2);
        });
        this.easeOutSlider.elem.addEventListener('mouseup', () => {
            if (this.easeOutSlider.elem.dataset.prevValue
                && this.easeOutSlider.elem.dataset.prevValue !== this.easeOutSlider.getValue().toFixed(2))
                this.saveState();
        })
        this.interpolationTab.appendChild(this.easeOutSlider.elem);

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

        this.timelineElementsCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            const kfSelectedCountBefore = this.timeline.selectedKeyframeIcons.length;
            this.timeline.onMouseDown(e);
            if (this.timeline.playheadGrabbed) {
                this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
                if (this.livePreviewCheckbox.checked)
                    this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
            } else if (kfSelectedCountBefore < this.timeline.selectedKeyframeIcons.length) {
                this.saveState();
            }
        });

        const numericInputs: NodeList = document.querySelectorAll('#studioPanelContents .StudioNumericInput');
        for (let i = 0; i < numericInputs.length; i++) {
            const element = numericInputs[i] as HTMLInputElement;
            element.addEventListener('mousedown', (e: MouseEvent) => {
                if (!element.hasAttribute('disabled'))
                    this.selectedNumericInput = element;
            });
        }

        document.addEventListener('mousemove', (e: MouseEvent) => {
            // Only need to update if the primary mouse button is pressed while moving.
            if (e.buttons === 1 && this.timeline && this.playheadTimePositionInput
                && !this.studioCameraController.isAnimationPlaying) {
                if (this.selectedNumericInput && !this.selectedNumericInput.classList.contains('manual-entry')) {
                    if (parseFloat(this.selectedNumericInput.step) < 1) {
                        const distance = (e.movementX - e.movementY) * parseFloat(this.selectedNumericInput.step);
                        this.selectedNumericInput.value = (parseFloat(this.selectedNumericInput.value) + distance).toFixed(2);
                    } else {
                        let distance = (e.movementX - e.movementY) * parseInt(this.selectedNumericInput.step);

                        if (e.ctrlKey)
                            distance *= .1;
                        else if (e.shiftKey)
                            distance *= 10;

                        this.selectedNumericInput.value = (parseInt(this.selectedNumericInput.value) + distance).toString();
                    }
                    this.selectedNumericInput.dispatchEvent(new Event('change', { 'bubbles': true }));
                } else {
                    this.timeline.onMouseMove(e);
                    if (this.timeline.playheadGrabbed)
                        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();

                    if (this.timeline.grabbedIcon)
                        this.updatePreviewSteps();

                    if (this.livePreviewCheckbox.checked && (this.timeline.grabbedIcon || this.timeline.playheadGrabbed))
                        this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
                }
            }
        });

        document.addEventListener('mouseup', (e: MouseEvent) => {
            if (this.timeline.hasGrabbedIconMoved() || this.timeline.selectedKeyframeIcons.length) {
                this.saveState();
            }

            for (let i = 0; i < numericInputs.length; i++) {
                const element = numericInputs[i] as HTMLInputElement;
                element.classList.remove('manual-entry');
            }

            this.timeline.onMouseUp();
            if (this.selectedNumericInput) {
                if (e.target === this.selectedNumericInput) {
                    this.selectedNumericInput.classList.add('manual-entry');
                }

                if (this.selectedNumericInput !== this.playheadTimePositionInput)
                    this.saveState();
                this.selectedNumericInput = undefined;
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
        });

        this.timelineElementsCanvas.addEventListener('keyframeSelected', (e: Event) => this.onKeyframeIconSelected());
        this.timelineElementsCanvas.addEventListener('keyframeDeselected', (e: Event) => this.onKeyframeIconDeselected());
        this.timelineElementsCanvas.addEventListener('keyframeIconMovedEvent', (e: Event) => {
            for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                kfIcon.keyframesMap.forEach((v, trackType) => {
                    this.getTrackByType(this.animation, trackType).reSort();
                });
            }
        });

        this.newAnimation();
        this.studioPanelContents.removeAttribute('hidden');

        window.addEventListener('resize', () => {
            this.rescaleTimelineContainer();
        });

        this.loadStudioSettings();
    }

    public playAnimation(theater?: boolean) {
        if (this.timeline.keyframeIcons.length > 1) {
            this.disableControls();
            this.playAnimationBtn.setAttribute('hidden', '');
            this.stopAnimationBtn.removeAttribute('disabled');
            this.stopAnimationBtn.classList.remove('disabled');
            this.stopAnimationBtn.removeAttribute('hidden');

            if (theater) {
                const countdownCanvas = document.createElement('canvas');
                countdownCanvas.width = window.innerWidth;
                countdownCanvas.height = window.innerHeight;
                countdownCanvas.style.position = 'absolute';
                countdownCanvas.style.left = '0';
                countdownCanvas.style.top = '0';
                countdownCanvas.style.zIndex = '1024';
                const countdownCtx = countdownCanvas.getContext('2d') as CanvasRenderingContext2D;
                countdownCtx.font = '72px monospace';
                countdownCtx.textAlign = 'center';
                countdownCtx.textBaseline = 'middle';
                countdownCtx.lineWidth = 5;
                const drawStyle = '#ffffff';
                const shadowStyle = '#121212';
                this.ui.elem.appendChild(countdownCanvas);
                this.elem.style.display = 'none';
                this.ui.toggleUI(false);
                let countdownMs = 2000;
                const x = countdownCanvas.width / 2;
                const y = countdownCanvas.height / 2;
                const countdown = setInterval(() => {
                    countdownMs -= 10;
                    const seconds = countdownMs / 1000;

                    countdownCtx.save();
                    countdownCtx.clearRect(0, 0, countdownCanvas.width, countdownCanvas.height);
                    countdownCtx.fillStyle = shadowStyle;
                    countdownCtx.strokeStyle = shadowStyle;

                    countdownCtx.beginPath();
                    countdownCtx.save();
                    countdownCtx.translate(x + 3, y + 3);
                    countdownCtx.rotate(-Math.PI / 2);
                    countdownCtx.translate(-(x + 3),-(y + 3));
                    countdownCtx.arc(x + 3, y + 3, 100, 0, ((countdownMs % 1000) / 1000) * (2*Math.PI));
                    countdownCtx.stroke();
                    countdownCtx.restore();
                    countdownCtx.fillText(Math.ceil(seconds).toFixed(0), x + 3, y + 3);

                    countdownCtx.fillStyle = drawStyle;
                    countdownCtx.strokeStyle = drawStyle;

                    countdownCtx.beginPath();
                    countdownCtx.save();
                    countdownCtx.translate(x,y);
                    countdownCtx.rotate(-Math.PI / 2);
                    countdownCtx.translate(-x,-y);
                    countdownCtx.arc(x, y, 100, 0, ((countdownMs % 1000) / 1000) * (2*Math.PI));
                    countdownCtx.stroke();
                    countdownCtx.restore();
                    countdownCtx.fillText(Math.ceil(seconds).toFixed(0), x, y);
                    countdownCtx.restore();

                    if (countdownMs <= 0) {
                        this.ui.elem.removeChild(countdownCanvas);
                        this.animationManager.initAnimationPlayback(this.animation, 0);
                        this.studioCameraController.isAnimationPlaying = true;
                        clearInterval(countdown);
                    }
                }, 10);
            } else {
                let startTime = this.timeline.getPlayheadTimeMs();
                if (!this.animation.loop && startTime >= this.timeline.getLastKeyframeTimeMs())
                    startTime = 0;
                this.animationManager.initAnimationPlayback(this.animation, startTime);
                this.studioCameraController.isAnimationPlaying = true;
            }
        }
    }

    public stopAnimation() {
        if (this.studioCameraController.isAnimationPlaying) {
            this.studioCameraController.isAnimationPlaying = false;
            this.enableControls();
            this.playAnimationBtn.removeAttribute('hidden');
            this.stopAnimationBtn.setAttribute('hidden', '');
            this.ui.toggleUI(true);
            this.elem.style.display = '';
        }
    }

    public drawWorldHelpers(clipFromWorldMatrix: mat4) {
        if (this.showPreviewLineCheckbox.checked && this.animationPreviewSteps.length > 1) {
            for (let i = 0; i <= this.animationPreviewSteps.length - 2; i++) {
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.animationPreviewSteps[i + 1].pos, this.previewLineColor);
                if (i % 30 === 0) {
                    vec3.sub(this.scratchVec3a, this.animationPreviewSteps[i].lookAtPos, this.animationPreviewSteps[i].pos);
                    vec3.normalize(this.scratchVec3a, this.scratchVec3a);
                    vec3.scale(this.scratchVec3a, this.scratchVec3a, 100);
                    vec3.add(this.scratchVec3b, this.scratchVec3a, this.animationPreviewSteps[i].pos);
                    drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.scratchVec3b, this.previewLineLookAtColor);
    
                    mat4.targetTo(this.scratchMat, this.animationPreviewSteps[i].pos, this.animationPreviewSteps[i].lookAtPos, Vec3UnitY);
                    if (this.animationPreviewSteps[i].lookAtPos[0] < 0) {
                        mat4.rotateZ(this.scratchMat, this.scratchMat, -this.animationPreviewSteps[i].bank);
                    } else {
                        mat4.rotateZ(this.scratchMat, this.scratchMat, this.animationPreviewSteps[i].bank);
                    }
                    computeEulerAngleRotationFromSRTMatrix(this.scratchVec3a, this.scratchMat);
                    vec3.copy(this.scratchVec3c, Vec3UnitY);
                    vec3.rotateZ(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[2]);
                    vec3.rotateY(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[1]);
                    vec3.rotateX(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[0]);
                    this.scratchVec3c[2] = 0;
                    vec3.normalize(this.scratchVec3c, this.scratchVec3c);
                    vec3.scaleAndAdd(this.scratchVec3c, this.animationPreviewSteps[i].pos, this.scratchVec3c, 100);
                    drawWorldSpaceLine(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[i].pos, this.scratchVec3c, this.previewLineYAxisColor);
                    // TODO - draw arrow head lines or cone to better communicate direction?
                }
            }

            for (const kfIcon of this.timeline.keyframeIcons) {
                const stepIndex = Math.floor(kfIcon.getT() / StudioPanel.PREVIEW_STEP_TIME_MS);
                const color = kfIcon.selected ? this.previewLineKfDotSelectedColor : this.previewLineKfDotColor;
                if (this.timelineMode === TimelineMode.Consolidated 
                    || kfIcon.keyframesMap.has(KeyframeTrackType.posXTrack)
                    || kfIcon.keyframesMap.has(KeyframeTrackType.posYTrack)
                    || kfIcon.keyframesMap.has(KeyframeTrackType.posZTrack)) {
                    drawWorldSpacePoint(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[stepIndex].pos, color, 16);
                } else if (kfIcon.keyframesMap.has(KeyframeTrackType.lookAtXTrack)
                        || kfIcon.keyframesMap.has(KeyframeTrackType.lookAtYTrack)
                        || kfIcon.keyframesMap.has(KeyframeTrackType.lookAtZTrack)) {
                    drawWorldSpacePoint(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.animationPreviewSteps[stepIndex].lookAtPos, color, 16);
                } else {
                    mat4.targetTo(this.scratchMat, this.animationPreviewSteps[stepIndex].pos, this.animationPreviewSteps[stepIndex].lookAtPos, Vec3UnitY);
                    if (this.animationPreviewSteps[stepIndex].lookAtPos[0] < 0) {
                        mat4.rotateZ(this.scratchMat, this.scratchMat, -this.animationPreviewSteps[stepIndex].bank);
                    } else {
                        mat4.rotateZ(this.scratchMat, this.scratchMat, this.animationPreviewSteps[stepIndex].bank);
                    }
                    computeEulerAngleRotationFromSRTMatrix(this.scratchVec3a, this.scratchMat);
                    vec3.copy(this.scratchVec3c, Vec3UnitY);
                    vec3.rotateZ(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[2]);
                    vec3.rotateY(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[1]);
                    vec3.rotateX(this.scratchVec3c, this.scratchVec3c, Vec3Zero, -this.scratchVec3a[0]);
                    this.scratchVec3c[2] = 0;
                    vec3.normalize(this.scratchVec3c, this.scratchVec3c);
                    vec3.scaleAndAdd(this.scratchVec3c, this.animationPreviewSteps[stepIndex].pos, this.scratchVec3c, 100);
                    drawWorldSpacePoint(getDebugOverlayCanvas2D(), clipFromWorldMatrix, this.scratchVec3c, color, 16);
                }
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
        if (this.livePreviewCheckbox.checked)
            this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
    }

    private nextKeyframe(): void {
        this.timeline.jumpToNextKeyframe();
        this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
        if (this.livePreviewCheckbox.checked)
            this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
    }

    private redo(): void {
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

    private undo(): void {
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

    private saveState(): void {
        if (!this.animation || !this.timeline) {
            return;
        }
        const animString = JSON.stringify(this.animation);
        if (this.studioStates.length) {
            // Don't save if the most recent state is identical.
            const lastState = this.studioStates[this.currentStateIndex];
            const selectedKeyframeIndices = this.timeline.getSelectedKeyframeIndices();
            if (JSON.stringify(lastState.animation) === animString 
              && lastState.timelineLengthMs === this.timeline.getTimelineLengthMs() 
              && selectedKeyframeIndices.every((v) => {
                  return lastState.selectedKeyframeIndices.includes(v);
                })
              && lastState.selectedKeyframeIndices.every((v) => {
                return selectedKeyframeIndices.includes(v);
                })) {
                return;
            }
        } 
        if (this.currentStateIndex > -1 && this.currentStateIndex < this.studioStates.length - 1) {
            this.studioStates.length = this.currentStateIndex + 1;
            this.redoBtn.setAttribute('disabled', '');
            this.redoBtn.classList.add('disabled');
        }
        const state: StudioState = {
            animation: JSON.parse(animString),
            timelineLengthMs: this.timeline.getTimelineLengthMs(),
            timelineMode: this.timelineMode,
            selectedKeyframeIndices: this.timeline.getSelectedKeyframeIndices(),
        };
        this.studioStates.push(state);
        this.currentStateIndex++;
        if (this.currentStateIndex > 0) {
            this.undoBtn.removeAttribute('disabled');
            this.undoBtn.classList.remove('disabled');
        }
        if (this.autoSaveCheckbox.checked) {
            this.saveAnimation();
        }
    }

    private loadState(state: StudioState): void {
        const loadedAnimation: CameraAnimation = JSON.parse(JSON.stringify(state.animation));
        if (loadedAnimation.loop === undefined)
            loadedAnimation.loop = false;

        if (loadedAnimation.posXTrack.keyframes.length === 0) {
            this.newAnimation();
            return;
        }

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

        loadedAnimation.posXTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.posYTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.posZTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.lookAtXTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.lookAtYTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.lookAtZTrack.keyframes.forEach((kf) => conformKf(kf));
        loadedAnimation.bankTrack.keyframes.forEach((kf) => conformKf(kf));
        
        this.timelineMode = state.timelineMode;
        this.timelineModeSelect.selectedIndex = state.timelineMode;
        this.timelineModeSelect.dispatchEvent(new Event('change', { bubbles: true }));
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

        this.reAddAllKeyframeIcons();

        this.timeline.setScaleAndDrawMarkers(state.timelineLengthMs);
        this.timelineLengthInput.value = this.timeline.getTimelineLengthSeconds();
        this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        setElementHighlighted(this.loopAnimationBtn, this.animation.loop);
        this.timeline.reselectKeyframes(state.selectedKeyframeIndices);
        if (this.timeline.selectedKeyframeIcons.length === 0) {
            this.hideKeyframeControls();
        } else {
            // Call onKeyframeSelected to update relevant keyframe editing inputs
            this.onKeyframeIconSelected();
        }
        this.timeline.draw();
        this.updatePreviewSteps();
    }

    private reAddAllKeyframeIcons(): void {
        this.timeline.selectedKeyframeIcons = [];
        this.timeline.keyframeIcons = [];

        const inferKfType = (i: number, track: KeyframeTrack) => {
            if (i === 0)
                return KeyframeIconType.Start;
            else if (this.animation.loop && i === track.keyframes.length - 1)
                return KeyframeIconType.Loop_End;
            else
                return KeyframeIconType.Default;
        };

        const addKeyframeIcon = (time: number, kfType: KeyframeIconType, tracks: KeyframeTrackType[], kfs: Keyframe[], y: number) => {
            if (tracks.length !== kfs.length)
                throw "Mismatched track/kf array length";

            const kfMap = new Map<KeyframeTrackType, Keyframe>();
            for (let i = 0; i < tracks.length; i++) {
                kfMap.set(tracks[i], kfs[i]);
            }
            this.timeline.addKeyframeIcon(kfMap, time, y, kfType);
        };

        if (this.timelineMode === TimelineMode.Consolidated) {
            for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.posXTrack.keyframes[i].time, inferKfType(i, this.animation.posXTrack),
                    [KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack,
                        KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack,
                        KeyframeTrackType.bankTrack],
                    [this.animation.posXTrack.keyframes[i], this.animation.posYTrack.keyframes[i], this.animation.posZTrack.keyframes[i],
                    this.animation.lookAtXTrack.keyframes[i], this.animation.lookAtYTrack.keyframes[i], this.animation.lookAtZTrack.keyframes[i],
                    this.animation.bankTrack.keyframes[i]],
                    Timeline.KEYFRAME_ICONS_BASE_Y_POS);
            }
        } else if (this.timelineMode === TimelineMode.Position_LookAt_Bank) {
            for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.posXTrack.keyframes[i].time, inferKfType(i, this.animation.posXTrack), 
                    [KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack],
                    [this.animation.posXTrack.keyframes[i], this.animation.posYTrack.keyframes[i], this.animation.posZTrack.keyframes[i]],
                    Timeline.KEYFRAME_ICONS_BASE_Y_POS);
            }           
            for (let i = 0; i < this.animation.lookAtXTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.lookAtXTrack.keyframes[i].time, inferKfType(i, this.animation.lookAtXTrack), 
                    [KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack],
                    [this.animation.lookAtXTrack.keyframes[i], this.animation.lookAtYTrack.keyframes[i], this.animation.lookAtZTrack.keyframes[i]], 
                    Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT);
            }           
            for (let i = 0; i < this.animation.bankTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.bankTrack.keyframes[i].time, inferKfType(i, this.animation.bankTrack), 
                    [KeyframeTrackType.bankTrack], [this.animation.bankTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2));
            }
        } else if (this.timelineMode === TimelineMode.Full) {
            for (let i = 0; i < this.animation.posXTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.posXTrack.keyframes[i].time, inferKfType(i, this.animation.posXTrack),
                [KeyframeTrackType.posXTrack], [this.animation.posXTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS);
            }
            for (let i = 0; i < this.animation.posYTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.posYTrack.keyframes[i].time, inferKfType(i, this.animation.posYTrack),
                [KeyframeTrackType.posYTrack], [this.animation.posYTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT);
            }
            for (let i = 0; i < this.animation.posZTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.posZTrack.keyframes[i].time, inferKfType(i, this.animation.posZTrack),
                [KeyframeTrackType.posZTrack], [this.animation.posZTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2));
            }
            for (let i = 0; i < this.animation.lookAtXTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.lookAtXTrack.keyframes[i].time, inferKfType(i, this.animation.lookAtXTrack),
                [KeyframeTrackType.lookAtXTrack], [this.animation.lookAtXTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 3));
            }
            for (let i = 0; i < this.animation.lookAtYTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.lookAtYTrack.keyframes[i].time, inferKfType(i, this.animation.lookAtYTrack),
                [KeyframeTrackType.lookAtYTrack], [this.animation.lookAtYTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 4));
            }
            for (let i = 0; i < this.animation.lookAtZTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.lookAtZTrack.keyframes[i].time, inferKfType(i, this.animation.lookAtZTrack),
                [KeyframeTrackType.lookAtZTrack], [this.animation.lookAtZTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 5));
            }
            for (let i = 0; i < this.animation.bankTrack.keyframes.length; i++) {
                addKeyframeIcon(this.animation.bankTrack.keyframes[i].time, inferKfType(i, this.animation.bankTrack),
                [KeyframeTrackType.bankTrack], [this.animation.bankTrack.keyframes[i]], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 6));
            }
        } else {
            throw "Bad timelineMode";
        }
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
        if (this.timeline.selectedKeyframeIcons.length > 0 && input.value) {
            let val = parseInt(input.value);
            if (!Number.isNaN(val)) {
                const trackType = parseInt(input.dataset.track!, 10);
                const kfIcon = this.timeline.getSelectedIconForTrack(trackType);
                const kf = kfIcon.keyframesMap.get(trackType)!;
                
                let linkedKf = undefined;
                if (this.animation.loop) {
                    if (kfIcon.type === KeyframeIconType.Loop_End)
                        linkedKf = this.timeline.getStartKeyframeForTrack(trackType);
                    else if (kfIcon.type === KeyframeIconType.Start)
                        linkedKf = this.timeline.getLoopEndKeyframeForTrack(trackType);
                }
                
                if (trackType === KeyframeTrackType.bankTrack) {
                    val *= MathConstants.DEG_TO_RAD;
                } else if (this.lockPerspective) {
                    const diff = val - parseInt(input.dataset.prevValue!);
                    if (trackType === KeyframeTrackType.posXTrack
                        && this.lookAtXValueInputContainer.style.visibility !== 'hidden') {
                        const corVal = parseInt(this.lookAtXValueInput.value) + diff;
                        this.lookAtXValueInput.value = corVal.toString();
                        this.lookAtXValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    } else if (trackType === KeyframeTrackType.posYTrack
                        && this.lookAtYValueInputContainer.style.visibility !== 'hidden') {
                        const corVal = parseInt(this.lookAtYValueInput.value) + diff;
                        this.lookAtYValueInput.value = corVal.toString();
                        this.lookAtYValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    } else if (trackType === KeyframeTrackType.posZTrack
                          && this.lookAtZValueInputContainer.style.visibility !== 'hidden') {
                        const corVal = parseInt(this.lookAtZValueInput.value) + diff;
                        this.lookAtZValueInput.value = corVal.toString();
                        this.lookAtZValueInput.dispatchEvent(new Event('change', {bubbles: true}));
                    }
                }

                this.getTrackByType(this.animation, trackType).setValue(kf, val);
                if (linkedKf)
                    this.getTrackByType(this.animation, trackType).setValue(linkedKf, val);
                
                if (trackType === KeyframeTrackType.bankTrack) {
                    const prevIndex = this.animation.bankTrack.keyframes.indexOf(kf) - 1;
                    let prevBank: number | undefined = undefined;
                    if (prevIndex > -1)
                        prevBank = this.animation.bankTrack.keyframes[prevIndex].value;
                    this.drawBankRotationWheel(-val, prevBank);
                }
                
                this.updatePreviewSteps();
                if (this.livePreviewCheckbox.checked)
                    this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
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

    private drawBankRotationWheel(angleRads: number, prevAngleRads?: number) {
        this.bankRotationValCanvasCtx.clearRect(0, 0, this.bankRotationValCanvas.width, this.bankRotationValCanvas.height);
        const width = this.bankRotationValCanvas.width;
        const height = this.bankRotationValCanvas.height;
        const outerRadius = 30;
        const innerRadius = 23;

        this.bankRotationValCanvasCtx.beginPath();
        this.bankRotationValCanvasCtx.arc(width / 2, height / 2, outerRadius, 0, MathConstants.TAU);
        this.bankRotationValCanvasCtx.fill();

        this.bankRotationValCanvasCtx.strokeStyle = '#a9a9a9';
        this.bankRotationValCanvasCtx.beginPath();
        this.bankRotationValCanvasCtx.arc(width / 2, height / 2, innerRadius, 0, MathConstants.TAU);
        this.bankRotationValCanvasCtx.stroke();
        this.bankRotationValCanvasCtx.save();

        this.bankRotationValCanvasCtx.translate(width / 2, height / 2);
        this.bankRotationValCanvasCtx.rotate(angleRads);
        this.bankRotationValCanvasCtx.translate(-width / 2, -height / 2);

        this.bankRotationValCanvasCtx.strokeStyle = HIGHLIGHT_COLOR;
        this.bankRotationValCanvasCtx.lineWidth = 3;
        this.bankRotationValCanvasCtx.beginPath();
        this.bankRotationValCanvasCtx.moveTo(width / 2, (height / 2) - innerRadius);
        this.bankRotationValCanvasCtx.lineTo(width / 2, (height / 2) - innerRadius + 15);
        this.bankRotationValCanvasCtx.stroke();
        this.bankRotationValCanvasCtx.restore();

        if (prevAngleRads !== undefined && angleRads !== prevAngleRads) {
            prevAngleRads *= -1;
            this.bankRotationValCanvasCtx.save();
            this.bankRotationValCanvasCtx.strokeStyle = '#ebb23c';
            this.bankRotationValCanvasCtx.lineWidth = 2;
            this.bankRotationValCanvasCtx.beginPath();
            this.bankRotationValCanvasCtx.translate(width / 2, height / 2);
            this.bankRotationValCanvasCtx.rotate(-Math.PI / 2);
            this.bankRotationValCanvasCtx.rotate(prevAngleRads);
            this.bankRotationValCanvasCtx.translate(-width / 2, -height / 2);
            this.bankRotationValCanvasCtx.arc(width / 2, height / 2, (innerRadius + outerRadius) / 2, 0, (angleRads - prevAngleRads) % MathConstants.TAU, angleRads < prevAngleRads);
            this.bankRotationValCanvasCtx.stroke();
            this.bankRotationValCanvasCtx.restore();
        }
    }

    private onKeyframeIconSelected() {
        const icon = this.timeline.selectedKeyframeIcons[0];
        let keyframeTracks = 0;
        let commonEaseInVal = 1;
        let commonEaseOutVal = 1;
        let commonInterpInType = 0;
        let commonInterpOutType = 0;
        let prevBank: number | undefined = undefined;

        const updateValueInputs = (kf: Keyframe, trackType: KeyframeTrackType) => {
            keyframeTracks |= trackType;
            const input = this.getValueInput(trackType);
            if (trackType === KeyframeTrackType.bankTrack) {
                input.value = (kf.value * MathConstants.RAD_TO_DEG).toFixed(0).toString();
                const prevIndex = this.animation.bankTrack.keyframes.indexOf(kf) - 1;
                if (prevIndex > -1)
                    prevBank = this.animation.bankTrack.keyframes[prevIndex].value;
            } else {
                input.value = kf.value.toFixed(0).toString();
            }
            input.dataset.prevValue = input.value;
        };

        icon.keyframesMap.forEach((kf, trackType) => {
            updateValueInputs(kf, trackType);
            commonEaseInVal = kf.easeInCoeff;
            commonEaseOutVal = kf.easeOutCoeff;
            commonInterpInType = kf.interpInType;
            commonInterpOutType = kf.interpOutType;
        });
        
        for (let i = 1; i < this.timeline.selectedKeyframeIcons.length; i++) {
            const kfIcon = this.timeline.selectedKeyframeIcons[i];
            kfIcon.keyframesMap.forEach((kf, trackType) => {
                if (keyframeTracks !== 0) {
                    if (keyframeTracks & trackType)
                        keyframeTracks = 0;
                    else
                        updateValueInputs(kf, trackType);
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
        this.posXValueInputContainer.style.visibility = 'hidden';
        this.posYValueInputContainer.style.visibility = 'hidden';
        this.posZValueInputContainer.style.visibility = 'hidden';
        this.lookAtXValueInputContainer.style.visibility = 'hidden';
        this.lookAtYValueInputContainer.style.visibility = 'hidden';
        this.lookAtZValueInputContainer.style.visibility = 'hidden';
        this.bankValueInputContainer.style.visibility = 'hidden';
        this.lockPerspectiveBracket.style.visibility = 'hidden';
        this.lockPerspectiveDiv.style.visibility = 'hidden';

        if (keyframeTracks !== 0) {
            if (keyframeTracks & KeyframeTrackType.posXTrack)
                this.posXValueInputContainer.style.visibility = '';
                
            if (keyframeTracks & KeyframeTrackType.posYTrack)
                this.posYValueInputContainer.style.visibility = '';
                
            if (keyframeTracks & KeyframeTrackType.posZTrack)
                this.posZValueInputContainer.style.visibility = '';
                
            if (keyframeTracks & KeyframeTrackType.lookAtXTrack)
                this.lookAtXValueInputContainer.style.visibility = '';
                
            if (keyframeTracks & KeyframeTrackType.lookAtYTrack)
                this.lookAtYValueInputContainer.style.visibility = '';
                
            if (keyframeTracks & KeyframeTrackType.lookAtZTrack)
                this.lookAtZValueInputContainer.style.visibility = '';
                
            if ((keyframeTracks & KeyframeTrackType.bankTrack)) {
                this.drawBankRotationWheel(-parseInt(this.bankValueInput.value) * MathConstants.DEG_TO_RAD, prevBank);
                this.bankValueInputContainer.style.visibility = '';
            }
        }
            
        if (((keyframeTracks & KeyframeTrackType.posXTrack) && (keyframeTracks & KeyframeTrackType.lookAtXTrack))
            || ((keyframeTracks & KeyframeTrackType.posYTrack) && (keyframeTracks & KeyframeTrackType.lookAtYTrack))
            || ((keyframeTracks & KeyframeTrackType.posZTrack) && (keyframeTracks & KeyframeTrackType.lookAtZTrack))) {
            this.lockPerspectiveBracket.style.visibility = '';
            this.lockPerspectiveDiv.style.visibility = '';
        } 

        if (commonEaseInVal !== -1)
            this.easeInSlider.setValue(commonEaseInVal);
        else
            (this.easeInSlider.elem.querySelector('.Slider') as HTMLInputElement).value = '1';

        if (commonEaseOutVal !== -1)
            this.easeOutSlider.setValue(commonEaseOutVal);
        else 
            (this.easeOutSlider.elem.querySelector('.Slider') as HTMLInputElement).value = '1';

        this.interpInTypeBtns.setSelectedIndex(commonInterpInType);
        this.interpOutTypeBtns.setSelectedIndex(commonInterpOutType);
    }
    
    private onKeyframeIconDeselected(): void {
        if (this.timeline.selectedKeyframeIcons.length === 0) {
            this.hideKeyframeControls();
        } else {
            // Call onKeyframeSelected to update relevant keyframe editing inputs
            this.onKeyframeIconSelected();
        }
        this.saveState();
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
        this.lockPerspectiveBracket.style.visibility = 'hidden';
        this.lockPerspectiveDiv.style.visibility = 'hidden';
        this.selectKeyframeMsg.removeAttribute('hidden');
    }

    private initTimeline() {
        this.studioHelpText.dataset.default = 'Move the playhead to the desired time, then move the camera and press Enter to place a keyframe.';
        this.studioHelpText.innerText = this.studioHelpText.dataset.default;
        this.showEditingUI();
        this.rescaleTimelineContainer();
        this.timeline.draw();
    }

    private updatePreviewSteps() {
        this.animationManager.initAnimationPlayback(this.animation, 0);
        this.animation.posXTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.posYTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.posZTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtXTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtYTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.lookAtZTrack.setAllCatmullRomTangents(this.animation.loop);
        this.animation.bankTrack.setAllCatmullRomTangents(this.animation.loop);

        const steps: InterpolationStep[] = [];
        if (this.timeline.keyframeIcons.length > 1) {
            // TODO(jstpierre): Don't rely on animationManager for this.
            for (let time = 0; time <= this.animationManager.durationMs; time += StudioPanel.PREVIEW_STEP_TIME_MS) {
                const step = new InterpolationStep();
                this.animationManager.getAnimFrame(step, time);
                steps.push(step);
            }
        }
        this.animationPreviewSteps = steps;
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
        if (this.timeline.keyframeIcons.length === 0)
            this.initTimeline();
   
        let tracks = this.selectedTracks;
        if (tracks === 0) {
            return;
        }

        const editingKf = this.timeline.selectedKeyframeIcons.length && this.timeline.playheadIsOnIcon();
        const time = this.timeline.getPlayheadTimeMs();

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
        let bank = vec3.angle(this.scratchVecLook, Vec3UnitY);
        if (this.scratchVecLook[0] < 0) {
            bank *= -1;
        }

        let prevBankVal = 0;
        let relativePrevBankVal = 0;
        let halfRotations = 0;
        if (this.animation.bankTrack.keyframes.length > 0) {
            let prevIndex = this.animation.bankTrack.getNextKeyframeIndexAtTime(time);
            if (prevIndex === -1)
                prevIndex = this.animation.bankTrack.keyframes.length - 1;
            else
                prevIndex -= 1;

            prevBankVal = this.animation.bankTrack.keyframes[prevIndex].value;
            halfRotations = (prevBankVal / Math.PI) | 0;
            relativePrevBankVal = prevBankVal % MathConstants.TAU;
            if (prevBankVal > 0 && bank < relativePrevBankVal - Math.PI )
                bank += MathConstants.TAU;
            else if (prevBankVal <= 0 && bank > relativePrevBankVal + Math.PI )
                bank -= MathConstants.TAU;

            bank += ((halfRotations / 2) | 0) * MathConstants.TAU;
        }

        const bankKf: Keyframe = { time, value: bank, tangentIn: 0, tangentOut: 0, interpInType: InterpolationType.Ease, interpOutType: InterpolationType.Ease, easeInCoeff: 1, easeOutCoeff: 1 };

        if (editingKf) {
            for (const kfIcon of this.timeline.selectedKeyframeIcons) {
                if (kfIcon.getT() !== time)
                    continue;
                
                if (kfIcon.type === KeyframeIconType.Start || kfIcon.type === KeyframeIconType.Loop_End) {
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
                    tracks = 0;
                    break;
                }
                
                kfIcon.keyframesMap.forEach((kf, track) => {
                    if ((tracks & track) === 0)
                        return;
                    tracks ^= track;
                    if (track === KeyframeTrackType.posXTrack)
                        kf.value = posXKf.value;
                    else if (track === KeyframeTrackType.posYTrack)
                        kf.value = posYKf.value;
                    else if (track === KeyframeTrackType.posZTrack)
                        kf.value = posZKf.value;
                    else if (track === KeyframeTrackType.lookAtXTrack)
                        kf.value = lookAtXKf.value;
                    else if (track === KeyframeTrackType.lookAtYTrack)
                        kf.value = lookAtYKf.value;
                    else if (track === KeyframeTrackType.lookAtZTrack)
                        kf.value = lookAtZKf.value;
                    else if (track === KeyframeTrackType.bankTrack)
                        kf.value = bankKf.value;
                });
            }

            if (tracks === 0) {
                this.updatePreviewSteps();
                return;
            }
        }

        if (this.animation.loop && time > this.timeline.getLastKeyframeTimeMs()) {
            this.ensureTimelineLength(time + 5000);
            this.timeline.moveLoopEndframeIcons(time + 5000);
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

        // If we're past the time of the last keyframe, advance.
        const advancePlayhead = time > this.timeline.getLastKeyframeTimeMs();

        const kfType = this.timeline.keyframeIcons.length === 0 ? KeyframeIconType.Start : KeyframeIconType.Default;

        const addKeyframeIcon = (tracks: KeyframeTrackType[], kfs: Keyframe[], y: number) => {
            if (tracks.length !== kfs.length)
                throw "Mismatched track/kf array length";

            const kfMap = new Map<KeyframeTrackType, Keyframe>();
            for (let i = 0; i < tracks.length; i++) {
                kfMap.set(tracks[i], kfs[i]);
            }
            this.timeline.addKeyframeIcon(kfMap, time, y, kfType);
        }

        if (this.timelineMode === TimelineMode.Consolidated) {
            addKeyframeIcon(
                [KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack,
                    KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack,
                    KeyframeTrackType.bankTrack],
                [posXKf, posYKf, posZKf, lookAtXKf, lookAtYKf, lookAtZKf, bankKf],
                Timeline.KEYFRAME_ICONS_BASE_Y_POS);
        } else if (this.timelineMode === TimelineMode.Position_LookAt_Bank) {
            // In Pos/LookAt/Bank, the selection of posX or lookAtX implies the others.
            if (tracks & KeyframeTrackType.posXTrack) {
                addKeyframeIcon(
                    [KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack],
                    [posXKf, posYKf, posZKf],
                    Timeline.KEYFRAME_ICONS_BASE_Y_POS
                );
            }
            if (tracks & KeyframeTrackType.lookAtXTrack) {
                addKeyframeIcon(
                    [KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack],
                    [lookAtXKf, lookAtYKf, lookAtZKf],
                    Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT
                );
            }
            if (tracks & KeyframeTrackType.bankTrack) {
                addKeyframeIcon([KeyframeTrackType.bankTrack], [bankKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2));
            }
        } else if (this.timelineMode === TimelineMode.Full) {
            if (tracks & KeyframeTrackType.posXTrack)
                addKeyframeIcon([KeyframeTrackType.posXTrack], [posXKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS);
            if (tracks & KeyframeTrackType.posYTrack)
                addKeyframeIcon([KeyframeTrackType.posYTrack], [posYKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT);
            if (tracks & KeyframeTrackType.posZTrack)
                addKeyframeIcon([KeyframeTrackType.posZTrack], [posZKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2));
            if (tracks & KeyframeTrackType.lookAtXTrack)
                addKeyframeIcon([KeyframeTrackType.lookAtXTrack], [lookAtXKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 3));
            if (tracks & KeyframeTrackType.lookAtYTrack)
                addKeyframeIcon([KeyframeTrackType.lookAtYTrack], [lookAtYKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 4));
            if (tracks & KeyframeTrackType.lookAtZTrack)
                addKeyframeIcon([KeyframeTrackType.lookAtZTrack], [lookAtZKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 5));
            if (tracks & KeyframeTrackType.bankTrack)
                addKeyframeIcon([KeyframeTrackType.bankTrack], [bankKf], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 6));
        } else {
            throw "Bad timelineMode";
        }

        this.updatePreviewSteps();

        if (advancePlayhead)
            this.movePlayhead(3);
        else
            this.timeline.selectKeyframeIconsAtTime(this.timeline.getPlayheadTimeMs());

        this.timeline.draw();
        this.saveState();
    }

    private addLoopEndFrames(): void {
        const time = this.timeline.getLastKeyframeTimeMs() + 5000;

        function makeLoopKeyframe(track: KeyframeTrack): Keyframe {
            const { value, tangentIn, tangentOut, interpInType, interpOutType, easeInCoeff, easeOutCoeff } = track.keyframes[0];
            return { time, value, tangentIn, tangentOut, interpInType, interpOutType, easeInCoeff, easeOutCoeff };
        }

        const addLoopKeyframe = (tracks: KeyframeTrackType[], y: number) => {
            const kfMap = new Map<KeyframeTrackType, Keyframe>();
            for (let i = 0; i < tracks.length; i++) {
                const track = this.getTrackByType(this.animation, tracks[i]);
                const loopKeyframe = makeLoopKeyframe(track);
                kfMap.set(tracks[i], loopKeyframe);
                track.addKeyframe(loopKeyframe);
            }
            this.timeline.addKeyframeIcon(kfMap, time, y, KeyframeIconType.Loop_End);
        };

        if (this.timelineMode === TimelineMode.Consolidated) {
            addLoopKeyframe(
                [KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack,
                    KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack,
                    KeyframeTrackType.bankTrack],
                Timeline.KEYFRAME_ICONS_BASE_Y_POS);
        } else if (this.timelineMode === TimelineMode.Position_LookAt_Bank) {
            addLoopKeyframe([KeyframeTrackType.posXTrack, KeyframeTrackType.posYTrack, KeyframeTrackType.posZTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS);
            addLoopKeyframe([KeyframeTrackType.lookAtXTrack, KeyframeTrackType.lookAtYTrack, KeyframeTrackType.lookAtZTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT);
            addLoopKeyframe([KeyframeTrackType.bankTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2));
        } else if (this.timelineMode === TimelineMode.Full) {
            addLoopKeyframe([KeyframeTrackType.posXTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS)
            addLoopKeyframe([KeyframeTrackType.posYTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + Timeline.TRACK_HEIGHT)
            addLoopKeyframe([KeyframeTrackType.posZTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 2))
            addLoopKeyframe([KeyframeTrackType.lookAtXTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 3))
            addLoopKeyframe([KeyframeTrackType.lookAtYTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 4))
            addLoopKeyframe([KeyframeTrackType.lookAtZTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 5))
            addLoopKeyframe([KeyframeTrackType.bankTrack], Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Timeline.TRACK_HEIGHT * 6))
        } else {
            throw "Bad timelineMode";
        }

        this.ensureTimelineLength(time);
    }

    private ensureTimelineLength(timeMs: number): void {
        if (timeMs > this.timeline.getTimelineLengthMs()) {
            this.timelineLengthInput.value = (timeMs / MILLISECONDS_IN_SECOND).toFixed(2);
            this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    private deleteLoopEndFrames(): void {
        this.animation.posXTrack.keyframes.pop();
        this.animation.posYTrack.keyframes.pop();
        this.animation.posZTrack.keyframes.pop();
        this.animation.lookAtXTrack.keyframes.pop();
        this.animation.lookAtYTrack.keyframes.pop();
        this.animation.lookAtZTrack.keyframes.pop();
        this.animation.bankTrack.keyframes.pop();
        this.timeline.deleteEndframeIcons();
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
        this.selectedTracks |= KeyframeTrackType.allTracks;
        this.hideEditingUI();
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.resetHelpText();
    }

    private resetHelpText() {
        if (!this.persistHelpText)
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

    private displayError(e: string, linkText?: string, linkUrl?: string) {
        this.studioHelpText.innerText = e;
        this.studioHelpText.style.color = '#ff4141';
        this.studioHelpText.style.fontWeight = '700';
        this.persistHelpText = true;
        if (linkText && linkUrl) {
            const link = document.createElement('a') as HTMLAnchorElement;
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            link.href = linkUrl;
            link.innerText = linkText;
            this.studioHelpText.appendChild(link);
        }
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
                this.loadState(this.createInitStudioState(obj.animation));
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

        const isValidTrack = (t: any) => {
            return t && Array.isArray(t.keyframes) && t.keyframes.length >= 1;
        };

        const isValidAnimObj = (a: any) => {
            return a &&
                isValidTrack(a.posXTrack) &&
                isValidTrack(a.posYTrack) &&
                isValidTrack(a.posZTrack) &&
                isValidTrack(a.lookAtXTrack) &&
                isValidTrack(a.lookAtYTrack) &&
                isValidTrack(a.lookAtZTrack) &&
                isValidTrack(a.bankTrack);
        };

        if (obj.version === 2 && obj.studioState && isValidAnimObj(obj.studioState.animation)) {
            obj.animation = obj.studioState.animation;
            return true;
        } else if (obj.version === 3 && isValidAnimObj(obj.animation)) {
            return true;
        }
        return false;
    }

    private serializeAnimation(): string {
        const dataObj = { version: 3, animation: this.animation };
        return JSON.stringify(dataObj);
    }

    private saveAnimation() {
        const jsonAnim: string = this.serializeAnimation();
        window.localStorage.setItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId(), jsonAnim);
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
                    this.loadState(this.createInitStudioState(obj.animation));
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

    private createInitStudioState(anim: CameraAnimation): StudioState {
        const duration = Math.max(anim.posXTrack.keyframes[anim.posXTrack.keyframes.length - 1].time, 
            anim.posYTrack.keyframes[anim.posYTrack.keyframes.length - 1].time, 
            anim.posZTrack.keyframes[anim.posZTrack.keyframes.length - 1].time, 
            anim.lookAtXTrack.keyframes[anim.lookAtXTrack.keyframes.length - 1].time, 
            anim.lookAtYTrack.keyframes[anim.lookAtYTrack.keyframes.length - 1].time, 
            anim.lookAtZTrack.keyframes[anim.lookAtZTrack.keyframes.length - 1].time, 
            anim.bankTrack.keyframes[anim.bankTrack.keyframes.length - 1].time);

        return {
            animation: anim,
            timelineLengthMs: duration,
            timelineMode: this.inferTimelineMode(anim),
            selectedKeyframeIndices: []
        };
    }

    private inferTimelineMode(anim: CameraAnimation): TimelineMode {
        let tlMode = TimelineMode.Consolidated;

        // First, check the length of each keyframe track.
        // If there is any discrepancy between posX/posY/posZ or between lookAtX/lookAtY/lookAtZ, we need the full timeline.
        // If there is only a discrepancy between pos/LookAt/bank, we need at least TimelineMode.Pos_LookAt_Bank, 
        if (anim.posXTrack.keyframes.length !== anim.posYTrack.keyframes.length
            || anim.posXTrack.keyframes.length !== anim.posZTrack.keyframes.length
            || anim.lookAtXTrack.keyframes.length !== anim.lookAtYTrack.keyframes.length
            || anim.lookAtXTrack.keyframes.length !== anim.lookAtZTrack.keyframes.length) {
            return TimelineMode.Full;
        } else if (anim.posXTrack.keyframes.length !== anim.lookAtXTrack.keyframes.length 
            || anim.posXTrack.keyframes.length !== anim.lookAtYTrack.keyframes.length 
            || anim.posXTrack.keyframes.length !== anim.lookAtZTrack.keyframes.length 
            || anim.posXTrack.keyframes.length !== anim.bankTrack.keyframes.length) {
            tlMode = TimelineMode.Position_LookAt_Bank;
        }

        // Now check the time value for each keyframe.
        // Again, any discrepancy between posX/posY/posZ or between lookAtX/lookAtY/lookAtZ implies a full timeline.
        for (let i = 0; i < anim.posXTrack.keyframes.length; i++) {
            if (!commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.posYTrack.keyframes[i])
                || !commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.posZTrack.keyframes[i])) {
                return TimelineMode.Full;
            }
            if (anim.lookAtXTrack.keyframes[i] === undefined || !commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.lookAtXTrack.keyframes[i])
                || anim.lookAtYTrack.keyframes[i] === undefined || !commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.lookAtYTrack.keyframes[i])
                || anim.lookAtZTrack.keyframes[i] === undefined || !commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.lookAtZTrack.keyframes[i])
                || anim.bankTrack.keyframes[i] === undefined || !commonKfFieldsEqual(anim.posXTrack.keyframes[i], anim.bankTrack.keyframes[i])) {
                tlMode = TimelineMode.Position_LookAt_Bank;
            }
        }
        for (let i = 0; i < anim.lookAtXTrack.keyframes.length; i++) {
            if (!commonKfFieldsEqual(anim.lookAtXTrack.keyframes[i], anim.lookAtYTrack.keyframes[i])
              || !commonKfFieldsEqual(anim.lookAtXTrack.keyframes[i], anim.lookAtZTrack.keyframes[i])) {
                return TimelineMode.Full;
            }
            if (anim.bankTrack.keyframes[i] === undefined || !commonKfFieldsEqual(anim.lookAtXTrack.keyframes[i], anim.bankTrack.keyframes[i])) {
                tlMode = TimelineMode.Position_LookAt_Bank;
            }
        }
        return tlMode;
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
        this.keyframeControlsDock.querySelectorAll('button, input').forEach((e) => {
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
        this.keyframeControlsDock.querySelectorAll('button, input').forEach((e) => {
            e.removeAttribute('disabled');
            e.classList.remove('disabled');
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
        this.timelineHeaderBg.style.width = (zoomedWidth + Playhead.WIDTH) + 'px';
        this.timelineTracksBg.style.width = (zoomedWidth + Playhead.WIDTH) + 'px';
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
        this.recordPlaybackBtn.setAttribute('hidden', '');
    }

    private showEditingUI(): void {
        this.studioControlsContainer.removeAttribute('hidden');
        this.undoRedoBtnContainer.removeAttribute('hidden');
        this.saveAnimationBtn.removeAttribute('hidden');
        this.keyframeControlsDock.removeAttribute('hidden');
        this.recordPlaybackBtn.removeAttribute('hidden');
    }

    private onTabBtnClick = function(this: HTMLButtonElement, ev: MouseEvent) {
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
        const canvasActive = document.activeElement === document.querySelector('canvas');
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
        } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLInputElement)) {
            this.addKeyframesFromMat4(mat4.clone(this.studioCameraController.camera.worldMatrix));
        } else if (ev.key === 'Escape') {
            this.stopAnimation();
        } else if (ev.ctrlKey && ev.shiftKey && ev.key === 'Z') {
            this.redo();
        } else if (ev.ctrlKey && ev.key === 'z') {
            this.undo();
        } else if (ev.ctrlKey && ev.key === 's') {
            ev.preventDefault();
            this.saveAnimation();
            this.displayMessage('Saved animation to local storage.');
        }
    }

    private saveStudioSettings() {
        const settings: studioSettings = {
            drawPreviewLine: this.showPreviewLineCheckbox.checked,
            livePreview: this.livePreviewCheckbox.checked,
            autoSave: this.autoSaveCheckbox.checked
        };
        window.localStorage.setItem('studio-settings', JSON.stringify(settings));
    }

    private loadStudioSettings() {
        const settings = window.localStorage.getItem('studio-settings');
        if (settings) {
            const settingsObj = JSON.parse(settings);
            if (settingsObj.drawPreviewLine !== undefined)
                this.showPreviewLineCheckbox.setChecked(settingsObj.drawPreviewLine);
            
            if (settingsObj.livePreview !== undefined)
                this.livePreviewCheckbox.setChecked(settingsObj.livePreview);
            
            if (settingsObj.autoSave !== undefined)
                this.autoSaveCheckbox.setChecked(settingsObj.autoSave);
        }
    }

}
