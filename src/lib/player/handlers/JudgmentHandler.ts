import { GameObjects } from 'phaser';
import { HitEffects, HitParticleLayer } from '../objects/HitEffects';
import type { Line } from '../objects/Line';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import type { Game } from '../scenes/Game';
import { GameStatus, JudgmentType } from '$lib/types';
import { getJudgmentColor, rgbToHex, isPerfectOrGood } from '../utils';
import {
  BAD_EXTRA,
  BAD_SHRINK_X,
  DRAG_TIME_RANGE,
  FLICK_P_FACTOR,
  FLICK_PROJECTION_MIN,
  FLICK_SPEED_FACTOR,
  HOLD_SAFE_FRAMES,
  HOLD_TAIL_MISS,
  HOLD_TAIL_SETTLE,
  HOLD_X_RANGE,
  MATCH_TIME_EPS,
  METRIC_Y_WEIGHT_DIVISOR,
  SCORE_DT_EPS,
  SPEED_UNIT_DPI,
  SPEED_UNIT_FACTOR,
  TAP_X_RANGE,
  WIDE_X_RANGE,
  WEB_BASE_DPI,
} from '../constants';

/**
 * Per-finger input state following the official Phigros judgment mechanics.
 *
 * Displacement vectors are kept in world units (1 world unit = screen height
 * / 10); `isNewFlick` / `stopped` drive the flick-gesture detection.
 */
interface Finger {
  /** Pointer id (real touches) or -1 for the keyboard's virtual finger. */
  id: number;
  /** Keyboard finger: positionless; matches every note regardless of x/y. */
  virtual: boolean;
  active: boolean;
  /** Current position, canvas pixels. */
  x: number;
  y: number;
  /** Position at the end of the previous frame, canvas pixels. */
  prevX: number;
  prevY: number;
  /** Displacement vectors of the previous/current frame, world units. */
  d0x: number;
  d0y: number;
  d1x: number;
  d1y: number;
  isNewFlick: boolean;
  stopped: boolean;
  /**
   * Lifted since the last update tick. The finger is kinematically processed
   * one final frame (displacement vectors + gesture detection + matching), so
   * a flick that ends in a lift within the same frame is not lost.
   */
  lifted: boolean;
}

/**
 * Judgment system implementing the officially documented Phigros mechanics
 * (https://www.bilibili.com/opus/1226031520301449218):
 *
 *   1. 触发 (trigger)   — clicks, held fingers, and flick gestures per finger;
 *                         finger positions are distilled into per-frame
 *                         displacement vectors (d0/d1, world units) each tick
 *                         before the 划动触发 velocity test runs
 *   2. 匹配 (matching)  — CheckNote (clicks) / CheckFlick (red keys) over the
 *                         globally time-sorted note list, including the
 *                         weighted-Manhattan tie-break and the over-late
 *                         interval-slicing quirk ("late Bad")
 *   3. 评分 (scoring)   — per-note controls (Click/Hold/Drag/Flick) evaluated
 *                         strictly after matching within the same frame, so
 *                         the documented intra-frame delay emerges naturally
 *
 * Standard (宽判) windows only: P/G come from preferences (defaults 80/180 ms
 * at which the RKS factor is exactly 1.0), B = G + 40 ms, D = 100 ms fixed,
 * F = 1.75 × P.
 */
export class JudgmentHandler {
  private _scene: Game;
  private _perfect: number = 0;
  private _goodEarly: number = 0;
  private _goodLate: number = 0;
  private _bad: number = 0;
  private _miss: number = 0;
  private _judgmentCount: number = 0;
  private _judgmentDeltas: { delta: number; beat: number }[] = [];
  private _hitEffectsContainers: Record<number, GameObjects.Container> = {};
  private _hitParticleLayers: Record<number, HitParticleLayer> = {};
  private _judgingHolds: { note: LongNote; beatLastExecuted: number }[] = [];

  /** All judgeable notes, sorted ascending by hit time. */
  private _notesByTime: (PlainNote | LongNote)[] = [];

  /** Active fingers (real touches + the keyboard's virtual finger). */
  private _fingers: Map<number, Finger> = new Map();
  /** Fingers whose down event has not been matched yet (click gestures). */
  private _pendingClicks: Finger[] = [];
  /** Pending keyboard flick gestures (positionless red-key attempts). */
  private _pendingKeyboardFlicks = 0;

