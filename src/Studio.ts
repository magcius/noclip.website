import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { Keyframe, CameraAnimationManager, CameraAnimation, InterpolationStep, KeyframeTrack } from './CameraAnimationManager';
import { StudioCameraController } from './Camera';
import { clamp, computeEulerAngleRotationFromSRTMatrix, getMatrixAxisZ, Vec3UnitY, Vec3Zero } from './MathHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GlobalSaveManager } from './SaveManager';

export const CLAPBOARD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="20" fill="white"><path d="M61,22H14.51l3.41-.72h0l7.74-1.64,2-.43h0l6.85-1.46h0l1.17-.25,8.61-1.83h0l.78-.17,9-1.91h0l.4-.08L60,12.33a1,1,0,0,0,.77-1.19L59.3,4.3a1,1,0,0,0-1.19-.77l-19,4-1.56.33h0L28.91,9.74,27.79,10h0l-9.11,1.94-.67.14h0L3.34,15.17a1,1,0,0,0-.77,1.19L4,23.11V60a1,1,0,0,0,1,1H61a1,1,0,0,0,1-1V23A1,1,0,0,0,61,22ZM57,5.8l.65.6.89,4.19-1.45.31L52.6,6.75ZM47.27,7.88,51.8,12,47.36,13,42.82,8.83ZM37.48,10,42,14.11l-4.44.94L33,10.91ZM27.7,12l4.53,4.15-4.44.94L23.26,13Zm-9.78,2.08,4.53,4.15L18,19.21l-4.53-4.15ZM19.49,29H14.94l3.57-5h4.54Zm9-5h4.54l-3.57,5H24.94ZM39,45.88l-11,6A1,1,0,0,1,26.5,51V39A1,1,0,0,1,28,38.12l11,6a1,1,0,0,1,0,1.76ZM39.49,29H34.94l3.57-5h4.54Zm10,0H44.94l3.57-5h4.54ZM60,29H54.94l3.57-5H60Z"/></svg>`;
const POPOUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -5 100 100" height="20" fill="white"><g><polygon points="65.1 17.2 77.1 17.2 41.2 53.1 46.9 58.8 82.8 22.9 82.8 34.9 90.8 34.9 90.8 9.2 65.1 9.2 65.1 17.2"/><polygon points="80.6 46.5 72.6 46.5 72.6 82.8 17.2 82.8 17.2 27.4 53.5 27.4 53.5 19.4 9.2 19.4 9.2 90.8 80.6 90.8 80.6 46.5"/></g></svg>`
const MILLISECONDS_IN_SECOND = 1000.0;

const MIN_ANIMATION_LENGTH_SEC = 1;
const MAX_ANIMATION_LENGTH_SEC = 300;

const enum KeyframeTrackEnum {
    posXTrack = 0b0000001,
    posYTrack = 0b0000010,
    posZTrack = 0b0000100,
    lookAtXTrack = 0b0001000,
    lookAtYTrack = 0b0010000,
    lookAtZTrack = 0b0100000,
    bankTrack = 0b1000000,
    allTracks = 0b1111111
}

const enum TimelineMode {
    Consolidated,
    Position_LookAt_Bank,
    Full
}

class Playhead {
    static readonly WIDTH: number = 15;
    static readonly HALF_WIDTH: number = Playhead.WIDTH / 2;
    static readonly HEIGHT: number = 15;
    static readonly POINTER_HEIGHT: number = 10;
    static readonly COLOR: string = '#FF0000'

