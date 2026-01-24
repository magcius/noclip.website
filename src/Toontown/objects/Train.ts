import { type ReadonlyVec3, vec3 } from "gl-matrix";
import { Func } from "../interval/FunctionInterval";
import type { Interval } from "../interval/Interval";
import { BlendType } from "../interval/LerpInterval";
import { LerpPosInterval } from "../interval/LerpPosInterval";
import { Sequence } from "../interval/Sequence";
import { WaitInterval } from "../interval/WaitInterval";
import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { Python2Random } from "../util/Python2Random";

const LOCOMOTIVE_FILE = "phase_10/models/cogHQ/CashBotLocomotive";
const CAR_FILES = [
  "phase_10/models/cogHQ/CashBotBoxCar",
  "phase_10/models/cogHQ/CashBotTankCar",
  "phase_10/models/cogHQ/CashBotFlatCar",
];
const CAR_LENGTH = 88;

// Maximum time for a train to cross the track
const MARK_DELTA = 15; // seconds

/**
 * Train track that handles multiple trains moving across sequentially.
 * Mirrors toontown.safezone.Train from the original Python code.
 */
export class Train {
  private locomotive: PandaNode | null = null;
  private cars: PandaNode[] = [];
  private carModels: PandaNode[] = [];
  private locomotiveModel: PandaNode | null = null;

  private bFlipped: boolean;

  private firstMark: number;
  private lastMark: number;
  private nextRun: Sequence | null = null;

  constructor(
    private scene: PandaNode,
    private trackStartPos: ReadonlyVec3,
    private trackEndPos: ReadonlyVec3,
    private trainId: number,
    numTotalTracks: number,
  ) {
    // Flip the models if the tracks run the opposite direction
    this.bFlipped = trackStartPos[0] < trackEndPos[0];

    // Get initial start time
    this.firstMark = (MARK_DELTA / numTotalTracks) * trainId;
    const currentRun = Math.floor(
      (this.getNetworkTimeInSeconds() - this.firstMark) / MARK_DELTA,
    );
    this.lastMark = currentRun * MARK_DELTA + this.firstMark;
  }

  async init(loader: ToontownLoader): Promise<void> {
    // Load locomotive and car models
    this.locomotiveModel = await loader.loadModel(LOCOMOTIVE_FILE);
    this.carModels = await Promise.all(
      CAR_FILES.map((file) => loader.loadModel(file)),
    );

    // HACK TO MAKE TEXTURES LOAD TODO FIXME
    for (const carModel of this.carModels) {
      carModel.cloneTo(this.scene).hide();
    }

    // Create locomotive instance
    this.locomotive = this.locomotiveModel.cloneTo(this.scene);
    this.locomotive.name = `train_${this.trainId}`;

    if (this.bFlipped) {
      this.locomotive.hpr = vec3.fromValues(180, 0, 0);
    }
  }

  private getNetworkTimeInSeconds(): number {
    // Use wall clock time for synchronization
    return Date.now() / 1000;
  }

  enter(): void {
    this.doNextRun(true);
  }

  exit(): void {
    this.nextRun?.pause();
  }

  private doNextRun(bFirstRun = false): void {
    if (!this.locomotive) return;

    let nextMark: number;
    if (bFirstRun) {
      nextMark = this.lastMark;
    } else {
      nextMark = this.lastMark + MARK_DELTA;
      // this.nextRun?.finish();
    }

    const timeTillNextMark = nextMark - this.getNetworkTimeInSeconds();

    // Run number for seeding random
    const runNumber = Math.floor((nextMark - this.firstMark) / MARK_DELTA);

    // Set up next run interval with seeded random
    const rng = new Python2Random(this.trainId + runNumber);
    this.nextRun = this.getNextRun(rng);

    this.startNextRun(timeTillNextMark);
    this.lastMark = nextMark;
  }

  private startNextRun(timeTillMark: number): void {
    if (!this.locomotive || !this.nextRun) return;

    if (timeTillMark > 0) {
      // Wait before starting - create a new sequence with wait + original run
      const waitSeq = new Sequence([
        new WaitInterval(timeTillMark),
        this.nextRun,
      ]);
      this.nextRun = waitSeq;
      this.nextRun.start();
    } else {
      // Start partway through the interval
      this.nextRun.start(-timeTillMark);
    }
  }

  private cleanupCars(): void {
    for (const car of this.cars) {
      car.removeNode();
    }
    this.cars = [];
  }

  private getCars(rng: Python2Random): void {
    this.cleanupCars();

    if (!this.locomotive) return;

    const numCarsThisRun = rng.randrange(1, 10);
    for (let nCar = 0; nCar < numCarsThisRun; nCar++) {
      const carType = rng.randrange(0, this.carModels.length);
      const carModel = this.carModels[carType];
      const car = carModel.cloneTo(this.locomotive);
      car.pos = vec3.fromValues(CAR_LENGTH * (nCar + 1), 0, 0);
      this.cars.push(car);
    }
  }

  private getNextRun(rng: Python2Random): Sequence {
    this.getCars(rng);

    if (!this.locomotive) {
      return new Sequence([]);
    }

    const trainShouldStop = rng.randrange(0, 4);
    const intervals: Interval[] = [];

    if (trainShouldStop === 0) {
      // Train stops in the middle
      const waitTime = 3;
      const totalTime = rng.randrange(
        4,
        Math.floor((MARK_DELTA - waitTime) / 2),
      );

      const halfway = vec3.create();
      vec3.lerp(halfway, this.trackStartPos, this.trackEndPos, 0.5);
      halfway[0] = 150;

      // First half: start to halfway (easeInOut)
      intervals.push(
        new LerpPosInterval(
          this.locomotive,
          totalTime,
          BlendType.EaseInOut,
          vec3.clone(this.trackStartPos),
          vec3.clone(halfway),
        ),
        // Wait at halfway
        new WaitInterval(waitTime),
        // Second half: halfway to end (easeIn)
        new LerpPosInterval(
          this.locomotive,
          totalTime,
          BlendType.EaseIn,
          vec3.clone(halfway),
          vec3.clone(this.trackEndPos),
        ),
      );
    } else {
      // Normal run through
      const totalTime = rng.randrange(6, MARK_DELTA - 1);

      intervals.push(
        new LerpPosInterval(
          this.locomotive,
          totalTime,
          BlendType.Linear,
          vec3.clone(this.trackStartPos),
          vec3.clone(this.trackEndPos),
        ),
      );
    }

    // Add callback to start next run at the end
    intervals.push(Func(() => this.doNextRun()));

    return new Sequence(intervals);
  }

  delete(): void {
    this.cleanupCars();
    this.nextRun?.pause();
    this.nextRun = null;
    this.locomotive?.removeNode();
    this.locomotive = null;
  }
}