  /** Monotonic slicing cursors into `_notesByTime`. */
  private _clickCursor = 0;
  private _flickCursor = 0;
  private _controlCursor = 0;
  /** Notes whose scoring control is still alive. */
  private _controls: (PlainNote | LongNote)[] = [];
  /** Set while resetWindow mass-invalidates judgments (defers statistics). */
  private _bulkRewinding = false;

  // Cached unit conversions, refreshed once per frame.
  private _wuPx = 1;
  private _pxPerUnit = 1;

  // Scratch line-relative coordinates for the matching hot path.
  private _rax = 0;
  private _ray = 0;
  // Reused return object for windows() (hot path — no per-call allocation).
  private _windows: { P: number; G: number; B: number } = { P: 0, G: 0, B: 0 };

  constructor(scene: Game) {
    this._scene = scene;
    [...new Set(scene.notes.map((note) => note.note.zIndexHitEffects))].forEach((zIndex) => {
      this.createHitEffectsContainer(zIndex ?? 7);
    });
    this._fingers.set(-1, {
      id: -1,
      virtual: true,
      active: false,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      d0x: 0,
      d0y: 0,
      d1x: 0,
      d1y: 0,
      isNewFlick: false,
      stopped: true,
      lifted: false,
    });
  }

  /** Installs the time-sorted note list (called once after preprocessing). */
  setNotes(notes: (PlainNote | LongNote)[]) {
    this._notesByTime = notes;
  }

  // ======================================================================
  // Input events (called from PointerHandler / KeyboardHandler)
  // ======================================================================

  pointerDown(id: number, x: number, y: number) {
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    let finger = this._fingers.get(id);
    if (!finger) {
      finger = {
        id,
        virtual: false,
        active: true,
        x,
        y,
        prevX: x,
        prevY: y,
        d0x: 0,
        d0y: 0,
        d1x: 0,
        d1y: 0,
        isNewFlick: false,
        stopped: true,
        lifted: false,
      };
      this._fingers.set(id, finger);
    } else {
      finger.active = true;
      finger.x = finger.prevX = x;
      finger.y = finger.prevY = y;
      finger.d0x = finger.d0y = finger.d1x = finger.d1y = 0;
      finger.isNewFlick = false;
      finger.stopped = true;
      finger.lifted = false;
    }
    this._pendingClicks.push(finger);
  }

  pointerMove(id: number, x: number, y: number) {
    // Positions freeze while paused so the first frame after a resume never
    // sees a displacement spanning the pause (spurious flick gesture).
    if (this._scene.status !== GameStatus.PLAYING) return;
    const finger = this._fingers.get(id);
    if (!finger || finger.virtual) return;
    finger.x = x;
    finger.y = y;
  }

  pointerUp(id: number) {
    const finger = this._fingers.get(id);
    if (!finger || finger.virtual) return;
    finger.active = false;
    // One final kinematics pass in the next update still sees this finger, so
    // a swipe's last movement frame is detected even when the lift precedes it.
    finger.lifted = true;
  }

  keyDown() {
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    const finger = this._fingers.get(-1)!;
    finger.active = true;
    // A new key press counts as one click gesture and one flick gesture.
    this._pendingClicks.push(finger);
    this._pendingKeyboardFlicks++;
  }

  keyUp() {
    // The virtual finger deactivates only once no keys remain held.
    const finger = this._fingers.get(-1)!;
    finger.active = this._scene.keyboard?.hasKeysDown ?? false;
  }

  // ======================================================================
  // Per-frame processing: trigger → match → score
  // ======================================================================

  update(nowTime: number, deltaSec: number) {
    if (this._scene.status !== GameStatus.PLAYING) return;
    this._wuPx = this._scene.sys.canvas.height / 10;
    this._pxPerUnit = this._scene.p(1);

    // 1. 触发 — per-frame finger kinematics, then flick-gesture detection.
    //    划动触发 requires each finger's displacement vectors d0/d1 (world
    //    units) recomputed from the positions gathered since the last tick.
    if (deltaSec > 0) {
      this.updateFingerDisplacements();
      this.detectFlicks(deltaSec);
    }

    // 2. 匹配 — click gestures first, then flick gestures.
    while (this._pendingClicks.length > 0) {
      const finger = this._pendingClicks.shift()!;
      this.checkNote(finger, nowTime);
    }
    while (this._pendingKeyboardFlicks > 0) {
      this._pendingKeyboardFlicks--;
      this.checkFlick(this._fingers.get(-1)!, nowTime);
    }
    for (const finger of this._fingers.values()) {
      if ((finger.active || finger.lifted) && finger.isNewFlick) this.checkFlick(finger, nowTime);
    }
    for (const finger of this._fingers.values()) {
      finger.lifted = false;
    }

    // 3. 评分 — controls run strictly after matching, so a note crossing its
    // window boundary this very frame can still be matched first ("late
    // Bad") before its control misses it.
    this.activateControls(nowTime);
    for (let i = this._controls.length - 1; i >= 0; i--) {
      const note = this._controls[i];
      if (this.judgeControl(note, nowTime)) {
        this._controls[i] = this._controls[this._controls.length - 1];
        this._controls.pop();
      }
    }

    // Periodic hold hit effects.
    this.updateHoldingEffects();
  }