    constructor(init?: Partial<Playhead>) {
        Object.assign(this, init);
        this.updatePath();
    }
    private x: number = 0;
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
    };
    public drawLine(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.strokeStyle = Playhead.COLOR;
        ctx.lineWidth = 1.5;
        ctx.moveTo(this.x, Playhead.HEIGHT + Playhead.POINTER_HEIGHT - 1);
        ctx.lineTo(this.x, 85);
        ctx.stroke();
    };
    public updatePosition(x: number) {
        this.x = x;
        this.updatePath();
    }
    public getX(): number {
        return this.x;
    }

}
// use bitfield number to indicate tracks corresponding keyframes belong to
class KeyframeIcon {
    static readonly SIDE_LENGTH: number = 10;
    static readonly HEIGHT = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH * 2);
    static readonly XY_DIST = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH / 2);
    static readonly COLOR: string = '#FFFFFF';
    static readonly SELECTED_COLOR: string = '#FF500B';
    static readonly ENDFRAME_COLOR: string = '#4EB0FF';

    constructor(public keyframes: Keyframe[], private x: number, public y: number) {
        this.updatePath();
    }
    public iconPath = new Path2D();
    public selected: boolean = false;
    public isEndFrame: boolean;
    public draw(ctx: CanvasRenderingContext2D) {
        if (this.isEndFrame)
            ctx.fillStyle = KeyframeIcon.ENDFRAME_COLOR;
        else if (this.selected)
            ctx.fillStyle = KeyframeIcon.SELECTED_COLOR;
        else
            ctx.fillStyle = KeyframeIcon.COLOR;
        ctx.fill(this.iconPath);
    }
    public updatePosition(x: number, t: number) {
        this.x = x;
        this.updatePath();
        for (let i = 0; i < this.keyframes.length; i++) {
            this.keyframes[i].time = t;
        }
    }
    public getX(): number {
        return this.x;
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
    private keyframeIconBaseYPos: number;
    private playhead: Playhead;
    private keyframeIcons: KeyframeIcon[] = [];
    private selectedKeyframeIcons: KeyframeIcon[] = [];
    private pixelsPerSecond: number;
    private timelineScaleFactor: number = 1;
    private playheadGrabbed: boolean = false;
    private keyframeIconGrabbed: boolean = false;
    public snappingEnabled: boolean = true;

    // Calculates the scale and redraws the time markers when changing the width of the canvas, or the max time value on the timeline.
    public setScaleAndDrawMarkers(lengthMs?: number) {
        this.width = this.elementsCtx.canvas.width;
        this.height = this.elementsCtx.canvas.height;
        if (lengthMs)
            this.lengthMs = lengthMs;
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
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            const timeMs = this.keyframeIcons[i].keyframes[0].time;
            this.keyframeIcons[i].updatePosition((timeMs / MILLISECONDS_IN_SECOND) * this.pixelsPerSecond, timeMs);
        }
    }

    public getLengthMs(): number {
        return this.lengthMs;
    }

    public draw() {
        this.elementsCtx.clearRect(-Playhead.WIDTH, 0, this.width + Playhead.WIDTH, this.height);
        this.playhead.draw(this.elementsCtx);
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            this.keyframeIcons[i].draw(this.elementsCtx);
        }
        this.playhead.drawLine(this.elementsCtx);
    }

    public addKeyframeIcon(kfs: Keyframe[], t: number, y: number) {
        const xPos = (t / MILLISECONDS_IN_SECOND) * this.pixelsPerSecond * this.timelineScaleFactor;
        const kfIcon = new KeyframeIcon(kfs, xPos, y);
        this.keyframeIcons.push(kfIcon);
    }

    public addEndFrameIcons(t: number) {

    }

    public onMouseDown(e: MouseEvent) {
        e.stopPropagation();
        // Click landed on playhead
        if (this.elementsCtx.isPointInPath(this.playhead.playheadPath, e.offsetX, e.offsetY)) {
            this.playheadGrabbed = true;
            return;
        }
        // Check if click landed on a currently-selected keyframe
        let selectedIconClicked = false;
        for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
            if (this.elementsCtx.isPointInPath(this.selectedKeyframeIcons[i].iconPath, e.offsetX, e.offsetY)) {
                selectedIconClicked = true;
                this.keyframeIconGrabbed = true;
                break;
            }
        }
        if (!selectedIconClicked) {
            // Click did not land on playhead or any selected keyframe icon. Deselect all selected keyframes.
            for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
                this.selectedKeyframeIcons[i].selected = false;
            }
            this.selectedKeyframeIcons = [];
            // Check if click landed on any keyframe icon.
            for (let i = 0; i < this.keyframeIcons.length; i++) {
                if (this.elementsCtx.isPointInPath(this.keyframeIcons[i].iconPath, e.offsetX, e.offsetY)) {
                    this.keyframeIcons[i].selected = true;
                    this.selectedKeyframeIcons.push(this.keyframeIcons[i]);
                    this.keyframeIconGrabbed = true;
                    return;
                }
            }
        }
        this.draw();
    }

    public onMouseUp(e: MouseEvent) {
        this.playheadGrabbed = false;
        this.keyframeIconGrabbed = false;
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

        if (this.playheadGrabbed) {
            if (this.snappingEnabled) {
                const snapKfIndex = this.getClosestSnappingIconIndex(targetX);
                if (snapKfIndex > -1)
                    targetX = this.keyframeIcons[snapKfIndex].getX();
            }
            this.playhead.updatePosition(targetX);
        }

        if (this.keyframeIconGrabbed) {
            if (this.snappingEnabled && Math.abs(targetX - this.playhead.getX()) < Timeline.SNAP_DISTANCE_PX)
                this.updateSelectedKeyframeIconPositions(this.playhead.getX());
            else
                this.updateSelectedKeyframeIconPositions(targetX);
        }

        this.draw();
    }

    /**
     * 
     * @param x The
     */
    private updateSelectedKeyframeIconPositions(x: number) {
        const t = x / this.pixelsPerSecond * MILLISECONDS_IN_SECOND * this.timelineScaleFactor;
        for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
            const icon = this.selectedKeyframeIcons[i];
            icon.updatePosition(x, t);
            for (let j = 0; j < icon.keyframes.length; j++) {
                icon.keyframes[j].time = t;
            }
        }
    }

    private getClosestSnappingIconIndex(x: number): number {
        let closestDist = Timeline.SNAP_DISTANCE_PX;
        let snapKfIndex = -1;
        for (let i = 0; i < this.keyframeIcons.length && closestDist > 0; i++) {
            const dist = Math.abs(x - this.keyframeIcons[i].getX());
            if (dist < closestDist) {
                snapKfIndex = i;
                closestDist = dist;
            }
        }
        return snapKfIndex;
    }

    public setPlayheadTimeSeconds(t: number) {
        this.playhead.updatePosition(t * this.pixelsPerSecond / this.timelineScaleFactor);
        this.draw();
    }

    /**
     * Return the playhead time in milliseconds, for logic purposes.
     */
    public getPlayheadTimeMs(): number {
        return this.getPlayheadTime() * MILLISECONDS_IN_SECOND;
    }

    /**
     * Return the playhead time rounded in seconds, for display purposes.
     */
    public getPlayheadTimeSeconds(): string {
        return this.getPlayheadTime().toFixed(2);
    }

    private getPlayheadTime(): number {
        return this.playhead.getX() / this.pixelsPerSecond * this.timelineScaleFactor;
    }

    public getLastKeyframeTimeMs(): number {
        return Math.max(...this.keyframeIcons.map((k) => { return k.getX() / this.pixelsPerSecond * this.timelineScaleFactor * MILLISECONDS_IN_SECOND }));
    }

    public getLastKeyframeTimeSeconds(): string {
        return (this.getLastKeyframeTimeMs() * MILLISECONDS_IN_SECOND).toFixed(2);
    }
}

