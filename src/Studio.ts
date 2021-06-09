
import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { Keyframe, CameraAnimationManager, CameraAnimation, InterpolationStep, KeyframeTrack } from './CameraAnimationManager';
import { StudioCameraController } from './Camera';
import { clamp, computeEulerAngleRotationFromSRTMatrix, getMatrixAxisZ, Vec3UnitY, Vec3Zero } from './MathHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { GlobalSaveManager } from './SaveManager';

const CLAPBOARD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="20" fill="white"><path d="M61,22H14.51l3.41-.72h0l7.74-1.64,2-.43h0l6.85-1.46h0l1.17-.25,8.61-1.83h0l.78-.17,9-1.91h0l.4-.08L60,12.33a1,1,0,0,0,.77-1.19L59.3,4.3a1,1,0,0,0-1.19-.77l-19,4-1.56.33h0L28.91,9.74,27.79,10h0l-9.11,1.94-.67.14h0L3.34,15.17a1,1,0,0,0-.77,1.19L4,23.11V60a1,1,0,0,0,1,1H61a1,1,0,0,0,1-1V23A1,1,0,0,0,61,22ZM57,5.8l.65.6.89,4.19-1.45.31L52.6,6.75ZM47.27,7.88,51.8,12,47.36,13,42.82,8.83ZM37.48,10,42,14.11l-4.44.94L33,10.91ZM27.7,12l4.53,4.15-4.44.94L23.26,13Zm-9.78,2.08,4.53,4.15L18,19.21l-4.53-4.15ZM19.49,29H14.94l3.57-5h4.54Zm9-5h4.54l-3.57,5H24.94ZM39,45.88l-11,6A1,1,0,0,1,26.5,51V39A1,1,0,0,1,28,38.12l11,6a1,1,0,0,1,0,1.76ZM39.49,29H34.94l3.57-5h4.54Zm10,0H44.94l3.57-5h4.54ZM60,29H54.94l3.57-5H60Z"/></svg>`;
const POPOUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -5 100 100" height="20" fill="white"><g><polygon points="65.1 17.2 77.1 17.2 41.2 53.1 46.9 58.8 82.8 22.9 82.8 34.9 90.8 34.9 90.8 9.2 65.1 9.2 65.1 17.2"/><polygon points="80.6 46.5 72.6 46.5 72.6 82.8 17.2 82.8 17.2 27.4 53.5 27.4 53.5 19.4 9.2 19.4 9.2 90.8 80.6 90.8 80.6 46.5"/></g></svg>`
const MILLISECONDS_IN_SECOND = 1000.0;

const enum KeyframeTrackSelection {
    posXTrack = 0b0000001,
    posYTrack = 0b0000010,
    posZTrack = 0b0000100,
    lookatXTrack = 0b0001000,
    lookatYTrack = 0b0010000,
    lookatZTrack = 0b0100000,
    bankTrack = 0b1000000,
    allTracks = 0b1111111
}

const enum TimelineMode {
    Consolidated,
    Position_Perspective_Bank,
    Full
}

class Playhead {
    static readonly WIDTH: number = 15;
    static readonly HEIGHT: number = 15;
    static readonly POINTER_HEIGHT: number = 10;
    static readonly COLOR: string = '#FF0000'

    constructor(init?: Partial<Playhead>) {
        Object.assign(this, init);
        this.updatePath();
    }
    private x: number = 0;
    private timeMs: number;
    public playheadPath: Path2D;
    private updatePath() {
        this.playheadPath = new Path2D();
        this.playheadPath.moveTo(this.x, 0);
        this.playheadPath.lineTo(this.x + Playhead.WIDTH, 0);
        this.playheadPath.lineTo(this.x + Playhead.WIDTH, Playhead.HEIGHT);
        this.playheadPath.lineTo(this.x + (Playhead.WIDTH / 2), Playhead.HEIGHT + Playhead.POINTER_HEIGHT);
        this.playheadPath.lineTo(this.x, Playhead.HEIGHT);
        this.playheadPath.lineTo(this.x, 0);
    }
    public draw(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.fillStyle = Playhead.COLOR;
        ctx.fill(this.playheadPath);
    };
    public drawLine(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.strokeStyle = Playhead.COLOR;
        ctx.lineWidth = 1.5;
        ctx.moveTo(this.x + (Playhead.WIDTH / 2), Playhead.HEIGHT + Playhead.POINTER_HEIGHT - 1);
        ctx.lineTo(this.x + (Playhead.WIDTH / 2), 85);
        ctx.stroke();
    };
    public updatePosition(x: number, t: number) {
        this.x = x - (Playhead.WIDTH / 2);
        this.timeMs = t;
        this.updatePath();
    }