  /**
   * 划动触发前提: shifts each live finger's displacement vectors. `d1` becomes
   * the movement gathered since the previous tick (events coalesce into the
   * latest position), `d0` keeps the tick before it — both in world units,
   * exactly the vectors the flick-gesture detection consumes.
   */
  private updateFingerDisplacements() {
    const inv = 1 / this._wuPx;
    for (const finger of this._fingers.values()) {
      if (!finger.active && !finger.lifted) continue;
      finger.d0x = finger.d1x;
      finger.d0y = finger.d1y;
      finger.d1x = (finger.x - finger.prevX) * inv;
      finger.d1y = (finger.y - finger.prevY) * inv;
      finger.prevX = finger.x;
      finger.prevY = finger.y;
    }
  }

  /**
   * 划动触发: decides whether this frame's movement constitutes a new flick
   * gesture, based on the projection of the current displacement onto the
   * previous one, normalized to a 60 fps frame.
   */
  private detectFlicks(deltaSec: number) {
    const dpi = WEB_BASE_DPI * (window.devicePixelRatio || 1);
    const u = (SPEED_UNIT_FACTOR * dpi) / SPEED_UNIT_DPI;
    const k = 1 / (60 * deltaSec);
    for (const finger of this._fingers.values()) {
      if (finger.virtual || (!finger.active && !finger.lifted)) continue;
      const d0len = Math.hypot(finger.d0x, finger.d0y);
      let vRel = 0;
      if (d0len > FLICK_PROJECTION_MIN) {
        vRel = ((finger.d0x * finger.d1x + finger.d0y * finger.d1y) / d0len) * k;
      }
      if (vRel < u || finger.stopped) {
        const v = Math.hypot(finger.d1x, finger.d1y) * k;
        if (v >= u * FLICK_SPEED_FACTOR) {
          finger.isNewFlick = true;
          finger.stopped = false;
        } else {
          finger.isNewFlick = false;
          finger.stopped = true;
        }
      } else {
        // Same ongoing gesture — not a new flick.
        finger.isNewFlick = false;
      }
    }
  }

  /** Writes the finger position relative to the line into `_rax`/`_ray`. */
  private lineRelative(finger: Finger, line: Line) {
    if (finger.virtual) {
      this._rax = 0;
      this._ray = 0;
      return;
    }
    const rotation = line.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dxp = finger.x - line.x;
    const dyp = finger.y - line.y;
    this._rax = (dxp * cos + dyp * sin) / this._wuPx;
    this._ray = (-dxp * sin + dyp * cos) / this._wuPx;
  }

  private noteXWu(note: PlainNote | LongNote) {
    return (note.note.positionX * this._pxPerUnit) / this._wuPx;
  }

  /**
   * Absolute x distance between a note and the finger, in world units. The
   * positionless keyboard finger is treated as exactly on the note.
   */
  private dxWu(note: PlainNote | LongNote, finger: Finger) {
    if (finger.virtual) return 0;
    this.lineRelative(finger, note.line);
    return Math.abs(this.noteXWu(note) - this._rax);
  }

  /** Weighted Manhattan distance between a note and the finger. */
  private metric(note: PlainNote | LongNote, finger: Finger) {
    if (finger.virtual) return 0;
    this.lineRelative(finger, note.line);
    return Math.abs(this.noteXWu(note) - this._rax) + Math.abs(this._ray / METRIC_Y_WEIGHT_DIVISOR);
  }

