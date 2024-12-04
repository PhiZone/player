# PhiZone Player

PhiZone Player is an HTML5 Phigros chart player/simulator based on Phaser.

### Frameworks

This project is made possible by:

- [Phaser](https://github.com/phaserjs/phaser)
- [Svelte](https://github.com/sveltejs/kit)
- [Vite](https://github.com/vitejs/vite)
- [TypeScript](https://github.com/microsoft/TypeScript)

## Introduction

Much of this program resembles any other Phigros chart player/simulator, and thus we'll only cover some unique features in this section.

### User-friendly landing page

Designed with [Preline UI](https://preline.co) and [daisyUI](https://daisyui.com), the landing page is meticulously written to be as intuitive yet powerful as possible.

Choose either some files (or .zip/.pez archives) or an entire folder, and chart bundles will be automatically detected according to Re: PhiEdit (or RPE) metadata files (typically named `info.txt`) in which a chart, a song, and an illustration are specified. Any other files that fail to be recognized, which are most likely multimedia that will be referenced by the chart, or the `extra.json` from Phira, will be presented in the assets.

### Original line & note properties

Aside from adding support for RPE features, we've also designed some original properties for judgment lines & notes.

| Property         | Values                                      | Example                         | Description                                                                |
| ---------------- | ------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `scaleOnNotes`   | `0`: none; `1`: scale; `2`: clip            | `"scaleOnNotes": 2`             | Belongs to a judgment line. Decides how `scaleX` events will affect notes. |
| `tint`           | [R, G, B], as seen in `colorEvents`; `null` | `"tint": [255, 0, 0]`           | Belongs to a note. Sets the tint for the note.                             |
| `tintHitEffects` | [R, G, B], as seen in `colorEvents`; `null` | `"tintHitEffects": [255, 0, 0]` | Belongs to a note. Sets the tint for the hit effects of the note.          |

### Keyboard controls for autoplay

Similar to a video player, the program includes intuitive keyboard controls on autoplay mode:

- Pause/Resume: Press <kbd>Space</kbd> to toggle.
- Rewind/Forward: Use <kbd>←</kbd> / <kbd>→</kbd> to jump 5 seconds, or <kbd>⇧ Shift</kbd>+<kbd>←</kbd> / <kbd>⇧ Shift</kbd>+<kbd>→</kbd> for precise 0.1-second adjustments.

## Requirements

[`pnpm`](https://pnpm.io) is required to install dependencies and run scripts.

## Commands

| Command      | Description                                     |
| ------------ | ----------------------------------------------- |
| `pnpm i`     | Install project dependencies                    |
| `pnpm dev`   | Launch a development web server                 |
| `pnpm build` | Create a production build in the `build` folder |

## Development

| Feature                                    | Version | Remark                                                                        | Status/Progress           | 功能                    |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------- | ------------------------- | ----------------------- |
| Basic RPE support                          | 0.0.1   |                                                                               | ✅ Done                   | 基本 RPE 适配           |
| Support for custom line textures           | 0.0.1   |                                                                               | ⚠️ Issues expected (GIFs) | 判定线自定义贴图适配    |
| Support for flipping modes                 | 0.0.1   |                                                                               | ✅ Done                   | 镜像模式适配            |
| Support for custom hit sounds              | 0.0.1   |                                                                               | ✅ Done                   | 自定义打击音效适配      |
| Support for `zOrder`                       | 0.0.1   |                                                                               | ✅ Done                   | Z 轴排序适配            |
| Better input detections                    | 0.0.2   | Especially for Flicks                                                         |                           | 输入检测优化            |
| Recording mode                             | 0.0.2   |                                                                               | 🚧 Working                | 录制模式                |
| Basic support for the extended event layer | 0.0.3   | Excluding GIF events & incline events                                         | ✅ Done                   | 扩展事件层的基本适配    |
| Cross-platform distribution                | 0.0.3   | Plan to reference [this blog](https://nsarrazin.com/blog/sveltekit-universal) |                           | 跨平台分发              |
| Support for Phira `extra.json`             | 0.0.4   | Including shaders                                                             | 🛠️ Tests required         | Phira `extra.json` 适配 |
| Support for `attachUI`                     | 0.0.4   |                                                                               | ✅ Done                   | UI 绑定适配             |
| Support for Bézier easings                 | 0.0.4   |                                                                               |                           | 贝塞尔缓动适配          |
| Alignment with official/RPE constants      | 0.0.5   | Hold tolerances, texture size units, etc.                                     |                           | 官/RPE 常数对齐         |
| Offset adjustment mode                     | 0.0.5   |                                                                               |                           | 延迟调整模式            |
| Full support for the extended event layer  | 0.0.6   | GIF events & incline events                                                   |                           | 扩展事件层的完全适配    |
| Support for all note properties            | 0.0.7   |                                                                               |                           | 所有 Note 属性的适配    |
| PhiZone integration                        | 0.0.8   |                                                                               |                           | PhiZone 集成            |
| Full RPE support                           | 0.1.0   |                                                                               |                           | 完全 RPE 适配           |
| Basic PE support                           | 0.1.1   |                                                                               |                           | 基本 PE 适配            |

A version is reached whenever at least one feature from this version and all features from the previous versions are marked as `✅ Done`.

## Assets

Game assets are stored in `./static/game`. A tree view of the folder is as follows:

```
game
│  HitEffects.png
│  line.png
│  Pause.svg
│  Progress.png
│
├─ending
│      GradeHit.wav
│      LevelOver0.wav
│      LevelOver1.wav
│      LevelOver2.wav
│      LevelOver3.wav
│      LevelOver4.wav
│
├─grades
│      .gitkeep
│      A.png
│      B.png
│      C.png
│      F.png
│      Phi.png
│      S.png
│      V-FC.png
│      V.png
│
├─hitsounds
│      .gitkeep
│      Drag.wav
│      Flick.wav
│      Tap.wav
│
├─notes
│      .gitkeep
│      Drag.png
│      DragHL.png
│      Flick.png
│      FlickHL.png
│      Hold.png
│      HoldEnd.png
│      HoldEndHL.png
│      HoldHead.png
│      HoldHeadHL.png
│      HoldHL.png
│      Tap.png
│      TapHL.png
│
└─shaders
        chromatic.glsl
        circle_blur.glsl
        fisheye.glsl
        glitch.glsl
        grayscale.glsl
        noise.glsl
        pixel.glsl
        radial_blur.glsl
        shockwave.glsl
        vignette.glsl
```

According to [a statement from Pigeon Games](https://www.bilibili.com/opus/624904779363026292), assets from Phigros are copyrighted, and their appearance in other software is legally prohibited. This restriction applies to all assets in this folder except for all shaders (`shaders/*`, the majority of which are licensed under MIT/CC0, with a few exceptions from [ShaderToy](https://www.shadertoy.com) licensed under the default [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) license specified by the site), `Pause.svg` (by Font Awesome, licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)) and `ending/GradeHit.wav` (by Naptie with sound effects on [Pixabay](https://pixabay.com), licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). If you wish to run this program on your own, please be sure to append the missing assets as aforementioned.

## Deployments

We're unable to provide an official deployment (which is to be available at https://player.phi.zone) due to lack of proper game assets. Anyone willing to provide a properly licensed set of assets and allow us to use and distribute it is welcome to contact us at [contact@phi.zone](mailto:contact@phi.zone) or instead create a pull request in this repository.

## Stargazers over time

[![Stargazers over time](https://starchart.cc/PhiZone/player.svg?variant=adaptive)](https://starchart.cc/PhiZone/player)

&copy; PhiZone.

Some rights reserved.