    /**
     * Returns the x coordinate of the center of the playhead, used for calculating collisions with the playhead line.
     * */ 
    public getLineX(): number {
        return this.x + (Playhead.WIDTH / 2);
    }
}

class KeyframeIcon {
    static readonly SIDE_LENGTH: number = 10;
    static readonly DIAGONAL_LENGTH = Math.sqrt(KeyframeIcon.SIDE_LENGTH * KeyframeIcon.SIDE_LENGTH * 2);
    static readonly COLOR: string = '#FFFFFF';
    static readonly SELECTED_COLOR: string = '#FF500B';
    static readonly ENDFRAME_COLOR: string = '#4EB0FF';

    constructor(public keyframe: Keyframe, public x: number, public y: number) {
        this.iconPath.rect(this.x, this.y, KeyframeIcon.SIDE_LENGTH, KeyframeIcon.SIDE_LENGTH);
    }
    public iconPath = new Path2D();
    public selected: boolean = false;
    public isEndFrame: boolean;
    public draw(ctx: CanvasRenderingContext2D) {
        // Draw keyframe icons
        ctx.save();
        const centerX = this.x + KeyframeIcon.SIDE_LENGTH * 0.5;
        const centerY = this.y + KeyframeIcon.SIDE_LENGTH * 0.5;
        ctx.translate(centerX, centerY);
        ctx.rotate(Math.PI / 4);
        ctx.translate(-centerX, -centerY);
        if (this.isEndFrame)
            ctx.fillStyle = KeyframeIcon.ENDFRAME_COLOR;
        else if (this.selected)
            ctx.fillStyle = KeyframeIcon.SELECTED_COLOR;
        else
            ctx.fillStyle = KeyframeIcon.COLOR;
        ctx.fill(this.iconPath);
        ctx.restore();
    }
    public updatePosition(x: number) {
        this.x = x;
        this.iconPath = new Path2D();
        this.iconPath.rect(this.x, this.y, KeyframeIcon.SIDE_LENGTH, KeyframeIcon.SIDE_LENGTH);
    }
}

class Timeline {
    static readonly DEFAULT_LENGTH_MS = 30000;
    static readonly MAX_MARKER_WIDTH_PX: number = 50;
    static readonly MARKER_COLOR: string = '#f3f3f3';
    static readonly DEFAULT_SECONDS_PER_MARKER: number = 5;
    static readonly SNAP_DISTANCE_PX: number = 3;
    static readonly HEADER_HEIGHT: number = 25;
    static readonly TRACK_HEIGHT: number = 25;

    constructor(private markersCtx: CanvasRenderingContext2D, private elementsCtx: CanvasRenderingContext2D, timelineLengthMs: number) {
        this.playhead = new Playhead();
        this.keyframeIconBaseYPos = Timeline.HEADER_HEIGHT + ((Timeline.TRACK_HEIGHT - KeyframeIcon.DIAGONAL_LENGTH) * 0.5);
        this.setScaleAndDrawMarkers(timelineLengthMs);
    }

    private width: number;
    private height: number;
    private keyframeIconBaseYPos: number;
    private playhead: Playhead;
    private keyframeIcons: KeyframeIcon[] = [];
    private selectedKeyframeIcons: KeyframeIcon[] = [];
    private pixelsPerSecond: number;
    private playheadGrabbed: boolean = false;
    private keyframeIconGrabbed: boolean = false;
    private snappingEnabled: boolean = false;

