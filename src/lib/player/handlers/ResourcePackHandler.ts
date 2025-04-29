import {
  JudgmentType,
  type BitmapFont,
  type Font,
  type GradeLetterName,
  type HitEffects,
  type HitSoundName,
  type LevelType,
  type NoteSkinName,
  type ResourcePack,
} from '$lib/types';
import { DEFAULT_RESOURCE_PACK } from '../constants';
import { getJudgmentColor, isPerfectOrGood, rgbaToHexAndAlpha } from '../utils';

export class ResourcePackHandler {
  private _pack: ResourcePack<string>;

  constructor(pack: ResourcePack<string>) {
    this._pack = pack;
  }

  getNoteSkin(name: NoteSkinName) {
    return (
      this._pack.noteSkins.find((e) => e.name === name) ??
      DEFAULT_RESOURCE_PACK.noteSkins.find((e) => e.name === name)!
    ).file;
  }

  getHitSound(name: HitSoundName) {
    return (
      this._pack.hitSounds.find((e) => e.name === name) ??
      DEFAULT_RESOURCE_PACK.hitSounds.find((e) => e.name === name)!
    ).file;
  }

  getHitEffects() {
    return this.hitEffects;
  }

  getHitEffectsColor(type: JudgmentType) {
    let color;
    if (isPerfectOrGood(type)) {
      color =
        type === JudgmentType.PERFECT
          ? this._pack.hitEffects?.colorPerfect
          : this._pack.hitEffects?.colorGood;
    }
    return rgbaToHexAndAlpha(color) ?? getJudgmentColor(type);
  }

  getGrade(name: GradeLetterName) {
    return (
      this._pack.ending.grades.find((e) => e.name === name) ??
      DEFAULT_RESOURCE_PACK.ending.grades.find((e) => e.name === name)!
    ).file;
  }

  getResultsMusic(levelType: LevelType) {
    return (
      this._pack.ending.music.find((e) => e.levelType === levelType) ??
      DEFAULT_RESOURCE_PACK.ending.music.find((e) => e.levelType === levelType)!
    );
  }

  getFont(name: string) {
    return (
      this._pack.fonts.find((e) => e.name === name) ??
      DEFAULT_RESOURCE_PACK.fonts.find((e) => e.name === name)!
    );
  }

  isHoldBodyRepeat() {
    return this._pack.options?.holdBodyRepeat ?? false;
  }

  isHoldCompact() {
    return this._pack.options?.holdCompact ?? false;
  }

  isHoldKeepHead() {
    return this._pack.options?.holdKeepHead ?? false;
  }

  public get name() {
    return this._pack.name;
  }

  public get author() {
    return this._pack.author;
  }

  public get description() {
    return this._pack.description;
  }

  public get thumbnail() {
    return this._pack.thumbnail;
  }

  public get noteSkins() {
    return this._pack.noteSkins.length > 0 ? this._pack.noteSkins : DEFAULT_RESOURCE_PACK.noteSkins;
  }

  public get hitSounds() {
    return this._pack.hitSounds.length > 0 ? this._pack.hitSounds : DEFAULT_RESOURCE_PACK.hitSounds;
  }

  public get hitEffects() {
    return (this._pack.hitEffects ?? DEFAULT_RESOURCE_PACK.hitEffects) as HitEffects<string>;
  }

  public get grades() {
    return this._pack.ending.grades.length > 0
      ? this._pack.ending.grades
      : DEFAULT_RESOURCE_PACK.ending.grades;
  }

  public get resultsMusic() {
    return this._pack.ending.music.length > 0
      ? this._pack.ending.music
      : DEFAULT_RESOURCE_PACK.ending.music;
  }

  public get fonts() {
    const fonts = this._pack.fonts.filter((f) => f.type !== 'bitmap');
    return (
      fonts.length > 0 ? fonts : DEFAULT_RESOURCE_PACK.fonts.filter((f) => f.type !== 'bitmap')
    ) as Font<string>[];
  }

  public get bitmapFonts() {
    const fonts = this._pack.fonts.filter((f) => f.type === 'bitmap');
    return (
      fonts.length > 0 ? fonts : DEFAULT_RESOURCE_PACK.fonts.filter((f) => f.type === 'bitmap')
    ) as BitmapFont<string>[];
  }
}
