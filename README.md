# INKWAVE RALLY · 网球机器人对决

这个分支的默认首页现为轻量的 **3D 网球机器人对战**，同时保留自动发球的 **60 秒落点练习**。在首页选择模式和 Easy / Normal 难度，点击开始即可。

```bash
npm run serve         # http://localhost:8490，无需安装依赖或构建
npm run test:tennis   # 网球规则、物理与有界喷墨特效测试
npm run check        # 全仓库 JavaScript 语法检查
npm run build        # 生成可静态托管的 dist/
```

- **移动**：WASD / 方向键，跑到来球附近再击球。
- **瞄准**：将鼠标移到对面球场，或按 1 / 2 / 3 选择左、中、右落点。
- **挥拍**：按住空格或鼠标左键蓄力，在脚下圆环亮起、界面显示「可以击球」时松开。对战中的接触时机、身体与球的距离、蓄力会影响落点和球速；更长蓄力的回球更快、弧线更低。
- **发球**：轮到你发球时按住并松开，角色抛球后自动瞄准对角发球区。对战采用街机单次发球规则：发球失误直接失分，接发球必须先落地。
- **对战计分**：先到 7 分且领先 2 分获胜。球首次在对方场内落地后回合继续，两次落地、触网、出界或落错半场会判分。首分你发球，之后每人连续发两分。机器人有移动速度、反应和精度限制。
- **练习计分**：回球首次落入三个靶区得 100 / 150 / 100 分，连击最高 5 倍；有效落在其他位置得 25 分，60 秒后结算。
- **暂停与切换**：Escape 或暂停按钮。切换页面或窗口失焦自动暂停；暂停/结算面板可返回球会重新选择模式，或重开一轮。
- **INKWAVE 喷墨动效**：粗队色球尾、大幅挥拍弧光、大颗墨滴、不规则落地墨迹、满蓄力光环、漫画式 SERVE / SMASH / PERFECT 字效、得分扫色和短促镜头冲击。角色有夸张蓄力、发球跃起与随挥动作；墨迹只影响外观，不改变比赛规则。顶部「动效」开关可关闭装饰效果，也遵循系统的减少动态设置。固定复用 96 个墨滴和 32 个墨迹槽位，暂停/隐藏页面不持续渲染。声音默认关闭。
- **节省资源**：渲染上限 30 FPS、像素比上限 1.25；待机和暂停不循环渲染，结束后的庆祝最多持续两秒。特效重复利用固定数量的对象。服务器终端按 Ctrl+C 退出，关闭游戏页释放图形资源。

