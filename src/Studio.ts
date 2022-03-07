import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { StudioCameraController } from './Camera';
import { clamp, computeEulerAngleRotationFromSRTMatrix, getMatrixAxisZ, invlerp, Vec3UnitY, Vec3Zero } from './MathHelpers';
import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';
import { GlobalSaveManager } from './SaveManager';
import { getPointHermite } from './Spline';

export const CLAPBOARD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="20" fill="white"><path d="M61,22H14.51l3.41-.72h0l7.74-1.64,2-.43h0l6.85-1.46h0l1.17-.25,8.61-1.83h0l.78-.17,9-1.91h0l.4-.08L60,12.33a1,1,0,0,0,.77-1.19L59.3,4.3a1,1,0,0,0-1.19-.77l-19,4-1.56.33h0L28.91,9.74,27.79,10h0l-9.11,1.94-.67.14h0L3.34,15.17a1,1,0,0,0-.77,1.19L4,23.11V60a1,1,0,0,0,1,1H61a1,1,0,0,0,1-1V23A1,1,0,0,0,61,22ZM57,5.8l.65.6.89,4.19-1.45.31L52.6,6.75ZM47.27,7.88,51.8,12,47.36,13,42.82,8.83ZM37.48,10,42,14.11l-4.44.94L33,10.91ZM27.7,12l4.53,4.15-4.44.94L23.26,13Zm-9.78,2.08,4.53,4.15L18,19.21l-4.53-4.15ZM19.49,29H14.94l3.57-5h4.54Zm9-5h4.54l-3.57,5H24.94ZM39,45.88l-11,6A1,1,0,0,1,26.5,51V39A1,1,0,0,1,28,38.12l11,6a1,1,0,0,1,0,1.76ZM39.49,29H34.94l3.57-5h4.54Zm10,0H44.94l3.57-5h4.54ZM60,29H54.94l3.57-5H60Z"/></svg>`;
const UNDO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16"><g transform="translate(0,-952.36218)"><path overflow="visible" style="" d="m 39.999997,975.36218 -31.9999995,25.00002 31.9999995,25 0,-14 c 1.7024,-0.08 31.3771,-0.033 52.000005,18 -8.252999,-25.4273 -34.173805,-35.48722 -52.000005,-40.00002 z" fill="#ffffff" stroke="none"/></g></svg>`;
const REDO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16"><g transform="translate(0,-952.36218)"><path d="m 60,975.36216 32,24.99994 -32,25.0001 0,-12.0001 c -1.7024,-0.08 -31.3771,-2.0334 -52,16.0001 8.253,-25.4274 34.1738,-37.48724 52,-42.00004 z" style="" overflow="visible" fill="#ffffff" stroke="none"/></g></svg>`;
const MILLISECONDS_IN_SECOND = 1000.0;
const MIN_ANIMATION_LENGTH_SEC = 1;
const MAX_ANIMATION_LENGTH_SEC = 300;

export interface Keyframe {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
    useAutoTangent: boolean;
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
        if (!k1.useAutoTangent)
            return;

        // Catmull-Rom tangent
        const val = (k2.value - k0.value) * 0.5;
        const prevDuration = k1.time - k0.time;
        const nextDuration = k2.time - k1.time;
        k1.tangentIn = val * (2 * prevDuration) / (prevDuration + nextDuration);
        k1.tangentOut = val * (2 * nextDuration) / (prevDuration + nextDuration);
    }

    public setCustomTangent(kf: Keyframe, v: number) {
        const index = this.keyframes.indexOf(kf);
        if (index > -1) {
            this.keyframes[index].tangentOut = v;
            if (index < this.keyframes.length - 1) {
                this.keyframes[index + 1].tangentIn = v;
            }
            if ((index === this.keyframes.length - 1 || index === 0)
                && this.keyframes[this.keyframes.length - 1].value === this.keyframes[0].value) {
                // Looping animation
                this.keyframes[0].tangentOut = v;
                this.keyframes[this.keyframes.length - 1].tangentOut = v;
                this.keyframes[1].tangentIn = v;
            }
        }
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
    End,
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
    static readonly XY_DIST = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH / 2);
    static readonly COLOR: string = '#FFFFFF';
    static readonly SELECTED_COLOR: string = '#FF500B';
    static readonly ENDFRAME_COLOR: string = '#4EB0FF';

    constructor(public keyframesMap: Map<KeyframeTrackType, Keyframe>, private x: number, private y: number, private t: number, public type: KeyframeIconType) {
        this.updatePath();
    }

    public iconPath = new Path2D();
    public selected: boolean = false;

    public draw(ctx: CanvasRenderingContext2D) {
        if (this.selected)
            ctx.fillStyle = KeyframeIcon.SELECTED_COLOR;
        else if (this.type === KeyframeIconType.End || this.type === KeyframeIconType.Start)
            ctx.fillStyle = KeyframeIcon.ENDFRAME_COLOR;
        else
            ctx.fillStyle = KeyframeIcon.COLOR;
        ctx.fill(this.iconPath);
    }

    public updatePosition(x: number, t: number) {
        this.x = x;
        this.t = t;
        this.updatePath();
        this.keyframesMap.forEach((k) => { k.time = t });
    }

    public getX(): number {
        return this.x;
    }

    public getT(): number {
        return this.t;
    }

    private updatePath() {
        this.iconPath = new Path2D();
        this.iconPath.moveTo(this.x, this.y);
        this.iconPath.lineTo(this.x + KeyframeIcon.XY_DIST, this.y + KeyframeIcon.XY_DIST);
        this.iconPath.lineTo(this.x, this.y + KeyframeIcon.HEIGHT);
        this.iconPath.lineTo(this.x - KeyframeIcon.XY_DIST, this.y + KeyframeIcon.XY_DIST);
        this.iconPath.lineTo(this.x, this.y);
    }
}