export class StudioPanel extends FloatingPanel {
    private animationManager: CameraAnimationManager;
    public studioCameraController: StudioCameraController;

    private animation: CameraAnimation;
    public animationPreviewSteps: InterpolationStep[];

    private studioPanelContents: HTMLElement;
    private studioHelpText: HTMLElement;

    private studioDataBtn: HTMLInputElement;
    private studioSaveLoadControls: HTMLElement;
    private newAnimationBtn: HTMLInputElement;
    private loadAnimationBtn: HTMLInputElement;
    private saveAnimationBtn: HTMLInputElement;
    private importAnimationBtn: HTMLInputElement;
    private exportAnimationBtn: HTMLInputElement;

    private studioControlsContainer: HTMLElement;

    private timelineControlsContainer: HTMLElement;
    private snappingCheckbox: Checkbox;
    private timelineModeSelect: HTMLSelectElement;
    private playheadTimePositionInput: HTMLInputElement;
    private timelineLengthInput: HTMLInputElement;

    private timelineMarkersCanvas: HTMLCanvasElement;
    private timelineElementsCanvas: HTMLCanvasElement;
    public totalKeyframes(): number {
        if (!this.animation)
            return 0;
        else
            return this.animation.posXTrack.keyframes.length
                + this.animation.posYTrack.keyframes.length
                + this.animation.posZTrack.keyframes.length
                + this.animation.lookAtXTrack.keyframes.length
                + this.animation.lookAtYTrack.keyframes.length
                + this.animation.lookAtZTrack.keyframes.length
                + this.animation.bankTrack.keyframes.length;
    }

    private editKeyframePositionBtn: HTMLElement;
    private editingKeyframePosition: boolean = false;
    private persistHelpText: boolean = false;

    private timeline: Timeline;
    private timelineMode: TimelineMode = TimelineMode.Consolidated;
    private selectedTracks: number = KeyframeTrackEnum.allTracks;
    private keyframeControls: HTMLElement;
    private selectedKeyframe: Keyframe;

    private moveKeyframeLeftBtn: HTMLElement;
    private moveKeyframeRightBtn: HTMLElement;

    private firstKeyframeBtn: HTMLElement;
    private previousKeyframeBtn: HTMLElement;
    private nextKeyframeBtn: HTMLElement;
    private lastKeyframeBtn: HTMLElement;

    private playbackControls: HTMLElement;
    private hideUiCheckbox: Checkbox;
    private delayStartCheckbox: Checkbox;
    private loopAnimationCheckbox: Checkbox;
    private playBtn: HTMLElement;
    private pauseAnimationBtn: HTMLElement;

    private popOutBtn: HTMLElement;
    private popOutWindow: Window;

    constructor(private ui: UI, private viewer: Viewer.Viewer) {
        super();
        // Closing the panel will be done by disabling studio mode
        this.closeButton.style.display = 'none';
        this.setWidth(650);
        this.elem.id = 'studioPanel';
        this.elem.style.display = 'none';
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
        if (this.popOutWindow)
            this.popOutWindow.open();
    }