    public setScaleAndDrawMarkers(timelineLengthMs: number) {
        this.width = this.elementsCtx.canvas.width;
        this.height = this.elementsCtx.canvas.height;
        this.markersCtx.translate(Playhead.WIDTH / 2, 0);
        this.markersCtx.strokeStyle = Timeline.MARKER_COLOR;
        this.markersCtx.fillStyle = Timeline.MARKER_COLOR;
        this.markersCtx.clearRect(0, 0, this.width, Timeline.HEADER_HEIGHT);
        let secondsPerMarker = Timeline.DEFAULT_SECONDS_PER_MARKER;
        let markerCount = (timelineLengthMs / MILLISECONDS_IN_SECOND) / secondsPerMarker;
        this.pixelsPerSecond = (this.width / markerCount) / (secondsPerMarker);
        if (this.width / markerCount < Timeline.MAX_MARKER_WIDTH_PX) {
            markerCount = this.width / Timeline.MAX_MARKER_WIDTH_PX;
            secondsPerMarker = timelineLengthMs / markerCount;
            this.pixelsPerSecond *= secondsPerMarker / Timeline.DEFAULT_SECONDS_PER_MARKER * MILLISECONDS_IN_SECOND;
        }

        const totalMarkers = markerCount * 5;

        this.markersCtx.beginPath();
        let x = 0;
        let labelSize = null;
        const halfMarkerHeight = Timeline.HEADER_HEIGHT / 1.5;
        const markerHeight = Timeline.HEADER_HEIGHT / 2;
        const labelHeight = markerHeight - 3;
        for (let i = 0; i < totalMarkers; i++) {
            x = i * this.pixelsPerSecond;
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
    }

    public draw() {
        this.elementsCtx.clearRect(0, 0, this.width, this.height);
        this.playhead.draw(this.elementsCtx);
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            this.keyframeIcons[i].draw(this.elementsCtx);
        }
        this.playhead.drawLine(this.elementsCtx);
    }
    public addKeyframeIcon(kf: Keyframe, t: number, track: KeyframeTrackSelection) {
        const xPos = (t / MILLISECONDS_IN_SECOND) * this.pixelsPerSecond;
        const yPos = this.keyframeIconBaseYPos + (Math.log2(track) * Timeline.TRACK_HEIGHT);
        const kfIcon = new KeyframeIcon(kf, xPos, yPos);
        this.keyframeIcons.push(kfIcon);
    }
    public addEndFrameIcons(t: number) {

    }
    public onMouseDown(e: MouseEvent) {
        e.stopPropagation();
        // Click landed on playhead
        if (this.elementsCtx.isPointInPath(this.playhead.playheadPath, e.offsetX, e.offsetY)) {
            this.playheadGrabbed = true;
            // TODO this is probably not the correct time value
            this.playhead.updatePosition(e.offsetX, e.offsetX * this.pixelsPerSecond);
            this.draw();
            return;
        }
        // Check if click landed on a currently-selected keyframe
        let selectedIconClicked = false;
        for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
            if (this.elementsCtx.isPointInPath(this.selectedKeyframeIcons[i].iconPath, e.offsetX, e.offsetY)) {
                selectedIconClicked = true;
                break;
            }
        }
        // Click did not land on playhead or any selected keyframe icon. Deselect all selected keyframes.
        if (!selectedIconClicked && this.selectedKeyframeIcons.length) {
            for (let i = 0; i < this.selectedKeyframeIcons.length; i++) {
                this.selectedKeyframeIcons[i].selected = false;
            }
            this.selectedKeyframeIcons = [];
        }
        // Check if click landed on a keyframe icon.
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            if (this.elementsCtx.isPointInPath(this.keyframeIcons[i].iconPath, e.offsetX, e.offsetY)) {
                this.keyframeIcons[i].selected = true;
                this.selectedKeyframeIcons.push(this.keyframeIcons[i]);
                this.keyframeIconGrabbed = true;
                break;
            }
        }
    }
    public onMouseUp(e: MouseEvent) {
        this.playheadGrabbed = false;
        this.keyframeIconGrabbed = false;
    }
    public onMouseMove(e: MouseEvent) {
        if (!this.playheadGrabbed && !this.keyframeIconGrabbed)
            return;
        if (this.playheadGrabbed) {
            if (this.snappingEnabled) {
                const snapKfIndex = this.getClosestSnappingIconIndex(e.offsetX);
                if (snapKfIndex > -1)
                    this.playhead.updatePosition(this.keyframeIcons[snapKfIndex].x, this.keyframeIcons[snapKfIndex].x * this.pixelsPerSecond);
            } else {
                // TODO clamp x to within timeline bounds
                this.playhead.updatePosition(e.offsetX, e.offsetX * this.pixelsPerSecond);
            }
            this.draw();
        }
        if (this.keyframeIconGrabbed) {
            if (this.snappingEnabled && Math.abs(e.offsetX - this.playhead.getLineX()) < Timeline.SNAP_DISTANCE_PX)
                this.updateSelectedKeyframeIconPositions(this.playhead.getLineX());
            else
                this.updateSelectedKeyframeIconPositions(e.offsetX);
        }
    }

    private updateSelectedKeyframeIconPositions(x: number) {

    }

    private getClosestSnappingIconIndex(x: number): number {
        let closestDist = Timeline.SNAP_DISTANCE_PX;
        let snapKfIndex = -1;
        for (let i = 0; i < this.keyframeIcons.length && closestDist > 0; i++) {
            const dist = Math.abs(x - this.keyframeIcons[i].x);
            if (dist < closestDist) {
                i = snapKfIndex;
                closestDist = dist;
            }
        }
        return snapKfIndex;
    }

    public playheadTimeMs(): number {
        return this.playhead.getLineX() * this.pixelsPerSecond * MILLISECONDS_IN_SECOND;
    }
}