class Timeline {
    static readonly DEFAULT_LENGTH_MS = 30000;
    static readonly MIN_MARKER_WIDTH_PX: number = 50;
    static readonly MARKER_COLOR: string = '#f3f3f3';
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
        this.elementsCtx.translate(Playhead.HALF_WIDTH, 0);
        this.markersCtx.translate(Playhead.HALF_WIDTH, 0);
        this.markersCtx.strokeStyle = Timeline.MARKER_COLOR;
        this.markersCtx.fillStyle = Timeline.MARKER_COLOR;
        this.setScaleAndDrawMarkers(timelineLengthMs);
    }

    private width: number;
    private height: number;
    private lengthMs: number;
    private timelineHeaderPath: Path2D;
    private playhead: Playhead;
    private pixelsPerSecond: number;
    private timelineScaleFactor: number = 1;
    public keyframeIcons: KeyframeIcon[] = [];
    public selectedKeyframeIcon: KeyframeIcon | undefined;
    public playheadGrabbed: boolean = false;
    public keyframeIconGrabbed: boolean = false;
    private grabbedIconInitialXPos: number = -1;
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
    }

    public getTimelineLengthMs(): number {
        return this.lengthMs;
    }

    public getTimelineLengthSeconds(): string {
        return (this.lengthMs / MILLISECONDS_IN_SECOND).toFixed(2);
    }

    public draw() {
        this.elementsCtx.clearRect(-Playhead.WIDTH, 0, this.width + Playhead.WIDTH, this.height);
        this.playhead.draw(this.elementsCtx);
        for (const kfIcon of this.keyframeIcons) {
            kfIcon.draw(this.elementsCtx);
        }
        this.playhead.drawLine(this.elementsCtx);
    }

    public addKeyframeIcon(kfs: Map<KeyframeTrackType, Keyframe>, t: number, y: number, type: KeyframeIconType, selectAfterAdd: boolean) {
        const xPos = (t / MILLISECONDS_IN_SECOND) * (this.pixelsPerSecond / this.timelineScaleFactor);
        const kfIcon = new KeyframeIcon(kfs, xPos, y, t, type);
        this.keyframeIcons.push(kfIcon);
        this.keyframeIcons.sort((a, b) => a.getX() - b.getX());
        if (selectAfterAdd)
            this.selectKeyframeIcon(kfIcon);
    }

    public deleteSelectedKeyframeIcon() {
        if (!this.selectedKeyframeIcon)
            return;

        const i = this.keyframeIcons.indexOf(this.selectedKeyframeIcon);

        if (i === -1 || this.keyframeIcons[i].type !== KeyframeIconType.Default)
            return;

        this.keyframeIcons.splice(i, 1);
        this.deselectKeyframeIcon();
    }

    public deleteEndframeIcons() {
        while (this.keyframeIcons[this.keyframeIcons.length - 1].type === KeyframeIconType.End) {
            this.keyframeIcons.pop();
        }
    }

    public onMouseDown(e: MouseEvent) {
        e.stopPropagation();
        // Click landed on playhead, or the part of the timeline where markers are displayed
        if (this.elementsCtx.isPointInPath(this.playhead.playheadPath, e.offsetX, e.offsetY) ||
            this.elementsCtx.isPointInPath(this.timelineHeaderPath, e.offsetX, e.offsetY)) {
            this.playheadGrabbed = true;
            this.deselectKeyframeIcon();
            this.onMouseMove(e);
            return;
        }
        // Check if click landed on the currently-selected keyframe icon
        let selectedIconClicked = false;
        if (this.selectedKeyframeIcon && this.selectedKeyframeIcon.type !== KeyframeIconType.Start
            && this.elementsCtx.isPointInPath(this.selectedKeyframeIcon.iconPath, e.offsetX, e.offsetY)) {
            selectedIconClicked = true;
            this.keyframeIconGrabbed = true;
            this.grabbedIconInitialXPos = this.selectedKeyframeIcon.getX();
        }
        if (!selectedIconClicked) {
            this.deselectKeyframeIcon();
            // Check if click landed on any keyframe icon.
            for (const kfIcon of this.keyframeIcons) {
                if (this.elementsCtx.isPointInPath(kfIcon.iconPath, e.offsetX, e.offsetY)) {
                    this.selectKeyframeIcon(kfIcon);
                    if (kfIcon.type !== KeyframeIconType.Start) {
                        this.keyframeIconGrabbed = true;
                        this.grabbedIconInitialXPos = this.selectedKeyframeIcon!.getX();
                    }
                    break;
                }
            }
        }
        this.draw();
    }

    public onMouseUp() {
        this.playheadGrabbed = false;
        this.keyframeIconGrabbed = false;
        this.grabbedIconInitialXPos = -1;
        this.draw();
    }

    public onMouseMove(e: MouseEvent) {
        if (!this.playheadGrabbed && !this.keyframeIconGrabbed)
            return;

        let targetX = e.offsetX;
        if (e.target !== this.elementsCtx.canvas)
            targetX = e.clientX - this.elementsCtx.canvas.getBoundingClientRect().x;

        targetX = clamp(targetX, Playhead.HALF_WIDTH, this.width - Playhead.HALF_WIDTH);
        targetX -= Playhead.HALF_WIDTH;

        const snappingEnabled = this.snappingEnabled || e.shiftKey;

        if (this.playheadGrabbed) {
            const snapKfIndex = this.getClosestSnappingIconIndex(targetX);
            this.deselectKeyframeIcon();
            if (snapKfIndex > -1) {
                if (snappingEnabled)
                    targetX = this.keyframeIcons[snapKfIndex].getX();

                // If the playhead is directly on a keyframe, highlight it.
                if (targetX === this.keyframeIcons[snapKfIndex].getX())
                    this.selectKeyframeIcon(this.keyframeIcons[snapKfIndex]);
            }

            const t = targetX / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
            this.playhead.updatePosition(targetX, t);
        } else if (this.keyframeIconGrabbed && this.selectedKeyframeIcon) {
            // Don't allow a loop keyframe icon to be moved before any other keyframes.
            if (this.selectedKeyframeIcon.type === KeyframeIconType.End)
                targetX = clamp(targetX, this.keyframeIcons[this.keyframeIcons.length - 2].getX() + Timeline.SNAP_DISTANCE_PX, this.width - Playhead.HALF_WIDTH);
            if (snappingEnabled && Math.abs(targetX - this.playhead.getX()) < Timeline.SNAP_DISTANCE_PX)
                this.updateKeyframeIconPosition(this.selectedKeyframeIcon, this.playhead.getX());
            else
                this.updateKeyframeIconPosition(this.selectedKeyframeIcon, targetX);
        }

        this.draw();
    }

    public hasGrabbedIconMoved(): boolean {
        if (!this.selectedKeyframeIcon)
            return false;
        return this.keyframeIconGrabbed && this.grabbedIconInitialXPos !== -1 && this.grabbedIconInitialXPos !== this.selectedKeyframeIcon.getX();
    }

    private selectKeyframeIcon(kfIcon: KeyframeIcon) {
        kfIcon.selected = true;
        this.selectedKeyframeIcon = kfIcon;
        this.elementsCtx.canvas.dispatchEvent(new Event('keyframeSelected', { bubbles: false }));
    }

    public deselectKeyframeIcon() {
        if (this.selectedKeyframeIcon) {
            this.selectedKeyframeIcon.selected = false;
            this.selectedKeyframeIcon = undefined;
            this.elementsCtx.canvas.dispatchEvent(new Event('keyframeDeselected', { bubbles: false }));
        }
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
            const snapKfIndex = this.getClosestSnappingIconIndex(x);
            if (snapKfIndex > -1 && x === this.keyframeIcons[snapKfIndex].getX()) {
                // If the playhead is directly on a keyframe, highlight it.
                this.selectKeyframeIcon(this.keyframeIcons[snapKfIndex]);
            } else {
                this.deselectKeyframeIcon();
            }
        }
        this.draw();
    }

    public jumpToNextKeyframe() {
        const curT = this.playhead.getT();
        for (let i = 1; i < this.keyframeIcons.length; i++) {
            if (curT < this.keyframeIcons[i].getT()) {
                const jumpIcon = this.keyframeIcons[i];
                this.deselectKeyframeIcon();
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
                this.deselectKeyframeIcon();
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
        return getPointHermite(k0.value, k1.value, k0.tangentOut, k1.tangentIn, t);
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

    private studioDataBtn: HTMLButtonElement;
    private studioSaveLoadControls: HTMLElement;
    private newAnimationBtn: HTMLButtonElement;
    private loadAnimationBtn: HTMLButtonElement;
    private saveAnimationBtn: HTMLButtonElement;
    private importAnimationBtn: HTMLButtonElement;
    private exportAnimationBtn: HTMLButtonElement;

    private studioControlsContainer: HTMLElement;

    private timelineControlsContainer: HTMLElement;
    private snapBtn: HTMLButtonElement;
    private playheadTimePositionInput: HTMLInputElement;
    private timelineLengthInput: HTMLInputElement;

    private timelineMarkersCanvas: HTMLCanvasElement;
    private timelineElementsCanvas: HTMLCanvasElement;

    private selectKeyframeMsg: HTMLElement;
    private keyframeControls: HTMLElement;
    private editKeyframePositionBtn: HTMLButtonElement;
    private useAutoTangentValuesCheckbox: Checkbox;
    private interpolationSettings: HTMLElement;

    private customTangentsContainer: HTMLElement;
    private posXTangentInput: HTMLInputElement;
    private posYTangentInput: HTMLInputElement;
    private posZTangentInput: HTMLInputElement;
    private lookAtXTangentInput: HTMLInputElement;
    private lookAtYTangentInput: HTMLInputElement;
    private lookAtZTangentInput: HTMLInputElement;
    private bankTangentInput: HTMLInputElement;

    private editingKeyframe: boolean = false;
    private persistHelpText: boolean = false;

    public timeline: Timeline;
    private selectedTracks: number = KeyframeTrackType.allTracks;

    private previewOptionsContainer: HTMLElement;
    private showPreviewLineCheckbox: Checkbox;
    private livePreviewCheckbox: Checkbox;

    private playbackControls: HTMLElement;
    private hideUiCheckbox: Checkbox;
    private delayStartCheckbox: Checkbox;
    private loopAnimationBtn: HTMLButtonElement;
    private playAnimationBtn: HTMLButtonElement;
    private stopAnimationBtn: HTMLButtonElement;

    private selectedNumericInput: HTMLInputElement | undefined;

    constructor(private ui: UI, private viewer: Viewer.Viewer) {
        super();
        // Closing the panel will be done by disabling studio mode
        this.closeButton.style.display = 'none';
        this.header.ondblclick = null;

        this.onMotion = (dx: number, dy: number) => {
            this.elem.style.left = clamp((parseFloat(this.elem.style.left!) + dx), 0, window.innerWidth - this.elem.offsetWidth) + 'px';
            this.elem.style.top = clamp((parseFloat(this.elem.style.top!) + dy), 0, window.innerHeight - this.elem.offsetHeight) + 'px';
        }
        this.elem.onmouseover = () => {
            this.elem.style.opacity = '1';
        };
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.8';
        };

        this.setWidth('650px');
        this.elem.id = 'studioPanel';
        this.elem.style.display = 'none';
        this.elem.style.zIndex = '1';
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.8';
        };
        this.elem.style.opacity = '0.8';
        this.elem.style.userSelect = 'none';

        this.contents.style.maxHeight = '';
        this.contents.style.overflow = '';
        this.setTitle(CLAPBOARD_ICON, 'Studio');
        this.contents.insertAdjacentHTML('beforeend', `
        <div id="studioPanelContents" hidden></div>
        `);
        this.contents.style.lineHeight = '36px';
        this.studioPanelContents = this.contents.querySelector('#studioPanelContents') as HTMLElement;

    }

    public show(): void {
        this.elem.style.display = '';
    }

    public hide(): void {
        this.elem.style.display = 'none';
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
            #studioPanel select {
                background: #000;
                border-radius: 5px;
                margin-right: 1rem;
                padding: 3px 0;
                font: 16px monospace;
                color: #fefefe;
            }
            #studioDataBtn {
                width: 40%;
                display: block;
                margin: 0.25rem auto;
            }
            #studioSaveLoadControls {
                width: 85%;
                margin: auto;
            }
            #studioHelpText {
                line-height: 1.5;
                padding: 0 1rem;
                min-height: 3rem;
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
                overflow: hidden;
                position: relative;
                height: ${Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT}px;
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
                height:100%;
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
            #keyframeList {
                list-style: none;
                padding: 0;
                margin: 0;
                height: 27rem;
                overflow-y: scroll;
                border: 1px solid #555;
            }
            #keyframeList > li {
                position: relative;
                background-color: #441111;
            }
            #keyframeControls {
                line-height: 1.2;
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
            #studioControlsContainer .disabled,
            .SettingsButton.disabled {
                cursor: not-allowed!important;
                opacity: 0.5;
            }
            #playbackControls {
                padding: 0 5rem 1rem;
                border-top: 1px solid #444;
            }
        </style>
        <div style="position: relative;">
            <div id="undoRedoBtnContainer" style="position: absolute; left: 1rem; top: -0.25rem; white-space: nowrap;" hidden>
                <button type="button" id="undoBtn" class="SettingsButton disabled" disabled></button>
                <button type="button" id="redoBtn" class="SettingsButton disabled" disabled></button>
            </div>
        </div>
        <div style="position: relative;">
            <div style="position: absolute; right: 1rem;top: -0.25rem; width: 5rem;">
                <button type="button" id="saveAnimationBtn" class="SettingsButton" hidden>Save</button>
            </div>
        </div>
        <button type="button" id="studioDataBtn" class="SettingsButton">📁</button>
        <div id="studioSaveLoadControls" hidden>
            <div style="display: grid;grid-template-columns: 1fr 1fr; gap: 0.25rem 1rem;">
                <button type="button" id="newAnimationBtn" class="SettingsButton">New</button>
                <button type="button" id="loadAnimationBtn" class="SettingsButton">Load</button>
                <button type="button" id="importAnimationBtn" class="SettingsButton">Import</button>
                <button type="button" id="exportAnimationBtn" class="SettingsButton">Export</button>
            </div>
        </div>
        <div id="studioHelpText"></div>
        <div id="studioControlsContainer" hidden>
            <div id="timelineControlsContainer" style="display: grid; grid-gap: 12px; grid-auto-flow: column; justify-content: end; margin: 0 12px;">
                <div>
                    <input id="playheadTimePositionInput" class="StudioNumericInput" type="number" min="0" max="300" step="0.1" value="0"><span>/</span>
                    <input id="timelineLengthInput" class="StudioNumericInput" type="number" min="1" max="300" step="0.1" value="${Timeline.DEFAULT_LENGTH_MS / MILLISECONDS_IN_SECOND}"><span>s</span>
                </div>

                <button type="button" id="loopAnimationBtn" title="Loop" class="SettingsButton">🔁</button>
                <button type="button" id="snapBtn" title="Snap" class="SettingsButton">🧲</button>
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
                    <canvas id="timelineMarkersCanvas" width="600" height="${Timeline.HEADER_HEIGHT}"></canvas>
                    <canvas id="timelineElementsCanvas" width="600" height="${Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT}" tabindex="-1"></canvas>
                </div>
            </div>
            <div style="display: grid;grid-template-columns: 1.25fr 1fr;">
                <div>
                    <div style="text-align: center;">Keyframe Settings</div>
                    <div id="selectKeyframeMsg">Select a keyframe.</div>
                    <div id="keyframeControls" hidden>
                        <div style="width: 50%; margin: 0 auto 0.5rem;">
                            <button type="button" id="editKeyframePositionBtn" class="SettingsButton">Edit Keyframe</button>
                        </div>
                        <div id="interpolationSettings">
                            <div id="customTangentsContainer" style="display: grid; grid-auto-flow: column; text-align: center;">
                                <div>
                                    <div><span>X Position:</span> <input id="posXTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                    <div><span>Y Position:</span> <input id="posYTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                    <div><span>Z Position:</span> <input id="posZTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                </div>
                                <div>
                                    <div><span>LookAt X:</span> <input id="lookAtXTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                    <div><span>LookAt Y:</span> <input id="lookAtYTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                    <div><span>LookAt Z:</span> <input id="lookAtZTangentInput" class="StudioNumericInput" type="number" step="1.0" value="0"></div>
                                </div>
                                <div>
                                    <span>Bank rotation:</span> <input id="bankTangentInput" class="StudioNumericInput" type="number" step="0.01" value="0">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="previewOptionsContainer">
                    <div style="text-align: center;">Preview Options</div>
                </div>
            </div>
            <div id="playbackControls">
                <button type="button" id="playAnimationBtn" class="SettingsButton">▶</button>
                <button type="button" id="stopAnimationBtn" class="SettingsButton" hidden>■</button>
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

        this.studioDataBtn = this.contents.querySelector('#studioDataBtn') as HTMLButtonElement;
        this.studioDataBtn.dataset.helpText = 'Save the current animation, or load a previously-saved animation.';

        this.studioSaveLoadControls = this.contents.querySelector('#studioSaveLoadControls') as HTMLElement;

        this.newAnimationBtn = this.contents.querySelector('#newAnimationBtn') as HTMLButtonElement;
        this.newAnimationBtn.dataset.helpText = 'Clear the current keyframes and create a new animation.';

        this.loadAnimationBtn = this.contents.querySelector('#loadAnimationBtn') as HTMLButtonElement;
        this.loadAnimationBtn.dataset.helpText = 'Load the previously-saved animation for this map. Overwrites the current keyframes!';

        this.saveAnimationBtn = this.contents.querySelector('#saveAnimationBtn') as HTMLButtonElement;
        this.saveAnimationBtn.dataset.helpText = 'Save the current animation for this map to your browser\'s local storage.';

        this.importAnimationBtn = this.contents.querySelector('#importAnimationBtn') as HTMLButtonElement;
        this.importAnimationBtn.dataset.helpText = 'Load an animation from a JSON file.';

        this.exportAnimationBtn = this.contents.querySelector('#exportAnimationBtn') as HTMLButtonElement;
        this.exportAnimationBtn.dataset.helpText = 'Save the current animation as a JSON file.';

        this.studioControlsContainer = this.contents.querySelector('#studioControlsContainer') as HTMLElement;

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
        this.snapBtn.dataset.helpText = 'Snap keyframes to the playhead, and vice-versa.';
        setElementHighlighted(this.snapBtn, this.timeline.snappingEnabled);
        setElementHighlighted(this.snapBtn, false);

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

            // Update the playhead's position. Clamp it to the timeline length if necessary.
            let playheadTimePosValue = parseFloat(this.playheadTimePositionInput.value);
            if (playheadTimePosValue > lengthVal) {
                playheadTimePosValue = lengthVal;
                this.playheadTimePositionInput.value = lengthVal.toString();
                this.playheadTimePositionInput.dataset.prevValue = lengthVal.toString();
            }
            this.timeline.setPlayheadTimeSeconds(playheadTimePosValue, false);
        };

        this.loopAnimationBtn = this.contents.querySelector('#loopAnimationBtn') as HTMLButtonElement;
        this.loopAnimationBtn.dataset.helpText = 'Loop the animation until manually stopped.';
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

        this.keyframeControls = this.contents.querySelector('#keyframeControls') as HTMLElement;
        this.selectKeyframeMsg = this.contents.querySelector('#selectKeyframeMsg') as HTMLElement;

        this.editKeyframePositionBtn = this.contents.querySelector('#editKeyframePositionBtn') as HTMLButtonElement;
        this.editKeyframePositionBtn.dataset.helpText = 'Edit the camera position represented by this keyframe.';
        setElementHighlighted(this.editKeyframePositionBtn, false);
        this.editKeyframePositionBtn.onclick = () => { this.beginEditKeyframePosition(); };

        this.interpolationSettings = this.contents.querySelector('#interpolationSettings') as HTMLElement;

        this.customTangentsContainer = this.contents.querySelector('#customTangentsContainer') as HTMLElement;
        this.posXTangentInput = this.contents.querySelector('#posXTangentInput') as HTMLInputElement;
        this.posXTangentInput.dataset.track = KeyframeTrackType.posXTrack.toString();
        this.posYTangentInput = this.contents.querySelector('#posYTangentInput') as HTMLInputElement;
        this.posYTangentInput.dataset.track = KeyframeTrackType.posYTrack.toString();
        this.posZTangentInput = this.contents.querySelector('#posZTangentInput') as HTMLInputElement;
        this.posZTangentInput.dataset.track = KeyframeTrackType.posZTrack.toString();
        this.lookAtXTangentInput = this.contents.querySelector('#lookAtXTangentInput') as HTMLInputElement;
        this.lookAtXTangentInput.dataset.track = KeyframeTrackType.lookAtXTrack.toString();
        this.lookAtYTangentInput = this.contents.querySelector('#lookAtYTangentInput') as HTMLInputElement;
        this.lookAtYTangentInput.dataset.track = KeyframeTrackType.lookAtYTrack.toString();
        this.lookAtZTangentInput = this.contents.querySelector('#lookAtZTangentInput') as HTMLInputElement;
        this.lookAtZTangentInput.dataset.track = KeyframeTrackType.lookAtZTrack.toString();
        this.bankTangentInput = this.contents.querySelector('#bankTangentInput') as HTMLInputElement;
        this.bankTangentInput.dataset.track = KeyframeTrackType.bankTrack.toString();

        this.useAutoTangentValuesCheckbox = new Checkbox('Auto-Calculate Tangents');
        this.useAutoTangentValuesCheckbox.elem.style.display = 'flex';
        this.useAutoTangentValuesCheckbox.elem.style.justifyContent = 'center';
        this.useAutoTangentValuesCheckbox.elem.style.alignItems = '';
        this.useAutoTangentValuesCheckbox.elem.style.gridTemplateColumns = '';
        this.useAutoTangentValuesCheckbox.elem.dataset.helpText = 'Automatically calculate the tangent values for this keyframe using the Catmull-Rom spline formula.';
        this.useAutoTangentValuesCheckbox.onchanged = () => {
            this.autoTangentCheckBoxOnChanged();
            this.saveState();
        }
        this.interpolationSettings.insertAdjacentElement('afterbegin', this.useAutoTangentValuesCheckbox.elem);

        this.showPreviewLineCheckbox = new Checkbox('Show Animation Preview Line', true);
        this.showPreviewLineCheckbox.elem.dataset.helpText = 'Show/Hide the line indicating the path of the animation.';
        this.showPreviewLineCheckbox.onchanged = () => {
            if (this.showPreviewLineCheckbox.checked)
                this.updatePreviewSteps();
            this.studioCameraController.previewPath = this.showPreviewLineCheckbox.checked;
            // TODO - Customize preview line colours?
        };
        this.livePreviewCheckbox = new Checkbox('Live Preview');
        this.livePreviewCheckbox.elem.dataset.helpText = 'Preview the animation when moving the playhead or keyframes.';
        this.livePreviewCheckbox.onchanged = () => {
            if (this.livePreviewCheckbox.checked)
                this.updatePreviewSteps();
            this.timeline.livePreview = this.livePreviewCheckbox.checked;
        }

        this.previewOptionsContainer = this.contents.querySelector('#previewOptionsContainer') as HTMLElement;
        this.previewOptionsContainer.insertAdjacentElement('beforeend', this.showPreviewLineCheckbox.elem);
        this.previewOptionsContainer.insertAdjacentElement('beforeend', this.livePreviewCheckbox.elem);

        this.playbackControls = this.contents.querySelector('#playbackControls') as HTMLElement;

        this.delayStartCheckbox = new Checkbox('Delay animation playback');
        this.hideUiCheckbox = new Checkbox('Hide UI during playback');
        this.delayStartCheckbox.elem.dataset.helpText = 'Delay the start of the animation by 2s. Useful for avoiding capture of the mouse cursor.';
        this.hideUiCheckbox.elem.dataset.helpText = 'Hide the noclip UI during playback. (Press Escape to stop playback.)';
        this.playbackControls.insertAdjacentElement('afterbegin', this.delayStartCheckbox.elem);
        this.playbackControls.insertAdjacentElement('afterbegin', this.hideUiCheckbox.elem);

        this.playAnimationBtn = this.contents.querySelector('#playAnimationBtn') as HTMLButtonElement;
        this.stopAnimationBtn = this.contents.querySelector('#stopAnimationBtn') as HTMLButtonElement;

        this.studioDataBtn.onclick = () => this.studioSaveLoadControls.toggleAttribute('hidden');
        this.newAnimationBtn.onclick = () => {
            this.newAnimation();
            this.saveState();
        }
        this.loadAnimationBtn.onclick = () => this.loadAnimation();
        this.saveAnimationBtn.onclick = () => this.saveAnimation();
        this.exportAnimationBtn.onclick = () => this.exportAnimation();
        this.importAnimationBtn.onclick = () => this.importAnimation();

        this.posXTangentInput.onchange = () => this.onChangeTangentInput(this.posXTangentInput);
        this.posYTangentInput.onchange = () => this.onChangeTangentInput(this.posYTangentInput);
        this.posZTangentInput.onchange = () => this.onChangeTangentInput(this.posZTangentInput);
        this.lookAtXTangentInput.onchange = () => this.onChangeTangentInput(this.lookAtXTangentInput);
        this.lookAtYTangentInput.onchange = () => this.onChangeTangentInput(this.lookAtYTangentInput);
        this.lookAtZTangentInput.onchange = () => this.onChangeTangentInput(this.lookAtZTangentInput);
        this.bankTangentInput.onchange = () => this.onChangeTangentInput(this.bankTangentInput);

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

        const numericInputs: NodeList = document.querySelectorAll('#studioPanelContents .StudioNumericInput');
        for (let i = 0; i < numericInputs.length; i++) {
            const element = numericInputs[i] as HTMLInputElement;
            element.addEventListener('mousedown', (e: MouseEvent) => {
                if (!element.disabled)
                    this.selectedNumericInput = element;
            });
        }

        // Set a mouseover event for any elements in the panel with defined help text.
        const controls: NodeList = document.querySelectorAll('#studioPanelContents *');
        for (let i = 0; i < controls.length; i++) {
            const control: HTMLElement = controls[i] as HTMLElement;
            if (control.dataset.helpText) {
                control.onfocus = () => this.displayHelpText(control);
                control.onmouseenter = () => this.displayHelpText(control);
                control.onmouseleave = () => this.resetHelpText();
            }
        }

        document.addEventListener('mousemove', (e: MouseEvent) => {
            // Only need to update if the primary mouse button is pressed while moving.
            if (e.buttons === 1 && this.timeline && this.playheadTimePositionInput
                && !this.studioCameraController.isAnimationPlaying && !this.editingKeyframe) {
                if (this.selectedNumericInput) {
                    const distance = (e.movementX - e.movementY) * parseFloat(this.selectedNumericInput.step);
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
                if (this.timeline.livePreview && this.timeline.playheadGrabbed)
                    this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
            }
        });

        this.timelineElementsCanvas.addEventListener('keyframeSelected', (e: Event) => { this.displayKeyframeControls(); });
        this.timelineElementsCanvas.addEventListener('keyframeDeselected', (e: Event) => { this.hideKeyframeControls(); });
        this.timelineElementsCanvas.addEventListener('keyframeIconMovedEvent', (e: Event) => {
            this.timeline.selectedKeyframeIcon!.keyframesMap.forEach((v, trackType) => {
                this.getTrackByType(this.animation, trackType).reSort();
            });
        });

        this.timelineElementsCanvas.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (ev.key === 'Delete' && this.timeline.selectedKeyframeIcon && !ev.repeat) {
                this.deleteSelectedKeyframeIcon();
            } else if (ev.key === 'j') {
                this.timeline.jumpToPreviousKeyframe();
                this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
                if (this.timeline.livePreview)
                    this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
            } else if (ev.key === 'k') {
                this.timeline.jumpToNextKeyframe();
                this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
                if (this.timeline.livePreview)
                    this.goToPreviewStepAtTime(this.timeline.getPlayheadTimeMs());
            } else if (ev.key === ',') {
                this.movePlayhead(-1 / 60);
            } else if (ev.key === '.') {
                this.movePlayhead(1 / 60);
            } else if (ev.key === ' ') {
                if (this.studioCameraController.isAnimationPlaying)
                    this.stopAnimation();
                else
                    this.playAnimation();
            } else if (ev.key === 'Enter') {
                this.addKeyframesFromMat4(mat4.clone(this.studioCameraController.camera.worldMatrix));
            }
        });

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
    }

    public playAnimation() {
        if (this.timeline.keyframeIcons.length > 1) {
            this.disableKeyframeControls();
            this.playAnimationBtn.setAttribute('hidden', '');
            this.stopAnimationBtn.removeAttribute('disabled');
            this.stopAnimationBtn.classList.remove('disabled');
            this.stopAnimationBtn.removeAttribute('hidden');

            if (this.hideUiCheckbox.checked) {
                this.ui.toggleUI(false);
                this.elem.style.display = 'none';
            }

            let startTime = this.timeline.getPlayheadTimeMs();
            if (!this.animation.loop && startTime >= this.timeline.getLastKeyframeTimeMs())
                startTime = 0;

            if (this.delayStartCheckbox.checked) {
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
        this.enableKeyframeControls();
        this.playAnimationBtn.removeAttribute('hidden');
        this.stopAnimationBtn.setAttribute('hidden', '');
        if (this.hideUiCheckbox.checked) {
            this.ui.toggleUI(true);
            this.elem.style.display = '';
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
        this.timeline.deselectKeyframeIcon();
        const loadedAnimation = JSON.parse(JSON.stringify(state.animation));
        if (loadedAnimation.loop === undefined)
            loadedAnimation.loop = false;

        if (loadedAnimation.posXTrack.keyframes.length === 0) {
            this.newAnimation();
            return;
        }
        // If loading out of a "new timeline" state, we'll need to unhide the UI.
        this.studioControlsContainer.removeAttribute('hidden');
        this.undoRedoBtnContainer.removeAttribute('hidden');
        this.saveAnimationBtn.removeAttribute('hidden');
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
                kfType = KeyframeIconType.End;

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

    private autoTangentCheckBoxOnChanged(): void {
        if (this.timeline.selectedKeyframeIcon) {
            const kfIconType = this.timeline.selectedKeyframeIcon.type;
            if (this.animation.loop && (kfIconType === KeyframeIconType.Start || kfIconType === KeyframeIconType.End)) {
                this.timeline.keyframeIcons.filter((i) => i.type === KeyframeIconType.Start || i.type === KeyframeIconType.End).forEach((kfIcon) => {
                    kfIcon.keyframesMap.forEach((k) => k.useAutoTangent = this.useAutoTangentValuesCheckbox.checked);
                });
            } else {
                this.timeline.selectedKeyframeIcon.keyframesMap.forEach((k) => k.useAutoTangent = this.useAutoTangentValuesCheckbox.checked);
            }
            if (this.useAutoTangentValuesCheckbox.checked) {
                this.customTangentsContainer.style.display = 'none';
                this.posXTangentInput.setAttribute('hidden', '');
                this.posYTangentInput.setAttribute('hidden', '');
                this.posZTangentInput.setAttribute('hidden', '');
                this.lookAtXTangentInput.setAttribute('hidden', '');
                this.lookAtYTangentInput.setAttribute('hidden', '');
                this.lookAtZTangentInput.setAttribute('hidden', '');
                this.bankTangentInput.setAttribute('hidden', '');
                this.updatePreviewSteps();
            } else {
                if (this.posXTangentInput.value)
                    this.posXTangentInput.removeAttribute('hidden');
                if (this.posYTangentInput.value)
                    this.posYTangentInput.removeAttribute('hidden');
                if (this.posZTangentInput.value)
                    this.posZTangentInput.removeAttribute('hidden');
                if (this.lookAtXTangentInput.value)
                    this.lookAtXTangentInput.removeAttribute('hidden');
                if (this.lookAtYTangentInput.value)
                    this.lookAtYTangentInput.removeAttribute('hidden');
                if (this.lookAtZTangentInput.value)
                    this.lookAtZTangentInput.removeAttribute('hidden');
                if (this.bankTangentInput.value)
                    this.bankTangentInput.removeAttribute('hidden');
                this.customTangentsContainer.style.display = 'grid';
            }
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

    private onChangeTangentInput(input: HTMLInputElement): void {
        if (this.timeline.selectedKeyframeIcon && input.value) {
            const val = parseFloat(input.value);
            if (!Number.isNaN(val)) {
                const trackType = parseInt(input.dataset.track!, 10);
                const kf = this.timeline.selectedKeyframeIcon.keyframesMap.get(trackType)!;
                this.getTrackByType(this.animation, trackType).setCustomTangent(kf, val);
                this.updatePreviewSteps();
            }
        }
    }

    private getTangentInput(trackType: KeyframeTrackType): HTMLInputElement {
        if (trackType === KeyframeTrackType.posXTrack)
            return this.posXTangentInput;
        else if (trackType === KeyframeTrackType.posYTrack)
            return this.posYTangentInput;
        else if (trackType === KeyframeTrackType.posZTrack)
            return this.posZTangentInput;
        else if (trackType === KeyframeTrackType.lookAtXTrack)
            return this.lookAtXTangentInput;
        else if (trackType === KeyframeTrackType.lookAtYTrack)
            return this.lookAtYTangentInput;
        else if (trackType === KeyframeTrackType.lookAtZTrack)
            return this.lookAtZTangentInput;
        else if (trackType === KeyframeTrackType.bankTrack)
            return this.bankTangentInput;
        else
            throw "whoops";
    }

    private displayKeyframeControls() {
        const kfIcon = this.timeline.selectedKeyframeIcon;
        if (kfIcon) {
            let autoTangents = true;
            kfIcon.keyframesMap.forEach((kf, trackType) => {
                autoTangents = kf.useAutoTangent;
                const input = this.getTangentInput(trackType);
                input.value = kf.tangentOut.toString();
            });
            this.useAutoTangentValuesCheckbox.setChecked(autoTangents);
            this.autoTangentCheckBoxOnChanged();
            this.keyframeControls.removeAttribute('hidden');
            this.selectKeyframeMsg.setAttribute('hidden', '');
        }
    }

    private hideKeyframeControls() {
        this.posXTangentInput.value = '';
        this.posYTangentInput.value = '';
        this.posZTangentInput.value = '';
        this.lookAtXTangentInput.value = '';
        this.lookAtYTangentInput.value = '';
        this.lookAtZTangentInput.value = '';
        this.bankTangentInput.value = '';
        this.keyframeControls.setAttribute('hidden', '');
        this.selectKeyframeMsg.removeAttribute('hidden');
    }

    private initTimeline() {
        this.studioHelpText.dataset.default = 'Move the playhead to the desired time, then move the camera and press Enter to place a keyframe.';
        this.studioHelpText.innerText = this.studioHelpText.dataset.default;
        const markersCtx = this.timelineMarkersCanvas.getContext('2d') as CanvasRenderingContext2D;
        const elementsCtx = this.timelineElementsCanvas.getContext('2d') as CanvasRenderingContext2D;
        this.studioControlsContainer.removeAttribute('hidden');
        this.undoRedoBtnContainer.removeAttribute('hidden');
        this.saveAnimationBtn.removeAttribute('hidden');
        this.timeline = new Timeline(markersCtx, elementsCtx, Timeline.DEFAULT_LENGTH_MS);
        this.timeline.draw();
    }

    private getPreviewSteps(): InterpolationStep[] {
        const steps: InterpolationStep[] = [];

        // TODO(jstpierre): Don't rely on animationManager for this.
        const PREVIEW_STEP_TIME_MS = 16;
        for (let time = 0; time <= this.animationManager.durationMs; time += PREVIEW_STEP_TIME_MS) {
            const step = new InterpolationStep();
            this.animationManager.getAnimFrame(step, time);
            steps.push(step);
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
        setElementHighlighted(this.editKeyframePositionBtn, true);
        this.studioHelpText.innerText = this.studioHelpText.dataset.editPosHelpText as string;
        this.disableKeyframeControls();
    }

    public endEditKeyframePosition() {
        if (this.editingKeyframe) {
            this.editingKeyframe = false;
            setElementHighlighted(this.editKeyframePositionBtn, false);
            this.resetHelpText();
            this.enableKeyframeControls();
        }
    }

    public deleteSelectedKeyframeIcon() {
        if (this.timeline.selectedKeyframeIcon) {
            const type = this.timeline.selectedKeyframeIcon.type;
            if (type === KeyframeIconType.Default) {
                const posXTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posXTrack);
                const posYTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posYTrack);
                const posZTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posZTrack);
                const lookAtXTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtXTrack);
                const lookAtYTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtYTrack);
                const lookAtZTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtZTrack);
                const bankTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.bankTrack);
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
                this.timeline.deleteSelectedKeyframeIcon();
                this.timeline.draw();
                this.updatePreviewSteps();
                this.saveState();
            }
        }
    }

    private scratchVecPos: vec3 = vec3.create();
    private scratchVecLook: vec3 = vec3.create();
    private scratchVecZAxis: vec3 = vec3.create();

    public addKeyframesFromMat4(worldMatrix: ReadonlyMat4): void {
        if (!this.timeline || this.timeline.keyframeIcons.length === 0)
            this.initTimeline();

        if (this.timeline.selectedKeyframeIcon && !this.editingKeyframe)
            return;

        if (!this.timeline.selectedKeyframeIcon && this.timeline.playheadIsOnIcon())
            return;

        const time = this.timeline.getPlayheadTimeMs();
        const tracks = this.selectedTracks;

        mat4.getTranslation(this.scratchVecPos, worldMatrix);
        getMatrixAxisZ(this.scratchVecZAxis, worldMatrix);
        vec3.normalize(this.scratchVecZAxis, this.scratchVecZAxis);
        vec3.scaleAndAdd(this.scratchVecLook, this.scratchVecPos, this.scratchVecZAxis, -100);

        const posXKf: Keyframe = { time, value: this.scratchVecPos[0], tangentIn: 0, tangentOut: 0, useAutoTangent: true };
        const posYKf: Keyframe = { time, value: this.scratchVecPos[1], tangentIn: 0, tangentOut: 0, useAutoTangent: true };
        const posZKf: Keyframe = { time, value: this.scratchVecPos[2], tangentIn: 0, tangentOut: 0, useAutoTangent: true };
        const lookAtXKf: Keyframe = { time, value: this.scratchVecLook[0], tangentIn: 0, tangentOut: 0, useAutoTangent: true };
        const lookAtYKf: Keyframe = { time, value: this.scratchVecLook[1], tangentIn: 0, tangentOut: 0, useAutoTangent: true };
        const lookAtZKf: Keyframe = { time, value: this.scratchVecLook[2], tangentIn: 0, tangentOut: 0, useAutoTangent: true };

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
        const bankKf: Keyframe = { time, value: bank, tangentIn: 0, tangentOut: 0, useAutoTangent: true };

        if (this.editingKeyframe) {
            if (this.timeline.selectedKeyframeIcon) {
                if (this.timeline.selectedKeyframeIcon.type === KeyframeIconType.Start
                    || this.timeline.selectedKeyframeIcon.type === KeyframeIconType.End) {
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
                    const currentPosXTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posXTrack);
                    const currentPosYTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posYTrack);
                    const currentPosZTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.posZTrack);
                    const currentLookAtXTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtXTrack);
                    const currentLookAtYTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtYTrack);
                    const currentLookAtZTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.lookAtZTrack);
                    const currentBankTrackKf = this.timeline.selectedKeyframeIcon.keyframesMap.get(KeyframeTrackType.bankTrack);
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
            const { value, tangentIn, tangentOut, useAutoTangent } = track.keyframes[0];
            return { time, value, tangentIn, tangentOut, useAutoTangent };
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

        this.timeline.addKeyframeIcon(kfMap, time, Timeline.KEYFRAME_ICONS_BASE_Y_POS, KeyframeIconType.End, false);

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
        this.timeline.deselectKeyframeIcon();
        this.timeline.keyframeIcons = [];
        this.playheadTimePositionInput.value = '0';
        this.timelineLengthInput.value = (Timeline.DEFAULT_LENGTH_MS / MILLISECONDS_IN_SECOND).toFixed(2);
        this.timelineLengthInput.dispatchEvent(new Event('change', { bubbles: true }));
        this.livePreviewCheckbox.setChecked(false);
        this.showPreviewLineCheckbox.setChecked(true);
        this.selectedTracks |= KeyframeTrackType.allTracks;
        this.saveAnimationBtn.setAttribute('hidden', '');
        this.studioControlsContainer.setAttribute('hidden', '');
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.resetHelpText();
    }

    private displayHelpText(elem: HTMLElement) {
        if (!this.editingKeyframe && !this.persistHelpText)
            this.studioHelpText.innerText = elem.dataset.helpText ? elem.dataset.helpText : this.studioHelpText.dataset.default as string;
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

    private disableKeyframeControls(): void {
        this.studioControlsContainer.querySelectorAll(`button, input`).forEach((e) => {
            e.setAttribute('disabled', '');
            e.classList.add('disabled');
        });
    }

    private enableKeyframeControls(): void {
        this.studioControlsContainer.querySelectorAll(`button, input`).forEach((e) => {
            e.removeAttribute('disabled');
            e.classList.remove('disabled');
        });
    }
}