  /**
   * 点击匹配 (CheckNote): matches at most one note to a click gesture. A
   * matched tap/hold/drag is marked `clickMatched`; flicks are never marked
   * by clicks (红键保护).
   */
  private checkNote(finger: Finger, now: number) {
    const { P, G, B } = this.windows();
    const list = this._notesByTime;

    while (this._clickCursor < list.length && list[this._clickCursor].hitTime < now + B) {
      this._clickCursor++;
    }
    const end = this._clickCursor;
    let start = end;
    while (start > 0 && list[start - 1].hitTime > now - G) start--;

    let best: PlainNote | LongNote | null = null;
    let bestAbsDt = 10000;

    for (let i = start; i < end; i++) {
      const note = list[i];
      if (note.clickMatched) continue;
      const dt = note.hitTime - now;

      const dx = this.dxWu(note, finger);
      if (dx >= TAP_X_RANGE) continue;
      if (dt >= bestAbsDt + MATCH_TIME_EPS) continue;

      const badLimit = dx <= BAD_SHRINK_X ? B : B - (dx - BAD_SHRINK_X) * P * 0.5;
      if (dt > badLimit) continue;

      if (best) {
        const bt = best.note.type;
        if (bt !== 3 && bt !== 4) {
          // Best is a tap/hold: only a simultaneous tap/hold closer to the
          // finger may replace it (黄键保护 / 红键保护 fall out of this).
          const nt = note.note.type;
          if (nt === 3 || nt === 4) continue;
          if (Math.abs(best.hitTime - note.hitTime) > MATCH_TIME_EPS) continue;
          const bestMetric = this.metric(best, finger);
          const noteMetric = this.metric(note, finger);
          if (noteMetric >= bestMetric) continue;
        }
      }

      best = note;
      bestAbsDt = Math.abs(dt);
    }

    if (!best) return;
    if (best.note.type !== 3) best.clickMatched = true;
  }

  /**
   * 红键匹配 (CheckFlick): matches at most one flick to a valid flick
   * gesture, using the wider ±2.1 band and an F-sized time window.
   */
  private checkFlick(finger: Finger, now: number) {
    const F = this.flickRange();
    const list = this._notesByTime;

    while (this._flickCursor < list.length && list[this._flickCursor].hitTime < now + F) {
      this._flickCursor++;
    }
    const end = this._flickCursor;
    let start = end;
    while (start > 0 && list[start - 1].hitTime > now - F) start--;

    let best: PlainNote | null = null;
    let bestAbsDt = 10000;

    for (let i = start; i < end; i++) {
      const note = list[i];
      if (note.isHold || note.note.type !== 3) continue;
      if (note.flickMatched) continue;
      const dt = note.hitTime - now;
      if (dt >= bestAbsDt + MATCH_TIME_EPS) continue;

      const dx = this.dxWu(note, finger);
      if (dx >= WIDE_X_RANGE) continue;

      if (best) {
        if (Math.abs(best.hitTime - note.hitTime) > MATCH_TIME_EPS) continue;
        const bestMetric = this.metric(best, finger);
        const noteMetric = this.metric(note, finger);
        if (noteMetric >= bestMetric) continue;
      }

      best = note;
      bestAbsDt = Math.abs(dt);
    }

    if (!best) return;
    (best as PlainNote).flickMatched = true;
    finger.isNewFlick = false;
  }

  /** Pushes every note whose control should exist by now into `_controls`. */
  private activateControls(now: number) {
    const list = this._notesByTime;
    const horizon = now + Math.max(this.windows().B, this.flickRange());
    while (this._controlCursor < list.length && list[this._controlCursor].hitTime <= horizon) {
      const note = list[this._controlCursor++];
      // Notes that already carry a final judgment (kept across a seek or a
      // partial rewind) have terminated their control lifecycle and must
      // never re-enter it — otherwise a seek would double-judge them.
      if (note.judgmentType === JudgmentType.UNJUDGED) {
        this._controls.push(note);
      }
    }
  }

  /**
   * Evaluates one note's control. Returns true when the control has finished
   * and can be removed from the iteration list.
   */
  private judgeControl(note: PlainNote | LongNote, now: number): boolean {
    if (note.isHold) return this.judgeHold(note, now);
    const dt = note.hitTime - now;
    switch (note.note.type) {
      case 1:
        return this.judgeTapControl(note, dt);
      case 3:
        return this.judgeFlickControl(note, dt);
      case 4:
        return this.judgeDragControl(note, dt);
      default:
        return true;
    }
  }

