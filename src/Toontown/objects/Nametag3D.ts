import { mat4, quat, type ReadonlyVec4, vec3, vec4 } from "gl-matrix";
import { getLoader } from "../Common";
import { INTERFACE_FONT_PATH } from "../Globals";
import {
  DecalEffect,
  GeomNode,
  PandaNode,
  TransformState,
  TransparencyAttrib,
  TransparencyMode,
} from "../nodes";
import { TextAlignment, TextNode } from "../text";

export enum NametagColorCode {
  Normal,
  NoChat,
  NonPlayer,
  Suit,
  ToonBuilding,
  SuitBuilding,
  HouseBuilding,
  SpeedChat,
  FreeChat,
}

interface NametagColors {
  nameFg: ReadonlyVec4;
  nameBg: ReadonlyVec4;
  chatFg: ReadonlyVec4;
  chatBg: ReadonlyVec4;
}

enum NametagButtonState {
  Normal,
  Clicked,
  Rollover,
  Inactive,
}

type NametagColorsByState = Record<NametagButtonState, NametagColors>;

const NAMETAG_COLORS: Record<NametagColorCode, NametagColorsByState> = {
  [NametagColorCode.Normal]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.0, 1.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(0.5, 0.5, 1.0, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 1.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.0, 0.6, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.3, 0.3, 0.7, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.NoChat]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.8, 0.4, 0.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(1.0, 0.5, 0.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.0, 0.6, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.6, 0.4, 0.2, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.NonPlayer]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.8, 0.4, 0.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(1.0, 0.5, 0.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.0, 0.6, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.6, 0.4, 0.2, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.Suit]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(0.5, 1.0, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.6, 0.0, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.2, 0.2, 0.2, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.ToonBuilding]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(0.5, 1.0, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.6, 0.0, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.3, 0.6, 1.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.SuitBuilding]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(0.5, 1.0, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.6, 0.0, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.55, 0.55, 0.55, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.HouseBuilding]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(0.5, 1.0, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 0.5, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.6, 0.0, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.3, 0.6, 1.0, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.SpeedChat]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.0, 0.6, 0.2, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(0.0, 0.6, 0.2, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(0.5, 1.0, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.0, 1.0, 0.5, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.6, 0.0, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.1, 0.4, 0.2, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
  [NametagColorCode.FreeChat]: {
    [NametagButtonState.Normal]: {
      nameFg: vec4.fromValues(0.3, 0.3, 0.7, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Clicked]: {
      nameFg: vec4.fromValues(0.2, 0.2, 0.5, 1.0),
      nameBg: vec4.fromValues(0.2, 0.2, 0.2, 0.6),
      chatFg: vec4.fromValues(1.0, 0.5, 0.5, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Rollover]: {
      nameFg: vec4.fromValues(0.5, 0.5, 1.0, 1.0),
      nameBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
      chatFg: vec4.fromValues(0.0, 0.6, 0.6, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
    [NametagButtonState.Inactive]: {
      nameFg: vec4.fromValues(0.3, 0.3, 0.7, 1.0),
      nameBg: vec4.fromValues(0.8, 0.8, 0.8, 0.5),
      chatFg: vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      chatBg: vec4.fromValues(1.0, 1.0, 1.0, 1.0),
    },
  },
};

// Padding around the text for the card (left, right, bottom, top)
const CARD_PAD: readonly [number, number, number, number] = [
  0.1, 0.1, 0.1, 0.0,
];

// The source geometry frame for the nametag card panel (left, right, bottom, top)
const NAMETAG_CARD_FRAME: readonly [number, number, number, number] = [
  -0.5, 0.5, -0.5, 0.5,
];

const FAR_DISTANCE = 50.0;
const FAR_SCALE = 0.56;
const SCALE_EXP = 0.5;

export class Nametag3D extends PandaNode {
  private _top: PandaNode;
  private _card: PandaNode;

  public height: number = 0;

  constructor() {
    super();
    this._top = this.attachNewNode("top");
  }

  async init(name: string, colorCode: NametagColorCode): Promise<void> {
    const colors = NAMETAG_COLORS[colorCode][NametagButtonState.Normal];
    this._card = (
      await getLoader().loadModel("phase_3/models/props/panel")
    ).clone();
    this._card.setColor(colors.nameBg);
    this._card.setAttrib(TransparencyAttrib.create(TransparencyMode.Alpha));
    this._top.addChild(this._card);

    const font = await getLoader().loadFont(INTERFACE_FONT_PATH);
    const text = new TextNode("nametag");
    text.font = font;
    text.wordwrap = 8;
    text.align = TextAlignment.Center;
    text.lineHeight = 1.0; // this makes it look more accurate for some reason
    text.text = name;
    text.textColor = colors.nameFg;
    const textNode = text.generate();
    let decalNode: PandaNode | null = this._card.findNodeByType(GeomNode);
    if (!decalNode) decalNode = this._card;
    decalNode.addChild(textNode);
    decalNode.setEffect(new DecalEffect());

    // Get text frame (left, right, bottom, top) and apply padding
    const [left, right, bottom, top] = text.frame;
    const frameLeft = left - CARD_PAD[0];
    const frameRight = right + CARD_PAD[1];
    const frameBottom = bottom - CARD_PAD[2];
    const frameTop = top + CARD_PAD[3];

    // Scale the source geometry from its original bounds to the target frame
    const [srcLeft, srcRight, srcBottom, srcTop] = NAMETAG_CARD_FRAME;
    const srcWidth = srcRight - srcLeft;
    const srcHeight = srcTop - srcBottom;
    const srcCenterX = (srcLeft + srcRight) / 2;
    const srcCenterZ = (srcBottom + srcTop) / 2;

    const targetWidth = frameRight - frameLeft;
    const targetHeight = frameTop - frameBottom;
    const targetCenterX = (frameLeft + frameRight) / 2;
    const targetCenterZ = (frameTop + frameBottom) / 2;

    // Scale factors: target_size / source_size
    const scaleX = targetWidth / srcWidth;
    const scaleZ = targetHeight / srcHeight;

    // Translation: target_center - source_center
    const transX = targetCenterX - srcCenterX;
    const transZ = targetCenterZ - srcCenterZ;

    this._card.transform = TransformState.fromPosQuatScale(
      vec3.fromValues(transX, 0, transZ),
      quat.create(),
      vec3.fromValues(scaleX, 1, scaleZ),
    );
    textNode.transform = TransformState.fromMatrix(
      this._card.transform.getInverseMatrix(),
    );
  }

  override update(scene: PandaNode): void {
    const cam = scene.find("camera");
    if (!cam) {
      console.warn("Nametag3D.update: could not find camera node");
      return;
    }

    // Calculate screen-aligned billboard quat
    const camToThis = mat4.create();
    mat4.multiply(
      camToThis,
      this.netTransform.getInverseMatrix(),
      cam.netTransform.getMatrix(),
    );
    const q = quat.create();
    mat4.getRotation(q, camToThis);
    quat.rotateX(q, q, -Math.PI / 2);
    quat.normalize(q, q);

    // Calculate distance-based scale
    const d = Math.sqrt(
      camToThis[12] * camToThis[12] +
        camToThis[13] * camToThis[13] +
        camToThis[14] * camToThis[14],
    );
    const normDistance = Math.max(d, 0.1) / FAR_DISTANCE;
    const scaleN = normDistance ** SCALE_EXP * FAR_SCALE;
    const scale = vec3.fromValues(scaleN, scaleN, scaleN);

    this._top.transform = TransformState.fromPosQuatScale(
      vec3.fromValues(0, 0, this.height),
      q,
      scale,
    );
  }
}
