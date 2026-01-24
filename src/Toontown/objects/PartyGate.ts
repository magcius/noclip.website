import { vec3, vec4 } from "gl-matrix";
import { getLoader } from "../Common";
import {
  HOOD_ID_DAISY_GARDENS,
  HOOD_ID_DONALDS_DOCK,
  HOOD_ID_DONALDS_DREAMLAND,
  HOOD_ID_MINNIES_MELODYLAND,
  HOOD_ID_THE_BRRRGH,
  HOOD_ID_TOONTOWN_CENTRAL,
  MINNIE_FONT_PATH,
} from "../Globals";
import { Func, type Interval, Sequence, Wait } from "../interval";
import type { PandaNode } from "../nodes";
import { TextAlignment, type TextFont, TextNode } from "../text";
import { AnimatedProp } from "./AnimatedProp";

const HOOD_TO_PARTY_CLOCK_COLORS: Record<number, vec4> = {
  [HOOD_ID_TOONTOWN_CENTRAL]: vec4.fromValues(
    77.0 / 255.0,
    137.0 / 255.0,
    52.0 / 255.0,
    1.0,
  ),
  [HOOD_ID_DONALDS_DOCK]: vec4.fromValues(
    60.0 / 255.0,
    98.0 / 255.0,
    142.0 / 255.0,
    1.0,
  ),
  [HOOD_ID_MINNIES_MELODYLAND]: vec4.fromValues(
    128.0 / 255.0,
    62.0 / 255.0,
    142.0 / 255.0,
    1.0,
  ),
  [HOOD_ID_DAISY_GARDENS]: vec4.fromValues(
    52.0 / 255.0,
    153.0 / 255.0,
    95.0 / 255.0,
    1.0,
  ),
  [HOOD_ID_THE_BRRRGH]: vec4.fromValues(
    53.0 / 255.0,
    116.0 / 255.0,
    148.0 / 255.0,
    1.0,
  ),
  [HOOD_ID_DONALDS_DREAMLAND]: vec4.fromValues(
    79.0 / 255.0,
    92.0 / 255.0,
    120.0 / 255.0,
    1.0,
  ),
};

class Label {
  private _node: PandaNode;
  private _textNode: TextNode;

  constructor(
    parent: PandaNode,
    name: string,
    text: string,
    font: TextFont,
    textColor: vec4,
    textAlign: TextAlignment,
    textPos: vec3,
    textScale: vec3,
    wordwrap: number,
  ) {
    this._node = parent.attachNewNode(`${name}_node`);
    this._node.pos = textPos;
    this._node.scale = textScale;
    this._textNode = new TextNode(`${name}_text`);
    this._textNode.font = font;
    this._textNode.textColor = textColor;
    this._textNode.text = text;
    this._textNode.align = textAlign;
    this._textNode.wordwrap = wordwrap;
    this.update();
  }

  set text(text: string) {
    if (text === this._textNode.text) return;
    this._textNode.text = text;
    this.update();
  }

  get node(): PandaNode {
    return this._node;
  }

  private update(): void {
    const textNodeNode = this._textNode.generate();
    // textNodeNode.scale = this.textScale;
    for (const [child] of this.node.children) {
      this._node.removeChild(child);
    }
    this._node.addChild(textNodeNode);
  }
}

export class PartyGate extends AnimatedProp {
  private partyGate: PandaNode;
  private clockLocator: PandaNode;

  private hourLabel: Label;
  private minuteLabel: Label;
  private colonLabel: Label;
  private amLabel: Label;
  private interval: Interval;

  constructor(node: PandaNode) {
    super(node);

    const partyGate = node.find("**/partyGate_grp");
    if (!partyGate) throw new Error("partyGate_grp not found");
    this.partyGate = partyGate;

    const clockLocator = partyGate.find("**/clockText_locator");
    if (!clockLocator) throw new Error("clockText_locator not found");
    this.clockLocator = clockLocator;
  }

  override async init(): Promise<void> {
    await super.init();

    const font = await getLoader().loadFont(MINNIE_FONT_PATH);
    const clockTextNode = this.partyGate.attachNewNode("clockText");
    clockTextNode.setPosHprScale(
      vec3.fromValues(
        this.clockLocator.pos[0],
        this.clockLocator.pos[1],
        this.clockLocator.pos[2] - 0.2,
      ),
      this.clockLocator.hpr,
      vec3.fromValues(12.0, 1.0, 26.0),
    );

    const textColor = HOOD_TO_PARTY_CLOCK_COLORS[this._hoodId];
    if (!textColor) throw new Error(`Invalid hoodId: ${this._hoodId}`);
    const textScale = vec3.fromValues(0.075, 0.075, 0.075);
    this.hourLabel = new Label(
      clockTextNode,
      "clockHour",
      "12",
      font,
      textColor,
      TextAlignment.Right,
      vec3.fromValues(-0.015, 0, 0),
      textScale,
      0,
    );
    this.colonLabel = new Label(
      clockTextNode,
      "clockColon",
      ":",
      font,
      textColor,
      TextAlignment.Center,
      vec3.fromValues(0, 0, 0),
      textScale,
      0,
    );
    this.minuteLabel = new Label(
      clockTextNode,
      "clockMinute",
      "00",
      font,
      textColor,
      TextAlignment.Left,
      vec3.fromValues(0.015, 0, 0),
      textScale,
      0,
    );
    this.amLabel = new Label(
      clockTextNode,
      "clockAM",
      "am",
      font,
      textColor,
      TextAlignment.Left,
      vec3.fromValues(-0.035, 0, -0.032),
      vec3.fromValues(0.075 * 0.5, 0.075 * 0.5, 0.075 * 0.5),
      0,
    );

    this.interval = new Sequence([
      Func(() => {
        this.colonLabel.node.show();
      }),
      Wait(0.75),
      Func(() => {
        this.colonLabel.node.hide();
      }),
      Wait(0.25),
      Func(() => {
        this.updateTime();
      }),
    ]);

    const signGroup = this.node.find("**/partyGateSignGroup");
    if (!signGroup) throw new Error("partyGateSignGroup not found");
    const leftSign = signGroup.find("**/signTextL_locatorBack");
    if (!leftSign) throw new Error("signTextL_locatorBack not found");
    const rightSign = signGroup.find("**/signTextR_locatorFront");
    if (!rightSign) throw new Error("signTextR_locatorFront not found");

    const signScale = vec3.fromValues(0.35, 0.35, 0.35);
    const signColor = vec4.fromValues(0.7, 0.3, 0.3, 1.0);
    new Label(
      leftSign,
      "leftSign",
      "Come On In!",
      font,
      signColor,
      TextAlignment.Center,
      vec3.create(),
      signScale,
      8,
    );
    new Label(
      rightSign,
      "rightSign",
      "Public Parties Here!",
      font,
      signColor,
      TextAlignment.Center,
      vec3.create(),
      signScale,
      8,
    );
  }

  override enter(): void {
    this.updateTime();
    this.interval.loop();
  }

  override exit(): void {
    this.interval.pause();
  }

  private updateTime() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? "pm" : "am";

    this.hourLabel.text = (hours % 12 || 12).toString();
    this.minuteLabel.text = minutes.toString().padStart(2, "0");
    this.amLabel.text = ampm;
  }
}