    public hide(): void {
        this.elem.style.display = 'none';
        if (this.popOutWindow)
            this.popOutWindow.close();
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
                padding: 0 1rem 0.5rem 1rem;
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
            #timelineContainerDiv {
                padding: 0 15px;
                margin-bottom: 10px;
                overflow: hidden;
                position: relative;
                height: ${Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT}px;
                flex: 1;
            }
            #timelineContainerDiv > canvas {
                position: absolute;
            }
            #timelineContainerDiv > div {
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
            .KeyframeNumericInput {
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
            }
            #playbackControls {
                padding: 0 5rem 1rem;
                border-top: 1px solid #444;
            }
            #popOutBtnContainer {
                position: absolute;
                bottom: 0;
                right: 0.25rem;
            }
        </style>
        <button type="button" id="studioDataBtn" class="SettingsButton">📁</button>
        <div id="studioSaveLoadControls" hidden>
            <div style="display: grid;grid-template-columns: 1fr 1fr 1fr; gap: 0.25rem 1rem;">
                <button type="button" id="newAnimationBtn" class="SettingsButton">New</button>
                <button type="button" id="loadAnimationBtn" class="SettingsButton">Load</button>
                <button type="button" id="saveAnimationBtn" class="SettingsButton">Save</button>
                <div></div>
                <button type="button" id="importAnimationBtn" class="SettingsButton">Import</button>
                <button type="button" id="exportAnimationBtn" class="SettingsButton">Export</button>
            </div>
        </div>
        <div id="studioHelpText"></div>
        <div id="studioControlsContainer" hidden>
            <div id="timelineControlsContainer" style="display: flex;margin: 0 25px 5px;align-items: center;justify-content: flex-end;">
                <div>
                    <span>Timeline Mode:</span>
                    <select id="timelineModeSelect">
                        <option value="${TimelineMode.Consolidated}">Consolidated</option>
                        <option value="${TimelineMode.Position_LookAt_Bank}">Pos/LookAt/Bank</option>
                        <option value="${TimelineMode.Full}">Full</option>
                    </select>
                </div>
                <input id="playheadTimePositionInput" class="KeyframeNumericInput" type="number" min="0" max="300" step="0.1" value="0">
                <span>/</span>
                <input id="timelineLengthInput" class="KeyframeNumericInput" type="number" min="1" max="300" step="0.1" value="${Timeline.DEFAULT_LENGTH_MS / MILLISECONDS_IN_SECOND}">
                <span>s</span>
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
                <div id="timelineContainerDiv">
                    <div id="timelineHeaderBg"></div>
                    <div id="timelineTracksBg"></div>
                    <canvas id="timelineMarkersCanvas" width="600" height="${Timeline.HEADER_HEIGHT}"></canvas>
                    <canvas id="timelineElementsCanvas" width="600" height="${Timeline.HEADER_HEIGHT + Timeline.TRACK_HEIGHT}"></canvas>
                </div>
            </div>
            <div id="keyframeNavControls" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.25rem;">
                <button type="button" id="firstKeyframeBtn" class="SettingsButton">&lt;&lt;-</button>
                <button type="button" id="previousKeyframeBtn" class="SettingsButton">&lt;-</button>
                <button type="button" id="nextKeyframeBtn" class="SettingsButton">-&gt;</button>
                <button type="button" id="lastKeyframeBtn" class="SettingsButton">-&gt;&gt;</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr;">
                <div id="keyframeControls" hidden>
                    <button type="button" id="editKeyframePositionBtn" class="SettingsButton">Edit Position</button>
                    <div>
                        <div class="SettingsHeader KeyframeSettingsName">Name</div>
                        <input id="keyframeName" type="text" minLength="1" maxLength="20" size="20" autocomplete="off"/>
                    </div>
                    <div id="keyframeDurationContainer">
                        <div class="SettingsHeader KeyframeSettingsName">Duration</div>
                        <div style="display:flex; align-items:center; justify-content:space-evenly">
                            <input id="keyframeDuration" class="KeyframeNumericInput" type="number" min="0" max="100.0" step="0.1"/> <span>s</span>
                            <button type="button" id="matchPrevSpeedBtn" class="SettingsButton" style="width:60%">Match Prev Speed</button>
                        </div>
                    </div>
                    <div id="interpolationSettings">
                        
                    </div>
                    <div>
                        <div class="SettingsHeader KeyframeSettingsName">Hold Duration</div>
                        <input id="keyframeHoldDuration" class="KeyframeNumericInput" type="number" min="0" max="100.0" step="0.1"/> <span>s</span>
                    </div>
                    <div style="margin: 1rem;">
                        <button type="button" id="moveKeyframeUpBtn" style="margin-bottom:0.5rem;" class="SettingsButton">Move up</button>
                        <button type="button" id="moveKeyframeDownBtn" class="SettingsButton">Move down</button>
                    </div>
                    <button type="button" id="previewKeyframeBtn" class="SettingsButton">Preview keyframe</button>
                    <button type="button" id="stopPreviewKeyframeBtn" class="SettingsButton" hidden>Stop Preview</button>
                </div>
            </div>
            <div id="playbackControls">
                <button type="button" id="playAnimationBtn" class="SettingsButton">▶</button>
                <button type="button" id="stopAnimationBtn" class="SettingsButton" hidden>■</button>
            </div>
            <div id="popOutBtnContainer">
                <button type="button" id="popOutBtn" class="SettingsButton"></button>
            </div>
        </.div>`);
        this.studioHelpText = this.contents.querySelector('#studioHelpText') as HTMLElement;
        this.studioHelpText.dataset.startPosHelpText = 'Move the camera to the desired starting position and press Enter.';
        this.studioHelpText.dataset.editPosHelpText = 'Move the camera to the desired position and press Enter. Press Escape to cancel.';
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.studioHelpText.innerText = this.studioHelpText.dataset.startPosHelpText;

        this.studioDataBtn = this.contents.querySelector('#studioDataBtn') as HTMLInputElement;
        this.studioDataBtn.dataset.helpText = 'Save the current animation, or load a previously-saved animation.';

        this.studioSaveLoadControls = this.contents.querySelector('#studioSaveLoadControls') as HTMLElement;

        this.newAnimationBtn = this.contents.querySelector('#newAnimationBtn') as HTMLInputElement;
        this.newAnimationBtn.dataset.helpText = 'Clear the current keyframes and create a new animation.';

        this.loadAnimationBtn = this.contents.querySelector('#loadAnimationBtn') as HTMLInputElement;
        this.loadAnimationBtn.dataset.helpText = 'Load the previously-saved animation for this map. Overwrites the current keyframes!';

        this.saveAnimationBtn = this.contents.querySelector('#saveAnimationBtn') as HTMLInputElement;
        this.saveAnimationBtn.dataset.helpText = 'Save the current animation for this map to your browser\'s local storage.';

        this.importAnimationBtn = this.contents.querySelector('#importAnimationBtn') as HTMLInputElement;
        this.importAnimationBtn.dataset.helpText = 'Load an animation from a JSON file.';

        this.exportAnimationBtn = this.contents.querySelector('#exportAnimationBtn') as HTMLInputElement;
        this.exportAnimationBtn.dataset.helpText = 'Save the current animation as a JSON file.';

        this.studioControlsContainer = this.contents.querySelector('#studioControlsContainer') as HTMLElement;

        this.timelineControlsContainer = this.contents.querySelector('#timelineControlsContainer') as HTMLElement;

        this.snappingCheckbox = new Checkbox('Snapping', true);
        this.snappingCheckbox.onchanged = () => { this.timeline.snappingEnabled = this.snappingCheckbox.checked; };
        this.snappingCheckbox.elem.style.marginRight = '1rem';
        this.snappingCheckbox.elem.dataset.helpText = 'Snap keyframes to the playhead, and vice-versa.'

        this.timelineControlsContainer.insertAdjacentElement('afterbegin', this.snappingCheckbox.elem);

        this.timelineMarkersCanvas = this.contents.querySelector('#timelineMarkersCanvas') as HTMLCanvasElement;
        this.timelineElementsCanvas = this.contents.querySelector('#timelineElementsCanvas') as HTMLCanvasElement;

        this.playheadTimePositionInput = this.contents.querySelector('#playheadTimePositionInput') as HTMLInputElement;
        this.playheadTimePositionInput.onfocus = () => {
            this.playheadTimePositionInput.dataset.prevValue = this.playheadTimePositionInput.value;
        }
        this.playheadTimePositionInput.onchange = () => {
            let timePosValue = parseFloat(this.playheadTimePositionInput.value);
            if (Number.isNaN(timePosValue)) {
                this.playheadTimePositionInput.value = this.playheadTimePositionInput.dataset.prevValue!.toString();
                return;
            } else {
                timePosValue = clamp(timePosValue, 0, this.timeline.getLengthMs() / MILLISECONDS_IN_SECOND);
                this.playheadTimePositionInput.value = timePosValue.toString();
            }

            this.timeline.setPlayheadTimeSeconds(timePosValue);
            this.playheadTimePositionInput.dataset.prevValue = timePosValue.toString();
        }

        this.timelineLengthInput = this.contents.querySelector('#timelineLengthInput') as HTMLInputElement;
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
            this.timeline.setPlayheadTimeSeconds(playheadTimePosValue);
        }

        this.editKeyframePositionBtn = this.contents.querySelector('#editKeyframePositionBtn') as HTMLInputElement;
        setElementHighlighted(this.editKeyframePositionBtn, false);

        this.keyframeControls = this.contents.querySelector('#keyframeControls') as HTMLElement;

        this.moveKeyframeLeftBtn = this.contents.querySelector('#moveKeyframeUpBtn') as HTMLInputElement;
        this.moveKeyframeRightBtn = this.contents.querySelector('#moveKeyframeDownBtn') as HTMLInputElement;

        this.firstKeyframeBtn = this.contents.querySelector('#firstKeyframeBtn') as HTMLInputElement;
        this.previousKeyframeBtn = this.contents.querySelector('#previousKeyframeBtn') as HTMLInputElement;
        this.nextKeyframeBtn = this.contents.querySelector('#nextKeyframeBtn') as HTMLInputElement;
        this.lastKeyframeBtn = this.contents.querySelector('#lastKeyframeBtn') as HTMLInputElement;

        this.playbackControls = this.contents.querySelector('#playbackControls') as HTMLElement;

        this.delayStartCheckbox = new Checkbox('Delay animation playback');
        this.loopAnimationCheckbox = new Checkbox('Loop animation');
        this.hideUiCheckbox = new Checkbox('Hide UI during playback');
        this.delayStartCheckbox.elem.dataset.helpText = 'Delay the start of the animation by 2s. Useful for avoiding capture of the mouse cursor.';
        this.loopAnimationCheckbox.elem.dataset.helpText = 'Loop the animation until manually stopped.'
        this.hideUiCheckbox.elem.dataset.helpText = 'Hide the noclip UI during playback. (Press Escape to stop playback.)';
        this.playbackControls.insertAdjacentElement('afterbegin', this.delayStartCheckbox.elem);
        this.playbackControls.insertAdjacentElement('afterbegin', this.loopAnimationCheckbox.elem);
        this.playbackControls.insertAdjacentElement('afterbegin', this.hideUiCheckbox.elem);

        this.playBtn = this.contents.querySelector('#playAnimationBtn') as HTMLInputElement;
        this.pauseAnimationBtn = this.contents.querySelector('#stopAnimationBtn') as HTMLInputElement;

        this.popOutBtn = this.contents.querySelector('#popOutBtn') as HTMLInputElement;
        this.popOutBtn.insertAdjacentElement('afterbegin', createDOMFromString(POPOUT_ICON).querySelector('svg')!);

        this.studioDataBtn.onclick = () => this.studioSaveLoadControls.toggleAttribute('hidden');
        this.newAnimationBtn.onclick = () => this.newAnimation();
        this.loadAnimationBtn.onclick = () => this.loadAnimation();
        this.saveAnimationBtn.onclick = () => this.saveAnimation();
        this.exportAnimationBtn.onclick = () => this.exportAnimation();
        this.importAnimationBtn.onclick = () => this.importAnimation();

        this.firstKeyframeBtn.onclick = () => this.navigateKeyframes(-this.totalKeyframes());
        this.previousKeyframeBtn.onclick = () => this.navigateKeyframes(-1);
        this.nextKeyframeBtn.onclick = () => this.navigateKeyframes(1);
        this.lastKeyframeBtn.onclick = () => this.navigateKeyframes(this.totalKeyframes());

        this.moveKeyframeLeftBtn.onclick = () => {
            if (this.selectedKeyframe) {
                // TODO
            }
        }

        this.moveKeyframeRightBtn.onclick = () => {
            if (this.selectedKeyframe) {
                // TODO
            }
        }

        this.loopAnimationCheckbox.onchanged = () => {
            // TODO
        }

        let playHeadPositionTime = 0;

        this.playBtn.onclick = (e) => {
            if (this.totalKeyframes() > 1) {
                e.stopPropagation();
                this.disableKeyframeControls();
                this.playBtn.setAttribute('hidden', '');
                this.pauseAnimationBtn.removeAttribute('disabled');
                this.pauseAnimationBtn.classList.remove('disabled');
                this.pauseAnimationBtn.removeAttribute('hidden');
                if (this.hideUiCheckbox.checked) {
                    this.ui.toggleUI(false);
                    this.elem.style.display = 'none';
                }
                if (this.delayStartCheckbox.checked) {
                    setTimeout(() => {
                        this.animationManager.playAnimation(this.animation, this.loopAnimationCheckbox.checked, playHeadPositionTime);
                    }, 2000);
                } else {
                    this.animationManager.playAnimation(this.animation, this.loopAnimationCheckbox.checked, playHeadPositionTime);
                }
            }
        }

        this.pauseAnimationBtn.onclick = () => {
            this.studioCameraController.stopAnimation();
            this.playBtn.removeAttribute('hidden');
            this.pauseAnimationBtn.setAttribute('hidden', '');
        }

        this.popOutBtn.onclick = () => {
            this.popOutWindow = window.open('', undefined, 'top=0px,left=0px,width=800px,height=700px')!;
            const uiTop = this.elem.parentElement;
            this.popOutWindow.document.body.insertAdjacentHTML('afterbegin', this.elem.innerHTML);
            this.elem.style.display = 'none';
            this.popOutWindow.onclose = () => {
                uiTop?.appendChild(this.elem);
            }
        }

        this.studioControlsContainer.addEventListener('animationStopped', () => {
            this.enableKeyframeControls();
            this.playBtn.removeAttribute('hidden');
            this.pauseAnimationBtn.setAttribute('hidden', '');
            this.ui.toggleUI(true);
            this.elem.style.display = '';
        });

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

        this.newAnimation();
        this.studioPanelContents.removeAttribute('hidden');
    }

    onAnimationStopped() {
        throw new Error('Method not implemented.');
    }

    endEditKeyframePosition() {
        throw new Error('Method not implemented.');
    }

    addKeyframe(worldMatrix: mat4) {
        if (this.totalKeyframes() === 0)
            this.initTimeline();
        this.addKeyframesFromMat4(worldMatrix, this.timeline.getPlayheadTimeMs(), this.selectedTracks);
    }

    private initTimeline() {
        const markersCtx = this.timelineMarkersCanvas.getContext('2d') as CanvasRenderingContext2D;
        const elementsCtx = this.timelineElementsCanvas.getContext('2d') as CanvasRenderingContext2D;
        this.studioControlsContainer.removeAttribute('hidden');
        this.timeline = new Timeline(markersCtx, elementsCtx, Timeline.DEFAULT_LENGTH_MS);
        this.timeline.draw();
        document.addEventListener('mousemove', (e: MouseEvent) => {
            // Only need to update if the primary mouse button is pressed while moving.
            if (e.buttons === 1) {
                this.timeline.onMouseMove(e);
                this.playheadTimePositionInput.value = this.timeline.getPlayheadTimeSeconds();
            }
        });
        this.timelineElementsCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            this.timeline.onMouseDown(e);
        });
        document.addEventListener('mouseup', (e: MouseEvent) => {
            this.timeline.onMouseUp(e);
        })
    }

    private scratchVecPos: vec3 = vec3.create();
    private scratchVecLook: vec3 = vec3.create();
    private scratchVecZAxis: vec3 = vec3.create();

    private addKeyframesFromMat4(worldMatrix: mat4, time: number, tracks: number) {
        mat4.getTranslation(this.scratchVecPos, worldMatrix);
        getMatrixAxisZ(this.scratchVecZAxis, worldMatrix);
        vec3.normalize(this.scratchVecZAxis, this.scratchVecZAxis);
        vec3.scaleAndAdd(this.scratchVecLook, this.scratchVecPos, this.scratchVecZAxis, -100);

        const posXKf: Keyframe = { time: time, value: this.scratchVecPos[0], tangentIn: 0, tangentOut: 0 };
        const posYKf: Keyframe = { time: time, value: this.scratchVecPos[1], tangentIn: 0, tangentOut: 0 };
        const posZKf: Keyframe = { time: time, value: this.scratchVecPos[2], tangentIn: 0, tangentOut: 0 };
        const lookAtXKf: Keyframe = { time: time, value: this.scratchVecLook[0], tangentIn: 0, tangentOut: 0 };
        const lookAtYKf: Keyframe = { time: time, value: this.scratchVecLook[1], tangentIn: 0, tangentOut: 0 };
        const lookAtZKf: Keyframe = { time: time, value: this.scratchVecLook[2], tangentIn: 0, tangentOut: 0 };

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
        const bankKf: Keyframe = { time: time, value: bank, tangentIn: 0, tangentOut: 0 };

        if (tracks & KeyframeTrackEnum.posXTrack)
            this.animation.posXTrack.addKeyframe(posXKf);
        if (tracks & KeyframeTrackEnum.posYTrack)
            this.animation.posYTrack.addKeyframe(posYKf);
        if (tracks & KeyframeTrackEnum.posZTrack)
            this.animation.posZTrack.addKeyframe(posZKf);
        if (tracks & KeyframeTrackEnum.lookAtXTrack)
            this.animation.lookAtXTrack.addKeyframe(lookAtXKf);
        if (tracks & KeyframeTrackEnum.lookAtYTrack)
            this.animation.lookAtYTrack.addKeyframe(lookAtYKf);
        if (tracks & KeyframeTrackEnum.lookAtZTrack)
            this.animation.lookAtZTrack.addKeyframe(lookAtZKf);
        if (tracks & KeyframeTrackEnum.bankTrack)
            this.animation.bankTrack.addKeyframe(bankKf);

        switch (this.timelineMode) {
            case TimelineMode.Consolidated:
                // One keyframe icon for all keyframes.
                this.timeline.addKeyframeIcon([posXKf, posYKf, posZKf, lookAtXKf, lookAtYKf, lookAtZKf, bankKf], time, Timeline.KEYFRAME_ICONS_BASE_Y_POS);
                break;
            case TimelineMode.Position_LookAt_Bank:
                // icon for pos xyz, icon for lookAt xyz, icon for bank, minus deselected tracks
                if (tracks & KeyframeTrackEnum.posXTrack)
                    this.timeline.addKeyframeIcon([posXKf, posYKf, posZKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.posXTrack));
                if (tracks & KeyframeTrackEnum.lookAtXTrack)
                    this.timeline.addKeyframeIcon([lookAtXKf, lookAtYKf, lookAtZKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.lookAtXTrack));
                if (tracks & KeyframeTrackEnum.bankTrack)
                    this.timeline.addKeyframeIcon([bankKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.bankTrack));
                break;
            case TimelineMode.Full:
                // icon for each track, minus deselected tracks
                if (tracks & KeyframeTrackEnum.posXTrack)
                    this.timeline.addKeyframeIcon([posXKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.posXTrack));
                if (tracks & KeyframeTrackEnum.posYTrack)
                    this.timeline.addKeyframeIcon([posYKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.posYTrack));
                if (tracks & KeyframeTrackEnum.posZTrack)
                    this.timeline.addKeyframeIcon([posZKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.posZTrack));
                if (tracks & KeyframeTrackEnum.lookAtXTrack)
                    this.timeline.addKeyframeIcon([lookAtXKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.lookAtXTrack));
                if (tracks & KeyframeTrackEnum.lookAtYTrack)
                    this.timeline.addKeyframeIcon([lookAtYKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.lookAtYTrack));
                if (tracks & KeyframeTrackEnum.lookAtZTrack)
                    this.timeline.addKeyframeIcon([lookAtZKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.lookAtZTrack));
                if (tracks & KeyframeTrackEnum.bankTrack)
                    this.timeline.addKeyframeIcon([bankKf], time, this.getKeyframeYPosByTrack(KeyframeTrackEnum.bankTrack));
                break;
        }

        this.timeline.draw();
    }

    private getKeyframeYPosByTrack(track: KeyframeTrackEnum): number {
        return Timeline.KEYFRAME_ICONS_BASE_Y_POS + (Math.log2(track) * Timeline.TRACK_HEIGHT);
    }

    private newAnimation(): void {
        // TODO
        this.animation = {
            posXTrack: new KeyframeTrack([]),
            posYTrack: new KeyframeTrack([]),
            posZTrack: new KeyframeTrack([]),
            lookAtXTrack: new KeyframeTrack([]),
            lookAtYTrack: new KeyframeTrack([]),
            lookAtZTrack: new KeyframeTrack([]),
            bankTrack: new KeyframeTrack([])
        }
        this.selectedTracks |= KeyframeTrackEnum.allTracks;
        this.studioControlsContainer.setAttribute('hidden', '');
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.resetHelpText();
    }

    private navigateKeyframes(amount: number): void {
        // TODO
    }

    private displayHelpText(elem: HTMLElement) {
        if (!this.editingKeyframePosition && !this.persistHelpText)
            this.studioHelpText.innerText = elem.dataset.helpText ? elem.dataset.helpText : this.studioHelpText.dataset.default as string;
    }

    private resetHelpText() {
        if (!this.editingKeyframePosition && !this.persistHelpText)
            this.studioHelpText.innerText = this.studioHelpText.dataset.default as string;
    }

    private errorHelpText(e: string) {
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

    private handleNewKeyframeEvent(e: CustomEvent) {
        // TODO
    }

    /**
     * Called when a keyframe in the keyframe list is clicked.
     */
    private selectKeyframeListItem(e: MouseEvent) {
        // TODO
        this.keyframeControls.removeAttribute('hidden');
    }

    private loadAnimation() {
        const jsonAnim = window.localStorage.getItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId());
        if (jsonAnim) {
            const storedAnimation: any = JSON.parse(jsonAnim);
            if (this.isAnimation(storedAnimation)) {
                this.animation = storedAnimation;
            } else {
                // Unlikely, but better not to keep garbage data saved.
                console.error('Animation saved in localStorage is invalid and will be deleted. Existing animation JSON: ', jsonAnim);
                window.localStorage.removeItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId());
                this.errorHelpText('Saved animation invalid. See console for details.');
            }
        }
    }

    private isAnimation(storedAnimation: any): Boolean {
        // TODO
        throw new Error('Method not implemented.');
    }

    private serializeAnimation(): string {
        const dataObj = { version: 2, animation: this.animation };
        return JSON.stringify(dataObj);
    }

    private saveAnimation() {
        const jsonAnim: string = this.serializeAnimation();
        window.localStorage.setItem('studio-animation-' + GlobalSaveManager.getCurrentSceneDescId(), jsonAnim);
    }

    private exportAnimation() {
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
                const loadedAnimation = JSON.parse(fileContents);
                if (this.isAnimation(loadedAnimation)) {
                    this.animation = loadedAnimation;
                } else {
                    throw new Error('File is not a valid animation.');
                }
            } catch (e) {
                console.error('Failed to load animation from JSON file.', e);
                this.errorHelpText('Failed to load file. See console for details.');
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