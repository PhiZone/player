# PhiZone Player

PhiZone Player is an HTML5 Phigros chart player/simulator based on Phaser.

### Frameworks

This project is made possible by:

- [Phaser](https://github.com/phaserjs/phaser)
- [Svelte](https://github.com/sveltejs/kit)
- [Vite](https://github.com/vitejs/vite)
- [TypeScript](https://github.com/microsoft/TypeScript)

## Requirements

[`pnpm`](https://pnpm.io) is required to install dependencies and run scripts.

## Commands

| Command      | Description                                     |
| ------------ | ----------------------------------------------- |
| `pnpm i`     | Install project dependencies                    |
| `pnpm dev`   | Launch a development web server                 |
| `pnpm build` | Create a production build in the `build` folder |

## Assets

Game assets are stored in `./static/game`. A tree view of the folder is as follows:

```
game
│  ClickEffects.png
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
└─notes
        .gitkeep
        Drag.png
        DragHL.png
        Flick.png
        FlickHL.png
        Hold.png
        HoldEnd.png
        HoldEndHL.png
        HoldHead.png
        HoldHeadHL.png
        HoldHL.png
        Tap.png
        TapHL.png
```

According to [a statement from Pigeon Games](https://www.bilibili.com/opus/624904779363026292), assets from Phigros are copyrighted, and their appearance in other software is legally prohibited. This restriction applies to all assets in this folder except for `Pause.svg` (by Font Awesome, licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0)) and `ending/GradeHit.wav` (by Naptie with sound effects on [Pixabay](https://pixabay.com), licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)). If you wish to run this program on your own, please be sure to append the missing assets as aforementioned.

## Development

| Feature                                    | Version | Remark                                    | Progress   | 功能                    |
| ------------------------------------------ | ------- | ----------------------------------------- | ---------- | ----------------------- |
| Basic RPE support                          | 0.0.1   |                                           | ✅ Done    | 基本 RPE 适配           |
| Support for custom line textures           | 0.0.1   |                                           | 🚧 Working | 判定线自定义贴图适配    |
| Support for mirroring modes                | 0.0.1   |                                           |            | 镜像模式适配            |
| Support for custom hit sounds              | 0.0.1   |                                           |            | 自定义打击音效适配      |
| Better input detections                    | 0.0.2   | Especially for Flicks                     |            | 输入检测优化            |
| Recording mode                             | 0.0.2   |                                           |            | 录制模式                |
| Basic support for the extended event layer | 0.0.3   | Excluding GIF events & incline events     |            | 扩展事件层的基本适配    |
| Support for `zOrder`                       | 0.0.3   |                                           |            | Z 轴排序适配            |
| Support for bezier easings                 | 0.0.4   |                                           |            | 贝塞尔缓动适配          |
| Alignment with official/RPE constants      | 0.0.4   | Hold tolerances, texture size units, etc. |            | 官/RPE 常数对齐         |
| Support for Phira `extra.json`             | 0.0.5   | Including shaders                         |            | Phira `extra.json` 适配 |
| Full support for the extended event layer  | 0.0.6   | GIF events & incline events               |            | 扩展事件层的完全适配    |
| Support for all note properties            | 0.0.7   |                                           |            | 所有 Note 属性的适配    |
| PhiZone integration                        | 0.0.8   |                                           |            | PhiZone 集成            |
| Full RPE support                           | 0.1.0   |                                           |            | 完全 RPE 适配           |
| Basic PE support                           | 0.1.1   |                                           |            | 基本 PE 适配            |

## Deployments

We're unable to provide an official deployment (which is to be available at https://player.phi.zone/) due to lack of proper game assets. Anyone willing to provide a properly licensed set of assets and allow us to use and distribute it is welcome to contact us at [contact@phi.zone](mailto:contact@phi.zone) or instead create a pull request in this repository.

&copy; PhiZone.

Some rights reserved.