原版喷墨游戏保留在 [http://localhost:8490/?game=inkwave](http://localhost:8490/?game=inkwave)。`map`、`autostart`、`nofullscreen` 等旧版游戏参数仍指向原版；普通跟踪参数仍打开网球。`?game=tennis` 显式选择网球，`?game=tennis&play=practice` 直达练习，`?game=tennis&difficulty=easy` 选择轻松难度。练习规则在 `src/tennis/simulation.js`，对战规则在 `src/tennis/duel.js`，场景、输入和界面在同目录。设计和规则见 [DESIGN.md](DESIGN.md) 与 [docs/TENNIS-DUEL.md](docs/TENNIS-DUEL.md)。目前为本地单人对电脑，不包含联网对战或完整盘/局规则。触屏控件保留，尚未经过手机实机验证。

---

以下为原版 INKWAVE 说明。

<p align="center">
  <img src="assets/stages/halyard-day.webp" alt="Halyard Marina at golden hour" width="100%">
</p>

<h1 align="center">INKWAVE</h1>

<p align="center">
  An original Splatoon-style 4v4 turf-war shooter that runs in your browser.<br>
  Paint the ground, swim through your ink, out-turf the other team.
</p>

<p align="center">
  <a href="https://inkwave-aah.pages.dev"><b>▶ Play now</b></a> ·
  <a href="#controls">Controls</a> ·
  <a href="#playing-online">Online</a> ·
  <a href="#running-locally">Run locally</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/jaydendavisnc/inkwave/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jaydendavisnc/inkwave/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="three.js r186" src="https://img.shields.io/badge/three.js-r186-000000?logo=three.js&logoColor=white">
  <img alt="No build step" src="https://img.shields.io/badge/build-none%20needed-2ea44f">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

---

## Features

- **Game modes, 4 v 4.** Turf War (most ground painted wins) and Zone Control (hold the live zone to count down from 100 — rotating side zones, penalties, overtime). Play against bots on three difficulty levels.
- **Online with friends.** Create a private room, share the five-character code, and up to eight players line up in the lobby with their loadouts and looks. Empty slots fill with bots; if someone drops, a bot takes over their squidkid mid-match.
- **Squid form.** Hold to dive into your ink: swim fast, refill your tank, climb inked walls, dolphin-jump water gaps.
- **Twelve weapons**, each with its own feel: Spritzer, Twinfire Pistols, Canopy Brolly (shotgun + launchable shield), Popper Blaster, Squall Spinner, Glint Charger, Tideline Bow (tri-arrow, two charge rings), Swell Roller, Swish Brush, Brine Cutlass (charged one-hit blade), Sponge Mitts (ink fists, charged leap, wall cling) and Bilge Bucket. Mix any main with any of 15 subs and 19 specials.
- **Seven stages, day or dusk.** Tidewater Plaza, Kelpline Terminal, Halyard Marina, Saltpan Basin, Crossroads Market, Lockgate Canals and Terrace Heights, each a real place with its own layout. Some stages change a few pieces for Zone Control.
- **Ink that behaves like liquid.** Splats spread and settle, fresh ink is glossy and dries, drips run down walls, and swimming leaves a wake in the surface itself.
- **A map you can actually read.** Hold <kbd>Tab</kbd> and the camera cranes up into a tilt-shift diorama of the live stage, with pins for your team and one-click Super Jumps.
- **Locker.** Choose your squidkid: tentacle style, headgear, face, outfit.
- **Everything procedural.** Characters, animation, weapons, textures, props, sound effects and music are all generated in code. There are no downloaded assets except two fonts.

<p align="center">
  <img src="assets/stages/tidewater-day.webp" width="49%" alt="Tidewater Plaza">
  <img src="assets/stages/kelpline-dusk.webp" width="49%" alt="Kelpline Terminal at dusk">
</p>

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Left stick |
| Aim | Mouse | Right stick |
| Fire | Left click | RT |
| Squid form | <kbd>Shift</kbd> | LT |
| Jump / dodge roll | <kbd>Space</kbd> | A |
| Sub weapon (bomb) | Right click / <kbd>E</kbd> | RB |
| Special | <kbd>F</kbd> | Y |
| Map + Super Jump | Hold <kbd>Tab</kbd> or <kbd>M</kbd>, then <kbd>1</kbd>–<kbd>4</kbd> or click a pin | View |
| Pause | <kbd>Esc</kbd> | Start |

Gamepads work on the hosted (https) version. On a plain `http://` LAN address browsers block the Gamepad API.

## Playing online

From the main menu choose **Online**, then **Create a room** and send your friends the code (or **Join a room** and
type theirs). The host picks the stage, time of day, match length and whether bots fill empty slots; everyone else
picks a team, weapon and look and readies up. The lineup, emotes and ready state are live for everyone in the room.

Rooms run on a tiny relay (a Cloudflare Worker with one Durable Object per room, in [`server/`](server)). It only
forwards messages: every player simulates their own squidkid and streams it, and everyone else draws it through the
same animation system on a smoothed timeline about a tenth of a second behind. How that works, and the tools used to
measure it, are in [`docs/NET.md`](docs/NET.md).

To play online on your own network, run the relay next to the game:

```bash
npm install      # once: the relay runs on wrangler
npm run relay    # ws://<this machine>:8787
```

A page opened from `localhost` or a LAN address uses that relay automatically; `?relay=wss://…` points it anywhere else.

## Running locally

There is no build step. Any static file server works; the included one also serves to your LAN and sends no-cache headers so module updates are never stale.

```bash
git clone https://github.com/jaydendavisnc/inkwave.git
cd inkwave
npm install      # Electron + the headless tools
npm start        # the desktop app (Electron)
npm run serve    # or the web version: http://localhost:8490
npm run package  # build the macOS app into dist/ (arm64 + x64)
```

Optional: drop your own music into `songs/` (see [`songs/README.md`](songs/README.md)); otherwise the procedural soundtrack plays.

Useful URL parameters: `?map=halyard&time=dusk` picks a stage, `&autostart=180` skips the menus into a 180 s match, `&autopilot` lets a bot drive you.

```bash
npm install      # once, for the headless tools
npm run check    # syntax-check every module
npm run smoke    # boot + 8 s of autopilot in headless Chrome, fails on console errors
npm run build    # assemble dist/ (game + only the three.js addons it imports)
npm run check-maps   # sanity-check every stage layout (and its Zone Control variant)
```

Bot matches run headless and muted for tuning: `MAP=halyard MODE=turf SECS=180 npm run botlab` (see [`tools/botlab/README.md`](tools/botlab/README.md)).
With the relay running, `npm run net-test` plays a real match between headless clients and reports what each
screen drew (see [`docs/NET.md`](docs/NET.md#how-the-netcode-works-srcnetnetmatchjs)).

## How it works

- **Ink is painted in texture space.** Every paintable face owns a region of one 4K atlas; splats are drawn into it on the GPU while a coarse CPU grid keeps the turf score and gameplay queries in sync. The level shader layers the ink over the surface with its own height, gloss and wetness. See [`src/world/paint.js`](src/world/paint.js) and [`src/world/inkShading.js`](src/world/inkShading.js).
- **Stages are data.** A layout is a list of boxes and ramps for one half of the arena; the other half is the 180° rotation, so both teams always get an identical field. Ambient occlusion is baked offline (`tools/bake-ao.mjs`). See [`src/world/maps.js`](src/world/maps.js).
- **Characters are fully procedural.** Geometry, materials, a 60-bone rig and every animation (locomotion, squid form, weapon poses, secondary motion) are code, driven by a spring-based pose system. See [`docs/RIG.md`](docs/RIG.md).
- **Systems talk through events.** Weapons, actors and the match emit typed events; effects, HUD and audio subscribe. The contract is documented in [`docs/EVENTS.md`](docs/EVENTS.md) and [`docs/CONTRACTS.md`](docs/CONTRACTS.md).
- **Deterministic tooling.** The game exposes a freeze/step debug interface so filmstrips, handling measurements and bot simulations are reproducible frame by frame (`tools/film.py`, `tools/measure-handling.mjs`).

Rendering is three.js r186 (vendored, plain ES modules with an import map) with GTAO, bloom and a custom grade pass.

## Browser support

Chrome and Edge are the target; Firefox works. Safari runs but is slower. A discrete or recent integrated GPU is recommended for the High preset; the settings menu has Medium and Low tiers.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and the checks to run first.

## License

[MIT](LICENSE) © 2026 Jayden Davis. INKWAVE is an independent project and is not affiliated with Nintendo; Splatoon is a trademark of Nintendo.