export class StudioPanel extends FloatingPanel {
    private animationManager: CameraAnimationManager;
    private studioCameraController: StudioCameraController;

    private animation: CameraAnimation;
    private timelineMarkersCanvas: HTMLCanvasElement;
    private timelineElementsCanvas: HTMLCanvasElement;
    public totalKeyframes(): number {
        if (!this.animation)
            return 0;
        else
            return this.animation.posXTrack.keyframes.length 
            + this.animation.posYTrack.keyframes.length 
            + this.animation.posZTrack.keyframes.length 
            + this.animation.lookatXTrack.keyframes.length 
            + this.animation.lookatYTrack.keyframes.length 
            + this.animation.lookatZTrack.keyframes.length 
            + this.animation.bankTrack.keyframes.length;
    }
    public animationPreviewSteps: InterpolationStep[];
    private enableStudioBtn: HTMLElement;
    private disableStudioBtn: HTMLElement;

    private panelCssString: string;

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

    private timelineLengthInput: HTMLInputElement;

    private editKeyframePositionBtn: HTMLElement;
    private editingKeyframePosition: boolean = false;
    private persistHelpText: boolean = false;

    private timeline: Timeline;
    private timelineMode: TimelineMode = TimelineMode.Consolidated;
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
        this.setWidth(650);
        this.contents.style.maxHeight = '';
        this.contents.style.overflow = '';
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.8';
        };
        this.elem.style.opacity = '0.8';
        this.setTitle(CLAPBOARD_ICON, 'Studio');
        document.head.insertAdjacentHTML('beforeend', `
        <style>
            button.SettingsButton {
                font: 16px monospace;
                font-weight: bold;
                border: none;
                width: 100%;
                color: inherit;
                padding: 0.15rem;
                text-align: center;
                background-color: rgb(64, 64, 64);
                cursor: pointer;
            }
        </style>
        `);
        this.contents.insertAdjacentHTML('beforeend', `
        <div style="display: grid; grid-template-columns: 3fr 1fr 1fr; align-items: center;">
            <div class="SettingsHeader">Studio Mode</div>
            <button id="enableStudioBtn" class="SettingsButton EnableStudioMode">Enable</button>
            <button id="disableStudioBtn" class="SettingsButton DisableStudioMode">Disable</button>
        </div>
        <div id="studioPanelContents" hidden></div>
        `);
        this.contents.style.lineHeight = '36px';
        this.enableStudioBtn = this.contents.querySelector('#enableStudioBtn') as HTMLInputElement;
        this.disableStudioBtn = this.contents.querySelector('#disableStudioBtn') as HTMLInputElement;
        this.studioPanelContents = this.contents.querySelector('#studioPanelContents') as HTMLElement;

        // A listener to give focus to the canvas whenever it's clicked, even if the panel is still up.
        const keepFocus = function (e: MouseEvent) {
            if (e.target === viewer.canvas)
                document.body.focus();
        }

        this.enableStudioBtn.onclick = () => {
            if (!ui.studioModeEnabled) {
                // Switch to the FPS Camera Controller.
                ui.viewerSettings.setCameraControllerIndex(0);
                // Disable switching of camera controllers in studio mode.
                ui.viewerSettings.contents.querySelectorAll('.SettingsButton').forEach(el => {
                    el.classList.add('disabled');
                });
                // If this is the first time Studio Mode is being enabled, we need to initialize things.
                if (!this.studioPanelContents.children.length) {
                    this.initStudio();
                }
                this.viewer.setCameraController(this.studioCameraController);
                this.studioPanelContents.removeAttribute('hidden');
                document.addEventListener('mousedown', keepFocus);
                ui.studioModeEnabled = true;
                setElementHighlighted(this.enableStudioBtn, true);
                setElementHighlighted(this.disableStudioBtn, false);

                // If there's an existing animation for the current map, load it automatically.
                this.loadAnimation();
            }
        }
        this.disableStudioBtn.onclick = () => {
            if (ui.studioModeEnabled) {
                ui.studioModeEnabled = false;
                // Re-enable camera controller switching.
                ui.viewerSettings.contents.querySelectorAll('.SettingsButton').forEach(el => {
                    el.classList.remove('disabled');
                });
                // Switch back to the FPS Camera Controller.
                ui.viewerSettings.setCameraControllerIndex(0);
                this.studioPanelContents.setAttribute('hidden', '');
                document.removeEventListener('mousedown', keepFocus);
                setElementHighlighted(this.disableStudioBtn, true);
                setElementHighlighted(this.enableStudioBtn, false);
            }
        };
        setElementHighlighted(this.disableStudioBtn, true);
        setElementHighlighted(this.enableStudioBtn, false);

    }

    public v(): void {
        this.elem.style.display = '';
    }

    private initStudio(): void {
        // Add Studio Mode-specific CSS.
        document.head.insertAdjacentHTML('beforeend', `
        <style>
            #studioDataBtn {
                width: 40%;
                display: block;
                margin: 0 auto 0.25rem;
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
            #timelineContainerDiv {
                position: relative;
                height: 50px;
            }
            #timelineContainerDiv > canvas {
                position: absolute;
            }
            #timelineHeaderBg {
                position: absolute;
                width: 100%;
                height: 25px;
                background: linear-gradient(#494949, #2f2f2f);
                z-index: 2;
            }
            #timelineTracksBg {
                position: absolute;
                width: 100%;
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
                color: white;
                font-weight: bold;
                font: 16px monospace;
                border: 1px solid #444444;
            }
            .KeyframeSettingsName {
                margin-top: 0.5rem;
                margin-bottom: 0.25rem;
            }
            .KeyframeNumericInput {
                width: 4rem;
                background: black;
                color: #fefefe;
                font: 16px monospace;
                height: 1.5rem;
                border-radius: 5px;
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
        `);
        this.studioPanelContents.insertAdjacentHTML('afterbegin', `
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
            <div style="display: flex;margin: 0 25px 5px;align-items: center;justify-content: flex-end;">
                <input id="playheadTimePositionInput" class="KeyframeNumericInput" type="number" min="1" max="300" step="0.1">
                <span>/</span>
                <input id="timelineLengthInput" class="KeyframeNumericInput" type="number" min="1" max="300" step="0.1">
                <span>s</span>
            </div>
            <div id="timelineContainerDiv" style="margin: 0 25px;">
                <div id="timelineHeaderBg"></div>
                <div id="timelineTracksBg"></div>
                <canvas id="timelineMarkersCanvas" width="600" height="45"></canvas>
                <canvas id="timelineElementsCanvas" width="600" height="45"></canvas>
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
        </div>`);
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

        this.timelineMarkersCanvas = this.contents.querySelector('#timelineMarkersCanvas') as HTMLCanvasElement;
        this.timelineElementsCanvas = this.contents.querySelector('#timelineElementsCanvas') as HTMLCanvasElement;

        const MIN_ANIMATION_LENGTH = 1;
        const MAX_ANIMATION_LENGTH = 300;
        this.timelineLengthInput = this.contents.querySelector('#timelineLengthInput') as HTMLInputElement;
        let currentTimelineLengthMs = parseFloat(this.timelineLengthInput.value);
        this.timelineLengthInput.onchange = () => {
            let lengthVal = parseFloat(this.timelineLengthInput.value)
            if (Number.isNaN(lengthVal)) {
                this.timelineLengthInput.value = currentTimelineLengthMs.toString();
                return;
            } else {
                clamp(lengthVal, MIN_ANIMATION_LENGTH, MAX_ANIMATION_LENGTH);
            }

            currentTimelineLengthMs = lengthVal * MILLISECONDS_IN_SECOND;
            this.timeline.setScaleAndDrawMarkers(currentTimelineLengthMs);
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

        this.animationManager = new CameraAnimationManager();
        this.studioCameraController = new StudioCameraController(this.animationManager, this);

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
            this.popOutWindow.document.head.insertAdjacentHTML('afterbegin', `
            <style>
                #studioHelpText {
                    line-height:1.5;
                    padding: 0 1rem 0.5rem 1rem;
                    min-height:3rem;
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
                    color: white;
                    font-weight: bold;
                    font: 16px monospace;
                    border: 1px solid #444444;
                }
                .KeyframeSettingsName {
                    margin-top: 0.5rem;
                    margin-bottom: 0.25rem;
                }
                .KeyframeNumericInput {
                    width: 4rem;
                }
                #studioControlsContainer .disabled,
                .SettingsButton.disabled {
                    cursor: not-allowed!important;
                }
                #playbackControls {
                    padding: 0 5rem 1rem;
                    border-top: 1px solid #444;
                }
            </style>
            `);
            this.popOutWindow.document.documentElement.insertAdjacentHTML('afterbegin', this.elem.innerHTML);
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
    }

    onAnimationStopped() {
        throw new Error('Method not implemented.');
    }

    endEditKeyframePosition() {
        throw new Error('Method not implemented.');
    }

    private selectedTracks: number = KeyframeTrackSelection.allTracks;
    private playheadTimeMs: number = 0;

    addKeyframe(worldMatrix: mat4) {
        if (this.totalKeyframes() === 0)
            this.initTimeline();
        this.addKeyframesFromMat4(worldMatrix, this.playheadTimeMs, this.selectedTracks);
    }

    private initTimeline() {
        const markersCtx = this.timelineMarkersCanvas.getContext('2d');
        const elementsCtx = this.timelineElementsCanvas.getContext('2d');
        if (!markersCtx || !elementsCtx) {
            throw new Error("One or more of the drawing contexts failed to load.");
        }
        this.studioControlsContainer.removeAttribute('hidden');
        this.timeline = new Timeline(markersCtx, elementsCtx, Timeline.DEFAULT_LENGTH_MS);
        this.timeline.draw();
        this.timelineElementsCanvas.addEventListener('mousemove', (e: MouseEvent) => {
            this.timeline.onMouseMove(e);
        });
        this.timelineElementsCanvas.addEventListener('mousedown', (e: MouseEvent) => {
            this.timeline.onMouseDown(e);
        });
        this.timelineElementsCanvas.addEventListener('mouseup', (e:MouseEvent) => {
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

        if (tracks & KeyframeTrackSelection.posXTrack) {
            const posXKf: Keyframe = { time: time, value: this.scratchVecPos[0], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(posXKf, time, KeyframeTrackSelection.posXTrack);;
            this.animation.posXTrack.addKeyframe(posXKf);
        }
        if (tracks & KeyframeTrackSelection.posYTrack) {
            const posYKf: Keyframe = { time: time, value: this.scratchVecPos[1], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(posYKf, time, KeyframeTrackSelection.posYTrack);
            this.animation.posYTrack.addKeyframe(posYKf);
        }
        if (tracks & KeyframeTrackSelection.posZTrack) {
            const posZKf: Keyframe = { time: time, value: this.scratchVecPos[2], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(posZKf, time, KeyframeTrackSelection.posZTrack);
            this.animation.posZTrack.addKeyframe(posZKf);
        }
        if (tracks & KeyframeTrackSelection.lookatXTrack) {
            const lookatXKf: Keyframe = { time: time, value: this.scratchVecLook[0], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(lookatXKf, time, KeyframeTrackSelection.lookatXTrack);
            this.animation.lookatXTrack.addKeyframe(lookatXKf);
        }
        if (tracks & KeyframeTrackSelection.lookatYTrack) {
            const lookatYKf: Keyframe = { time: time, value: this.scratchVecLook[1], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(lookatYKf, time, KeyframeTrackSelection.lookatYTrack);
            this.animation.lookatYTrack.addKeyframe(lookatYKf);
        }
        if (tracks & KeyframeTrackSelection.lookatZTrack) {
            const lookatZKf: Keyframe = { time: time, value: this.scratchVecLook[2], tangentIn: 0, tangentOut: 0 };
            this.timeline.addKeyframeIcon(lookatZKf, time, KeyframeTrackSelection.lookatZTrack);
            this.animation.lookatZTrack.addKeyframe(lookatZKf);
        }

        // Get bank rotation
        if (tracks & KeyframeTrackSelection.bankTrack) {
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
            this.timeline.addKeyframeIcon(bankKf, time, KeyframeTrackSelection.bankTrack);
            this.animation.bankTrack.addKeyframe(bankKf);
        }
    }

    private newAnimation(): void {
        // TODO
        this.animation = {
            posXTrack: new KeyframeTrack([]),
            posYTrack: new KeyframeTrack([]),
            posZTrack: new KeyframeTrack([]),
            lookatXTrack: new KeyframeTrack([]),
            lookatYTrack: new KeyframeTrack([]),
            lookatZTrack: new KeyframeTrack([]),
            bankTrack: new KeyframeTrack([])
        }
        this.selectedTracks |= KeyframeTrackSelection.allTracks;
        this.playheadTimeMs = 0;
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