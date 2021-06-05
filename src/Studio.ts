
import * as Viewer from './viewer';
import { UI, Checkbox, setElementHighlighted, createDOMFromString } from './ui';
import { FloatingPanel } from './DebugFloaters';
import { Keyframe, CameraAnimationManager, CameraAnimation, InterpolationStep } from './CameraAnimationManager';
import { Camera, StudioCameraController } from './Camera';
import { clamp } from './MathHelpers';
import { mat4 } from 'gl-matrix';
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
    constructor(init?: Partial<Playhead>) {
        Object.assign(this, init);
    }
    public width: number;
    public height: number;
    public pointerHeight: number;
    public x: number;
    public color: string;
    public draw(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.fillStyle = this.color;
        ctx.moveTo(this.x, 0);
        ctx.lineTo(this.x + this.width, 0);
        ctx.lineTo(this.x + this.width, this.height);
        ctx.lineTo(this.x + (this.width / 2), this.height + this.pointerHeight);
        ctx.lineTo(this.x, this.height);
        ctx.lineTo(this.x, 0);
        ctx.fill();
    };
    public drawLine(ctx: CanvasRenderingContext2D) {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.x + (this.width / 2), this.height + this.pointerHeight - 1);
        ctx.lineTo(this.x + (this.width / 2), 85);
        ctx.stroke();
    };
}

class KeyframeIcon {
    public sideLength: number;
    public selected: boolean;
    public color: string;
    public selectedColor: string;
    public x: number;
    public y: number;
    public keyframe: Keyframe;
    public draw(ctx: CanvasRenderingContext2D) {
        // Draw keyframe icons
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.PI / 4);
        ctx.translate(-this.x, -this.y);
        ctx.fillStyle = this.selected ? this.selectedColor : this.color;
        ctx.fillRect(3.75, 31, this.sideLength, this.sideLength);
        ctx.restore();
    }
}

class Timeline {
    readonly MAX_MARKER_WIDTH_PX = 50;
    readonly DEFAULT_SECONDS_PER_MARKER = 5;

    constructor(private markersCtx: CanvasRenderingContext2D, private elementsCtx: CanvasRenderingContext2D) {
        this.playhead = new Playhead({
            width: 15,
            height: 15,
            pointerHeight: 10,
            x: 0,
            color: '#FF0000',
        });
        this.markersCtx.translate(this.playhead.width / 2, 0);
        this.markersCtx.strokeStyle = '#f3f3f3';
        this.markersCtx.fillStyle = '#f3f3f3';
    }
    public width: number;
    public height: number;
    public headerHeight: number;
    public trackHeight: number;
    public playhead: Playhead;
    public keyframeIcons: KeyframeIcon[]
    public setScale(animationLength: number) {
        this.markersCtx.clearRect(0, 0, this.width, this.headerHeight);
        let msPerMarker = this.DEFAULT_SECONDS_PER_MARKER * MILLISECONDS_IN_SECOND;
        let markerCount = animationLength / msPerMarker;
        let pixelsPerSecond = (this.width / markerCount) / msPerMarker;
        if (this.width / markerCount < this.MAX_MARKER_WIDTH_PX) {
            markerCount = this.width / this.MAX_MARKER_WIDTH_PX;
            msPerMarker = animationLength / markerCount;
            pixelsPerSecond *= msPerMarker / this.DEFAULT_SECONDS_PER_MARKER * MILLISECONDS_IN_SECOND;
        }

        const totalMarkers = markerCount * 5;

        this.markersCtx.beginPath();
        let x = 0;
        let labelSize = null;
        const halfMarkerHeight = this.headerHeight / 1.5;
        const markerHeight = this.headerHeight / 2;
        const labelHeight = markerHeight - 3;
        for (let i = 0; i < totalMarkers; i++) {
            x = i * pixelsPerSecond;
            this.markersCtx.moveTo(x, this.headerHeight);
            if (i % 5 === 0) {
                this.markersCtx.lineTo(x, markerHeight);
                const label = (Math.trunc((i / 5) * msPerMarker)).toString();
                labelSize = this.markersCtx.measureText(label);
                this.markersCtx.fillText(label, x - (labelSize.width / 2), labelHeight);
            } else {
                this.markersCtx.lineTo(x, halfMarkerHeight);
            }
        }
        this.markersCtx.stroke();
    }
    public draw() {
        this.playhead.draw(this.elementsCtx);
        for (let i = 0; i < this.keyframeIcons.length; i++) {
            this.keyframeIcons[i].draw(this.elementsCtx);
        }
        this.playhead.drawLine(this.elementsCtx);
    }
}