  /** ClickControl.Judge — 蓝键. */
  private judgeTapControl(note: PlainNote, dt: number): boolean {
    const { P, G } = this.windows();
    if (this._scene.autoplay) {
      // Autoplay guarantees every reached note a Perfect exactly once, even
      // when a seek or high time scale jumps it past its entire window.
      if (dt <= 0) {
        this.hit(JudgmentType.PERFECT, -dt, note);
        return true;
      }
      return false;
    }
    if (!note.clickMatched) {
      if (dt < -G) {
        this.judge(JudgmentType.MISS, note);
        return true;
      }
      return false;
    }
    const absDt = Math.abs(dt);
    if (absDt < P) {
      this.hit(JudgmentType.PERFECT, -dt, note);
    } else if (absDt < G) {
      // dt > 0: the press landed before the note time (early).
      this.hit(dt > 0 ? JudgmentType.GOOD_EARLY : JudgmentType.GOOD_LATE, -dt, note);
    } else {
      this.hit(JudgmentType.BAD, -dt, note);
    }
    return true;
  }

  /** DragControl.Judge — 黄键 (proximity matching and scoring in one). */
  private judgeDragControl(note: PlainNote, dt: number): boolean {
    if (this._scene.autoplay && !note.dragMarked && dt <= DRAG_TIME_RANGE) {
      note.dragMarked = true;
    }
    if (!note.dragMarked && Math.abs(dt) <= DRAG_TIME_RANGE) {
      if (this.anyFingerNear(note, WIDE_X_RANGE)) note.dragMarked = true;
    }
    if (!note.dragMarked) {
      if (dt < -DRAG_TIME_RANGE) {
        this.judge(JudgmentType.MISS, note);
        return true;
      }
      return false;
    }
    if (dt < SCORE_DT_EPS) {
      this.hit(JudgmentType.PERFECT, -dt, note);
      return true;
    }
    return false;
  }

  /** FlickControl.Judge — 红键. */
  private judgeFlickControl(note: PlainNote, dt: number): boolean {
    const F = this.flickRange();
    if (this._scene.autoplay && !note.flickMatched && dt <= 0) note.flickMatched = true;
    // Keyboard play cannot swipe: while any key is held, red keys mark like
    // drags do (the positionless virtual finger sits on every note).
    if (!note.flickMatched && Math.abs(dt) <= F && this._fingers.get(-1)!.active) {
      note.flickMatched = true;
    }
    if (!note.flickMatched) {
      if (dt < -F) {
        this.judge(JudgmentType.MISS, note);
        return true;
      }
      return false;
    }
    if (dt < SCORE_DT_EPS) {
      this.hit(JudgmentType.PERFECT, -dt, note);
      return true;
    }
    return false;
  }

  /** HoldControl.Judge — 长条. */
  private judgeHold(note: LongNote, now: number): boolean {
    const { P, G } = this.windows();
    const dt = note.hitTime - now;
    const tailTime = note.endHitTime;

    // 长条头部
    if (!note.holdHeadHit && !note.holdMissed) {
      if (this._scene.autoplay) {
        // Same completeness guarantee as taps: force a Perfect head hit the
        // first frame at/past the head, however late the control activated.
        if (dt <= 0) {
          note.holdHeadHit = true;
          note.holdHeadPerfect = true;
          note.clickMatched = true;
          this.onHoldHead(note, JudgmentType.PERFECT, -dt);
        }
      } else if (!note.clickMatched) {
        if (dt < -G) {
          this.judge(JudgmentType.MISS, note);
          note.holdMissed = true;
        }
      } else if (Math.abs(dt) < P) {
        note.holdHeadHit = true;
        note.holdHeadPerfect = true;
        this.onHoldHead(note, JudgmentType.PERFECT, -dt);
      } else if (Math.abs(dt) < G) {
        note.holdHeadHit = true;
        note.holdHeadPerfect = false;
        const delta = -dt;
        this.onHoldHead(note, delta < 0 ? JudgmentType.GOOD_EARLY : JudgmentType.GOOD_LATE, delta);
      }
      // G <= |dt|: matched but over-late — head stays unhit (延迟Miss path).
    }

    // 长条中部 — lift protection
    if (note.holdHeadHit && !note.holdMissed && !note.holdJudgeOver) {
      const held = this._scene.autoplay || this.anyFingerNear(note, HOLD_X_RANGE);
      if (held) {
        note.holdSafeFrames = HOLD_SAFE_FRAMES;
      } else if (note.holdSafeFrames < 0) {
        this.judge(JudgmentType.MISS, note);
        note.holdMissed = true;
        note.holdJudgeOver = true;
      } else {
        note.holdSafeFrames--;
      }
    }

    // 长条尾部前 — early settle
    if (
      now > tailTime - HOLD_TAIL_SETTLE &&
      note.holdHeadHit &&
      !note.holdMissed &&
      !note.holdJudgeOver
    ) {
      const final =
        note.tempJudgmentType === JudgmentType.UNJUDGED
          ? note.holdHeadPerfect
            ? JudgmentType.PERFECT
            : JudgmentType.GOOD_LATE
          : note.tempJudgmentType;
      this.judge(final, note);
      note.holdJudgeOver = true;
    }

    // 长条尾部后
    if (now > tailTime + HOLD_TAIL_MISS) {
      if (!note.holdHeadHit && !note.holdMissed && !note.holdJudgeOver) {
        this.judge(JudgmentType.MISS, note);
      }
      return true;
    }
    return note.holdJudgeOver;
  }

