import { std } from 'mathjs';
import type { Game } from '../scenes/Game';
import { FcApStatus, Grade } from '$lib/types';
import type { JudgmentHandler } from './JudgmentHandler';

export class StatisticsHandler {
  private _scene: Game;
  private _score: number = 0;
  private _accuracy: number = 1;
  private _stdDev: number = 0;
  private _maxCombo: number[];
  private _fcApStatus: FcApStatus = FcApStatus.AP;
  private _displayScore: number = 0;
  private _displayStdDev: number = 0;
  private _combo: number = 0;
  private _comboRecords: (number | undefined)[];

  private _judgment: JudgmentHandler;

  constructor(scene: Game) {
    this._scene = scene;
    this._judgment = scene.judgment;
    this._comboRecords = Array(this._scene.numberOfNotes + 1).fill(undefined);
    this._comboRecords[0] = 0;
    this._maxCombo = Array(this._scene.numberOfNotes + 1).fill(0);
  }

  updateDisplay(delta: number) {
    if (this._scene.numberOfNotes === 0) {
      this._score = 1_000_000;
      this._displayScore = 0;
      this._accuracy = 1;
      return;
    }
    delta *= this._scene.tweens.timeScale;
    const displayScoreDiff = this._score - this._displayScore;
    this._displayScore += displayScoreDiff * Math.min(delta / 50, 1);
    const displayStdDevDiff = this._stdDev - this._displayStdDev;
    this._displayStdDev += displayStdDevDiff * Math.min(delta / 50, 1);
  }

  updateRecords(rewind = false) {
    if (rewind) {
      this._combo = this._comboRecords[this._judgment.judgmentCount] ?? 0;
      for (let i = this._judgment.judgmentCount + 1; i <= this._scene.numberOfNotes; i++) {
        this._comboRecords[i] = undefined;
      }
      this._judgment.rewindDeltas(this._scene.beat);
    } else {
      this._comboRecords[this._judgment.judgmentCount] = this._combo;
      this._maxCombo[this._judgment.judgmentCount] = Math.max(
        this._combo,
        this._judgment.judgmentCount === 0 ? 0 : this._maxCombo[this._judgment.judgmentCount - 1],
      );
    }
    this.updateStats();
  }

  updateStats() {
    const good = this._judgment.goodEarly + this._judgment.goodLate;
    this._score = Math.round(
      (9e5 * this._judgment.perfect +
        585e3 * good +
        1e5 * this._maxCombo[this._judgment.judgmentCount]) /
        this._scene.numberOfNotes,
    );
    this._accuracy =
      this._judgment.judgmentCount === 0
        ? 1
        : (this._judgment.perfect + 0.65 * good) / this._judgment.judgmentCount;
    if (this._judgment.judgmentDeltas.length > 1)
      this._stdDev =
        Number(
          std(
            this._judgment.judgmentDeltas.map((v) => v.delta),
            'uncorrected',
          ),
        ) * 1000;
    else this._stdDev = 0;
    this._fcApStatus =
      this._judgment.bad + this._judgment.miss > 0
        ? FcApStatus.NONE
        : good > 0
          ? FcApStatus.FC
          : FcApStatus.AP;
  }

  public get stats() {
    return {
      grade: this.grade,
      score: this._score,
      displayScore: Math.round(this._displayScore),
      accuracy: this._accuracy,
      stdDev: this._stdDev,
      displayStdDev: this._displayStdDev,
      combo: this._combo,
      maxCombo: this._maxCombo[this._judgment.judgmentCount],
      judgmentCount: this._judgment.judgmentCount,
      perfect: this._judgment.perfect,
      goodEarly: this._judgment.goodEarly,
      goodLate: this._judgment.goodLate,
      bad: this._judgment.bad,
      miss: this._judgment.miss,
    };
  }

  public get grade() {
    if (this._score === 1_000_000) return Grade.AP;
    if (this._fcApStatus === FcApStatus.FC) return Grade.FC;
    if (this._score >= 960_000) return Grade.V;
    if (this._score >= 920_000) return Grade.S;
    if (this._score >= 880_000) return Grade.A;
    if (this._score >= 820_000) return Grade.B;
    if (this._score >= 700_000) return Grade.C;
    return Grade.F;
  }

  public get fcApStatus() {
    return this._fcApStatus;
  }

  public get combo() {
    return this._combo;
  }

  public get displayScore() {
    return this._displayScore;
  }

  public get accuracy() {
    return this._accuracy;
  }

  public get displayStdDev() {
    return this._displayStdDev;
  }

  public set combo(combo: number) {
    this._combo = combo;
  }
}
