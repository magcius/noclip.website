import { type ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import { MathConstants } from "../../MathHelpers";
import { getLoader } from "../Common";
import {
  BlendType,
  Func,
  type Interval,
  LerpHprInterval,
  LerpPosInterval,
  Parallel,
  Sequence,
  Wait,
} from "../interval";
import { ColorAttrib, DecalEffect } from "../nodes";
import { Avatar } from "./Avatar";
import { CHAR_PROPERTIES, type CharProperties } from "./CharData";
import { NametagColorCode } from "./Nametag3D";

export class Char extends Avatar {
  private _props: CharProperties;
  private _curPathNode = "a";
  private _walkInterval: Interval | null = null;

  constructor() {
    super();
    this._playerType = NametagColorCode.NonPlayer;
  }

  async generateChar(code: string) {
    this._props = CHAR_PROPERTIES[code];
    if (!this._props) throw new Error(`Unknown character code: ${code}`);
    this.name = this._props.name;
    await this.loadModel(
      `${this._props.modelPathPrefix}${this._props.lods[0]}`,
    );
    await this.loadAnims(this._props.animations);

    if (code === "mk" || code === "mn" || code === "p" || code === "dw") {
      for (const part of this._parts.values()) {
        const instance = part.character;
        // Fix pupil rendering
        const eyes = instance.find("**/eyes*");
        if (eyes) {
          instance.findAllMatches("**/joint_pupil?").forEach((pupil) => {
            pupil.reparentTo(eyes);
          });
          eyes.setEffect(new DecalEffect());
        }
      }
    } else if (code === "dd") {
      for (const part of this._parts.values()) {
        const instance = part.character;
        // Hide closed eyes
        instance.find("**/eyesclose")?.hide();
      }
    }

    // Add drop shadow
    // TODO ShadowCaster
    const shadowModel = await getLoader().loadModel(
      "phase_3/models/props/drop_shadow",
    );
    for (const part of this._parts.values()) {
      const instance = part.character;
      const shadow = shadowModel.cloneTo(instance);
      shadow.pos = vec3.fromValues(0, 0, 0.025);
      shadow.scale = vec3.fromValues(0.4, 0.4, 0.4);
      shadow.setAttrib(ColorAttrib.flat(vec4.fromValues(0, 0, 0, 0.5)), 1);
    }

    this.setHeight(this._props.height);

    const paths = this._props.paths;
    this._curPathNode = "a";
    this.pos = paths.nodes[this._curPathNode].pos;
    this.loop("neutral");
  }

  walkToNextPoint() {
    const pathNode = this._props.paths.nodes[this._curPathNode];
    if (!pathNode || !pathNode.adjacent.length) return;
    const nextNode =
      pathNode.adjacent[Math.floor(Math.random() * pathNode.adjacent.length)];
    if (this._curPathNode === nextNode) return;
    const points = this.getPointsFromTo(this._curPathNode, nextNode);
    const sequence: Interval[] = [
      Func(() => {
        this.loop("walk");
      }),
    ];
    let startH = this.h;
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const d = vec3.create();
      vec3.subtract(d, end, start);
      const duration = vec3.length(d) / this._props.speed;
      const endH = -Math.atan2(d[0], d[1]) * MathConstants.RAD_TO_DEG;
      const deltaH = shortestDeltaDeg(startH, endH);
      sequence.push(
        new Parallel([
          // this.actorInterval("walk", { duration: duration, loop: true }),
          new LerpPosInterval(this, duration, BlendType.Linear, start, end),
          new LerpHprInterval(
            this,
            Math.abs(deltaH) / 270,
            BlendType.Linear,
            vec3.fromValues(startH, 0, 0),
            vec3.fromValues(startH + deltaH, 0, 0),
          ),
        ]),
      );
      startH = endH;
    }
    sequence.push(
      Func(() => {
        // console.log("Done walking from", this._curPathNode, "to", nextNode);
        this._curPathNode = nextNode;
        this.loop("neutral");
      }),
      Wait(2),
      // this.actorInterval("neutral", { duration: 2, loop: true }),
      Func(() => {
        this.walkToNextPoint();
      }),
    );
    this._walkInterval = new Sequence(sequence);
    this._walkInterval.start();
  }

  stopWalking() {
    this._walkInterval?.pause();
  }

  private getPointsFromTo(from: string, to: string): ReadonlyVec3[] {
    const paths = this._props.paths;
    if (from === to) return [paths.nodes[from].pos];
    let points: ReadonlyVec3[] = [];
    const forward = paths.waypoints.find(
      (wp) => wp.from === from && wp.to === to,
    );
    if (forward) {
      points = forward.points;
    } else {
      const backward = paths.waypoints.find(
        (wp) => wp.from === to && wp.to === from,
      );
      if (backward) {
        points = backward.points.slice().reverse();
      }
    }
    return [paths.nodes[from].pos, ...points, paths.nodes[to].pos];
  }
}

function shortestDeltaDeg(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