  /** Whether any held finger is within `range` along the note's line. */
  private anyFingerNear(note: PlainNote | LongNote, range: number): boolean {
    for (const finger of this._fingers.values()) {
      if (!finger.active) continue;
      if (this.dxWu(note, finger) < range) return true;
    }
    return false;
  }

  /** Head hit of a hold: effects, sound, repeated-effect registration. */
  private onHoldHead(note: LongNote, type: JudgmentType, delta: number) {
    const beat = this._scene.beat;
    try {
      if (
        this._scene.status === GameStatus.PLAYING &&
        (!this._scene.autoplay || Math.abs(delta / this._scene.timeScale) < 1e-1)
      ) {
        this.createHitsound(note);
        this.createHitEffects(type, note);
        this._judgingHolds.push({ note, beatLastExecuted: beat });
        this._judgmentDeltas.push({ delta: delta / this._scene.timeScale, beat });
      }
    } catch (e) {
      console.error('Failed to play hold effects', e);
    }
    note.setTempJudgment(type, beat);
  }

  private updateHoldingEffects() {
    const beat = this._scene.beat;
    for (let i = 0; i < this._judgingHolds.length; i++) {
      const { note, beatLastExecuted } = this._judgingHolds[i];
      if (
        !(
          note.tempJudgmentType !== JudgmentType.UNJUDGED &&
          note.judgmentType === JudgmentType.UNJUDGED
        ) &&
        (note.judgmentType !== JudgmentType.UNJUDGED ||
          this._scene.beat < note.note.startBeat ||
          this._scene.beat > note.note.endBeat)
      ) {
        this._judgingHolds.splice(i, 1);
        continue;
      }
      if (beat - beatLastExecuted >= 0.5 && this._scene.status === GameStatus.PLAYING) {
        this.createHitEffects(note.tempJudgmentType, note);
        this._judgingHolds[i].beatLastExecuted = beat;
      }
    }
  }

  /** Current judgment windows in seconds (standard 宽判 ranges). */
  private windows() {
    const prefs = this._scene.preferences;
    const w = this._windows;
    w.P = prefs.perfectJudgment / 1000;
    w.G = prefs.goodJudgment / 1000;
    w.B = w.G + BAD_EXTRA;
    return w;
  }

  /** Flick time range: F = FLICK_P_FACTOR × P. */
  private flickRange() {
    return (this._scene.preferences.perfectJudgment / 1000) * FLICK_P_FACTOR;
  }

  // ======================================================================
  // Scoring pipeline (effects, sounds, statistics)
  // ======================================================================

  hit(type: JudgmentType, delta: number, note: PlainNote) {
    delta /= this._scene.timeScale;
    const deltaAbs = Math.abs(delta);
    try {
      if (this._scene.status === GameStatus.PLAYING && (!this._scene.autoplay || deltaAbs < 0.1)) {
        if (isPerfectOrGood(type)) {
          this.createHitsound(note);
          this.createHitEffects(type, note);
        } else if (type === JudgmentType.BAD) {
          note.setTint(getJudgmentColor(type).hex);
          this._scene.tweens.add({
            targets: note,
            alpha: 0,
            ease: 'Cubic.easeIn',
            duration: 500,
          });
        }
      }
    } catch (e) {
      console.error('Failed to play hit effects', e);
    }
    this.judge(
      type,
      note,
      this._scene.status === GameStatus.PLAYING &&
        note.note.type === 1 &&
        (!this._scene.autoplay || deltaAbs < 0.1) &&
        (isPerfectOrGood(type) || type === JudgmentType.BAD)
        ? delta
        : undefined,
    );
  }