export class StudioPanel extends FloatingPanel {
    private animationManager: CameraAnimationManager;
    private studioCameraController: StudioCameraController;

    private animation: CameraAnimation;
    private totalKeyframes: number = 0;
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

    private animationLengthInput: HTMLInputElement;

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
                top: 25px;
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
            <div id="animationDurationContainer">
                <div class="SettingsHeader KeyframeSettingsName">Animation Length</div>
                <div style="display:flex; align-items:center; justify-content:space-evenly">
                    <input id="animationLengthInput" class="KeyframeNumericInput" type="number" min="1" max="300" step="0.1"/> <span>s</span>
                </div>
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

        const timelineMarkersCanvas = this.contents.querySelector('#timelineMarkersCanvas') as HTMLCanvasElement;
        const markersCtx = timelineMarkersCanvas.getContext('2d');
        const timelineElementsCanvas = this.contents.querySelector('#timelineElementsCanvas') as HTMLCanvasElement;
        const elementsCtx = timelineElementsCanvas.getContext('2d');
        if (!markersCtx || !elementsCtx) {
            throw new Error("One or more of the drawing contexts failed to load.");
        }
        this.timeline = new Timeline(markersCtx, elementsCtx);

        const MIN_ANIMATION_LENGTH = 1;
        const MAX_ANIMATION_LENGTH = 300;
        this.animationLengthInput = this.contents.querySelector('#animationLengthInput') as HTMLInputElement;
        let currentAnimationLengthMs = parseFloat(this.animationLengthInput.value);
        this.animationLengthInput.onchange = () => {
            let lengthVal = parseFloat(this.animationLengthInput.value)
            if (Number.isNaN(lengthVal)) {
                this.animationLengthInput.value = currentAnimationLengthMs.toString();
                return;
            } else {
                clamp(lengthVal, MIN_ANIMATION_LENGTH, MAX_ANIMATION_LENGTH);
            }

            currentAnimationLengthMs = lengthVal * MILLISECONDS_IN_SECOND;
            this.timeline.setScale(currentAnimationLengthMs);
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

        this.firstKeyframeBtn.onclick = () => this.navigateKeyframes(-this.totalKeyframes);
        this.previousKeyframeBtn.onclick = () => this.navigateKeyframes(-1);
        this.nextKeyframeBtn.onclick = () => this.navigateKeyframes(1);
        this.lastKeyframeBtn.onclick = () => this.navigateKeyframes(this.totalKeyframes);

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
            if (this.totalKeyframes > 1) {
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
    }

    onAnimationStopped() {
        throw new Error('Method not implemented.');
    }

    endEditKeyframePosition() {
        throw new Error('Method not implemented.');
    }

    addKeyframe(worldMatrix: mat4) {
        throw new Error('Method not implemented.');
    }

    public onSceneChange() {
        this.newAnimation();
        this.loadAnimation();
        this.viewer.setCameraController(this.studioCameraController);
    }

    private newAnimation(): void {
        // TODO
        this.studioControlsContainer.setAttribute('hidden', '');
        this.studioHelpText.dataset.default = 'Move the camera to the desired starting position and press Enter.';
        this.resetHelpText();
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
        const dataObj = { version: 2, timeline: this.animation.timeline, length: this.animation.lengthMs };
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
        this.moveKeyframeRightBtn.removeAttribute('hidden');
        this.moveKeyframeLeftBtn.removeAttribute('hidden');
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