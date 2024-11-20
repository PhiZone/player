import { std } from 'mathjs';
import type { Game } from '../scenes/Game';
import { FcApStatus, Grade } from '../types';
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
  private _comboIndex: number = 0;

  private _judgment: JudgmentHandler;

  constructor(scene: Game) {
    this._scene = scene;
    this._judgment = scene.judgment;
    this._comboRecords = Array(this._scene.numberOfNotes).fill(undefined);
    this._comboRecords[0] = 0;
    this._maxCombo = Array(this._scene.numberOfNotes).fill(0);
  }

  updateStat(delta: number) {
    if (this._scene.numberOfNotes === 0) {
      this._score = 1_000_000;
      this._displayScore = 0;
      this._accuracy = 1;
      return;
    }
    const good = this._judgment.goodEarly + this._judgment.goodLate;
    this._score = Math.round(
      (9e5 * this._judgment.perfect +
        585e3 * good +
        1e5 * this._maxCombo[this._judgment.judgmentCount]) /
        this._scene.numberOfNotes,
    );
    const displayScoreDiff = this._score - this._displayScore;
    this._displayScore += (displayScoreDiff * delta) / 50;
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
    const displayStdDevDiff = this._stdDev - this._displayStdDev;
    this._displayStdDev += (displayStdDevDiff * delta) / 50;
    this._fcApStatus =
      this._judgment.bad + this._judgment.miss > 0
        ? FcApStatus.NONE
        : good > 0
          ? FcApStatus.FC
          : FcApStatus.AP;
  }

  updateRecords() {
    const currentCombo = this._comboRecords[this._judgment.judgmentCount];
    if (currentCombo === undefined) {
      for (let i = this._comboIndex + 1; i < this._judgment.judgmentCount; i++) {
        this._comboRecords[i] = this._comboRecords[this._comboIndex];
        this._maxCombo[i] = this._maxCombo[this._comboIndex];
      }
      this._comboRecords[this._judgment.judgmentCount] = this._combo;
      this._maxCombo[this._judgment.judgmentCount] = Math.max(
        this._combo,
        this._judgment.judgmentCount === 0 ? 0 : this._maxCombo[this._judgment.judgmentCount - 1],
      );
    } else {
      this._combo = currentCombo;
      for (let i = this._judgment.judgmentCount + 1; i < this._scene.numberOfNotes; i++) {
        this._comboRecords[i] = undefined;
      }
    }
    this._comboIndex = this._judgment.judgmentCount;
    this._judgment.rewindDeltas(this._scene.beat);
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

  public set combo(combo: number) {
    this._combo = combo;
  }
}