  judge(type: JudgmentType, note: PlainNote | LongNote, delta?: number) {
    const beat = this._scene.beat;
    note.setJudgment(type, beat);
    if (note.note.type === 2) {
      if (type === JudgmentType.MISS) {
        note.setAlpha(0.5);
      }
    } else if (type !== JudgmentType.BAD) {
      note.setVisible(false);
    }
    switch (type) {
      case JudgmentType.PERFECT:
        this._perfect++;
        break;
      case JudgmentType.GOOD_EARLY:
        this._goodEarly++;
        break;
      case JudgmentType.GOOD_LATE:
        this._goodLate++;
        break;
      case JudgmentType.BAD:
        this._bad++;
        break;
      case JudgmentType.MISS:
        this._miss++;
        break;
    }
    this.countJudgments();
    if (isPerfectOrGood(type)) {
      this._scene.statistics.combo++;
    } else {
      this._scene.statistics.combo = 0;
    }
    this._scene.statistics.updateRecords();
    if (delta) {
      this._judgmentDeltas.push({ delta, beat });
    }
  }

  unjudge(note: PlainNote | LongNote) {
    switch (note.judgmentType) {
      case JudgmentType.PERFECT:
        this._perfect--;
        break;
      case JudgmentType.GOOD_EARLY:
        this._goodEarly--;
        break;
      case JudgmentType.GOOD_LATE:
        this._goodLate--;
        break;
      case JudgmentType.BAD:
        this._bad--;
        break;
      case JudgmentType.MISS:
        this._miss--;
        break;
    }
    this.countJudgments();
    note.reset();
    note.resetControl();
    if (!this._bulkRewinding) {
      this._scene.statistics.updateRecords(true);
    }
  }

  createHitEffectsContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._hitEffectsContainers[depth] = container;
    this._scene.registerNode(container, `hiteffects-${depth}`);
    const layer = new HitParticleLayer(
      this._scene,
      container,
      this._scene.respack.hitEffects.particle,
    );
    this._hitParticleLayers[depth] = layer;
    return container;
  }

  /** Advances hit particles; runs even while paused, like the tweens did. */
  tickHitParticles(delta: number) {
    for (const depth in this._hitParticleLayers) this._hitParticleLayers[depth].tick(delta);
  }

  createHitEffects(type: JudgmentType, note: PlainNote | LongNote) {
    const { x, y } = note.judgmentPosition;
    const depth = note.note.zIndexHitEffects ?? 7;
    this._hitEffectsContainers[depth].add(
      new HitEffects(this._scene, x, y, type).hit(
        rgbToHex(note.note.tintHitEffects),
        this._hitParticleLayers[depth],
      ),
    );
  }

  createHitsound(note: PlainNote | LongNote) {
    if (this._scene.render) return;
    this._scene.sound
      .add(note.note.hitsound ? `asset-${note.note.hitsound}` : note.note.type.toString())
      .setVolume(this._scene.preferences.hitSoundVolume)
      .play();
  }

  countJudgments() {
    this._judgmentCount = this._perfect + this._goodEarly + this._goodLate + this._bad + this._miss;
  }

  rewindDeltas(beat: number) {
    this._judgmentDeltas = this._judgmentDeltas.filter((v) => v.beat <= beat);
  }

  reset() {
    this._judgmentDeltas = [];
  }

  /**
   * Terminates every still-live control at the moment playback ends, so a
   * hold crossing the audio end (or any note caught mid-window) always
   * receives its final judgment and the totals add up.
   *
   * Autoplay resolves every reached note as Perfect; manual play scores
   * matched notes by their state and misses reached-but-unresolved ones.
   * Notes beyond the end time were never reachable and stay unjudged.
   */
  flush(nowTime: number) {
    const autoplay = this._scene.autoplay;
    for (let i = this._controls.length - 1; i >= 0; i--) {
      const note = this._controls[i];
      const reached = note.hitTime <= nowTime;
      if (note.isHold) {
        if (note.holdJudgeOver) continue;
        if (!reached) continue;
        if (autoplay && !note.holdHeadHit) {
          note.holdHeadHit = true;
          note.holdHeadPerfect = true;
          note.clickMatched = true;
        }
        if (note.holdHeadHit && !note.holdMissed) {
          const final =
            note.tempJudgmentType === JudgmentType.UNJUDGED
              ? note.holdHeadPerfect
                ? JudgmentType.PERFECT
                : JudgmentType.GOOD_LATE
              : note.tempJudgmentType;
          this.judge(final, note);
        } else {
          this.judge(JudgmentType.MISS, note);
        }
        note.holdJudgeOver = true;
        continue;
      }
      const dt = note.hitTime - nowTime;
      switch (note.note.type) {
        case 1: {
          if (!reached) break;
          if (autoplay || note.clickMatched) {
            if (autoplay) {
              this.judge(JudgmentType.PERFECT, note);
            } else {
              const absDt = Math.abs(dt);
              const { P, G } = this.windows();
              this.judge(
                absDt < P
                  ? JudgmentType.PERFECT
                  : absDt < G
                    ? dt > 0
                      ? JudgmentType.GOOD_EARLY
                      : JudgmentType.GOOD_LATE
                    : JudgmentType.BAD,
                note,
              );
            }
          } else {
            this.judge(JudgmentType.MISS, note);
          }
          break;
        }
        case 3: {
          if (!reached) break;
          if (note.flickMatched || autoplay) {
            this.judge(JudgmentType.PERFECT, note);
          } else {
            this.judge(JudgmentType.MISS, note);
          }
          break;
        }
        case 4: {
          if (!reached) break;
          if (note.dragMarked || autoplay) {
            this.judge(JudgmentType.PERFECT, note);
          } else {
            this.judge(JudgmentType.MISS, note);
          }
          break;
        }
      }
    }
    this._controls.length = 0;
    this._judgingHolds.length = 0;
  }

  /**
   * Fast-forwards the control pipeline to `nowTime`, applying every judgment
   * playback would have produced by that moment — autoplay resolves reached
   * notes as Perfect, manual play misses untouched ones — so statistics
   * already reflect a seek target right after the seek instead of only after
   * resuming. Silent while paused: effects, hitsounds and std-dev deltas
   * stay reserved for genuinely judged input. Notes beyond the control
   * horizon remain pending as live controls for normal playback.
   */
  resolveUpTo(nowTime: number) {
    this._wuPx = this._scene.sys.canvas.height / 10;
    this._pxPerUnit = this._scene.p(1);
    this.activateControls(nowTime);
    for (let i = this._controls.length - 1; i >= 0; i--) {
      const note = this._controls[i];
      if (this.judgeControl(note, nowTime)) {
        this._controls[i] = this._controls[this._controls.length - 1];
        this._controls.pop();
      }
    }
  }

  /**
   * Full rewind/reset of the judgment state (seek or restart): rebuilds the
   * slicing cursors, drops all live controls, un-judges notes whose judgment
   * lies ahead of the new time, and clears gesture queues.
   */
  resetWindow(beat: number) {
    this._clickCursor = 0;
    this._flickCursor = 0;
    this._controlCursor = 0;
    this._controls.length = 0;
    this._pendingClicks.length = 0;
    this._pendingKeyboardFlicks = 0;
    this._judgingHolds.length = 0;
    for (const finger of this._fingers.values()) {
      finger.isNewFlick = false;
      finger.stopped = true;
      finger.lifted = false;
      finger.d0x = finger.d0y = finger.d1x = finger.d1y = 0;
      if (!finger.virtual) {
        finger.prevX = finger.x;
        finger.prevY = finger.y;
      }
    }
    this._bulkRewinding = true;
    try {
      for (const note of this._notesByTime) {
        let invalidated = false;
        if (note.beatJudged !== undefined && beat < note.beatJudged) {
          this.unjudge(note);
          invalidated = true;
        } else if (note.beatTempJudged !== undefined && beat < note.beatTempJudged) {
          note.resetTemp();
          invalidated = true;
        }
        // Control flags are cleared only for notes that are unjudged after
        // the rewind; already-scored notes keep them so the matchers can
        // never re-match a scored note through the over-late interval quirk.
        if (invalidated || note.judgmentType === JudgmentType.UNJUDGED) {
          note.resetControl();
        }
      }
    } finally {
      this._bulkRewinding = false;
    }
    this.rewindDeltas(beat);
    this._scene.statistics.updateRecords(true);
  }

  public get perfect() {
    return this._perfect;
  }

  public get goodEarly() {
    return this._goodEarly;
  }

  public get goodLate() {
    return this._goodLate;
  }

  public get bad() {
    return this._bad;
  }

  public get miss() {
    return this._miss;
  }

  public get judgmentCount() {
    return this._judgmentCount;
  }

  public get judgmentDeltas() {
    return this._judgmentDeltas;
  }
}
