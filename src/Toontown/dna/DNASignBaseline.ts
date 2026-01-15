import { vec3 } from "gl-matrix";

export interface DNASignBaselineConfig {
  width: number;
  height: number;
  indent: number;
  kern: number;
  wiggle: number;
  stumble: number;
  stomp: number;
  scale: vec3;
}

export class DNASignBaseline {
  private counter = 0;
  private totalWidth = 0;
  private nextPos = vec3.create();
  private cursor = 0;
  private priorCursor = 0;
  private priorCharWasBlank = true;

  constructor(private config: DNASignBaselineConfig) {}

  reset(): void {
    this.counter = 0;
    this.totalWidth = 0;
    vec3.zero(this.nextPos);
    this.cursor = 0;
    this.priorCursor = 0;
    this.priorCharWasBlank = true;
  }

  isFirstLetterOfWord(letter: string): boolean {
    if (letter[0] === " ") {
      this.priorCharWasBlank = true;
      return false;
    }
    if (this.priorCharWasBlank) {
      this.priorCharWasBlank = false;
      return true;
    }
    this.priorCharWasBlank = false;
    return false;
  }

  nextPosHprScale(pos: vec3, hpr: vec3, scale: vec3, size: vec3): void {
    if (this.config.width !== 0 || this.config.height !== 0) {
      this.circleNextPosHprScale(pos, hpr, scale, size);
    } else {
      this.lineNextPosHprScale(pos, hpr, scale, size);
    }
  }

  center(pos: vec3, hpr: vec3): void {
    const PI = Math.PI;
    const QUARTER_CIRCLE = PI * 0.5;
    const DEG_TO_RAD = PI / 180;

    const angle = -hpr[2] * DEG_TO_RAD;

    if (this.config.width !== 0 || this.config.height !== 0) {
      const xRadius = this.config.width * 0.5;
      const zRadius = this.config.height * 0.5;

      const adjustedAngle = angle + QUARTER_CIRCLE;
      pos[0] -= xRadius * Math.cos(adjustedAngle);
      pos[2] -= zRadius * Math.sin(adjustedAngle);
      hpr[2] += this.priorCursor * 0.5;
    } else {
      this.counter--;
      const gapWidth = this.currentKern + this.currentStumble;
      this.counter++;
      const radius = (this.totalWidth + gapWidth) * 0.5;

      pos[0] -= radius * Math.cos(angle);
      pos[2] -= radius * Math.sin(angle);
    }
  }

  private get currentKern(): number {
    return this.counter * this.config.kern;
  }

  private get currentWiggle(): number {
    return this.counter & 1 ? this.config.wiggle : -this.config.wiggle;
  }

  private get currentStumble(): number {
    return this.counter & 1 ? this.config.stumble : -this.config.stumble;
  }

  private get currentStomp(): number {
    return this.counter & 1 ? this.config.stomp : -this.config.stomp;
  }

  private lineNextPosHprScale(
    pos: vec3,
    hpr: vec3,
    scale: vec3,
    size: vec3,
  ): void {
    vec3.multiply(scale, scale, this.config.scale);

    vec3.add(pos, pos, this.nextPos);
    pos[0] += this.currentKern + this.currentStumble;
    pos[2] += this.currentStomp;

    const scaledWidth = scale[0] * size[0];
    this.nextPos[0] += scaledWidth;
    this.totalWidth += scaledWidth;

    hpr[2] -= this.currentWiggle;

    this.counter++;
  }

  private circleNextPosHprScale(
    pos: vec3,
    hpr: vec3,
    scale: vec3,
    size: vec3,
  ): void {
    const PI = Math.PI;
    const QUARTER_CIRCLE = PI * 0.5;
    const DEG_TO_RAD = PI / 180;
    const RAD_TO_DEG = 180 / PI;

    vec3.multiply(scale, scale, this.config.scale);

    const xRadius = this.config.width * 0.5;
    const zRadius = this.config.height * 0.5;

    const xOffset = this.config.width < 0 ? pos[0] : -pos[0];
    const halfCirc = PI * xRadius;
    const radianWidthDelta = (xOffset / halfCirc) * PI;

    const degreeDelta =
      this.config.width < 0 ? -this.config.indent : this.config.indent;
    const radianDelta = degreeDelta * DEG_TO_RAD + radianWidthDelta;
    const radianCursor = this.cursor * DEG_TO_RAD;
    const radianTotal = radianCursor + QUARTER_CIRCLE + radianDelta;

    let radiusDelta = pos[2] + this.currentStomp;
    if (this.config.width < 0) radiusDelta = -radiusDelta;

    pos[0] = (xRadius + radiusDelta) * Math.cos(radianTotal);
    pos[2] = (zRadius + radiusDelta) * Math.sin(radianTotal);

    hpr[2] -= this.cursor + degreeDelta + this.currentWiggle;

    const hypot = Math.hypot(pos[0], pos[2]);

    if (this.config.width < 0) {
      this.priorCursor = radianCursor * RAD_TO_DEG;
    }

    const scaledWidth = scale[0] * size[0];
    let newRadianCursor =
      radianCursor - 2 * Math.asin(Math.min(scaledWidth / (2 * hypot), 1.0));

    if (this.config.width >= 0) {
      this.priorCursor = newRadianCursor * RAD_TO_DEG;
    }

    const gapWidth = this.config.kern - this.currentStumble;
    newRadianCursor -= 2 * Math.asin(gapWidth / (2 * hypot));

    const tempCursor = this.cursor;
    this.cursor = newRadianCursor * RAD_TO_DEG;

    const knockBack = (this.cursor - tempCursor) * 0.5;
    if (this.config.width >= 0) {
      hpr[2] -= knockBack;
    }

    this.counter++;
  }
}
