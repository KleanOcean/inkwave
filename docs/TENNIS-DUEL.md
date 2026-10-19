# Tennis duel implementation contract

Approved scope (2026-10-19): playable local 1v1 versus a finite-speed bot, Easy/Normal, first to 7 points with a two-point lead, alternating serves, meaningful shot timing/position/power, and richer bounded animation. Preserve the 60-second target practice mode. No dependencies or networking. Default mode is duel. Keep the user's local server running after delivery.

## Simulation boundary

`src/tennis/duel.js` exports `DuelSession`. Constructor `{difficulty='normal',random=Math.random,onEvent=()=>{}}`. Public `start()`, `pause()`, `resume()`, `update(dt,input={moveX:0,moveZ:0})`, `canHit()`, `canServe()`, `swing(charge,aim)`, `predictShot(charge,aim)`, `snapshot()`.

Snapshot: `mode:'duel'`, `phase:'ready'|'playing'|'paused'|'finished'`, `elapsed`, `player:{x,z}`, `bot:{x,z}`, `ball:{x,y,z,vx,vy,vz,active,state:'incoming'|'outgoing'|'waiting',lastHitter}`, `points:{player,bot}`, `winner:null|'player'|'bot'`, `difficulty`, `server:'player'|'bot'`, `rallyState:'serve'|'toss'|'rally'|'between'`, `rally`, `bestRally`, `returns`, `misses`, `canServe` (optional derived field). `remaining`, `score`, `combo`, `bestCombo`, `feeds`, `targetHits` may be provided as compatibility fields but duel UI must use duel fields.

Near-side player uses +Z; far-side bot uses -Z. Court constants come from `simulation.js`. Movement is normalized and bounded to the player's half. Human releases a swing to initiate a manual serve; auto bot serves have a visible delay. Both show a ~0.4s toss before the struck ball enters the rally. Serve sequence: player serves point 0; bot serves points 1 and 2; player points 3 and 4; continue in blocks of two. Diagonal service box first bounce required; receiving a serve before its first bounce loses the point. One-fault arcade serves (no second serve) must be stated in UI/docs.

Rallies survive the first legal bounce; a second bounce wins the last hitter a point. Net/out/wrong half loses the point for the hitter. Point score is awarded once; delay ~1.8s between points. Winning by two at >=7 freezes simulation, then visual celebration may finish for <=2s. All clocks, AI and inputs freeze while paused. Difficulty affects finite movement speed, reaction and shot precision, without teleporting or manufactured score events.

Events keep existing `start`, `pause`, `resume`, `finish`, `hit`, `bounce`, `swing-miss` names. New events:
- `serve-toss`: `{actor:'player'|'bot',x,y,z}`
- `serve`: `{actor,stroke:'serve',x,y,z,charge}`
- `hit`: `{actor,stroke:'forehand'|'backhand',quality:0..1,timing:'perfect'|'good'|'late',charge,x,y,z,aimX,aimZ}`
- `bounce`: `{x,z,side:'player'|'bot'}`
- `point`: `{winner:'player'|'bot',reason:'net'|'out'|'double-bounce'|'wrong-side'|'serve-fault'|'serve-volley',points:{player,bot},rally,x,z}`
- `finish`: `{winner,points}`

Contact quality and power affect velocity and landing; `predictShot()` must be read-only and deterministic (no RNG consumption). Ball physics uses fixed substeps and swept net/floor tests. Never insert synthetic scoring for QA.

## Controller, interface and scene

Controller (`game.js`) chooses session, passes the same movement/aim/hold-release inputs to both, wires cancel separately from release, and exposes read-only snapshots. UI callbacks add `onModeChange('duel'|'practice')`, `onDifficultyChange('easy'|'normal')`, `onEffectsToggle()` to the existing API.

UI `render(snapshot,extras)` gets `extras.mode`, `difficulty`, `effects`, `canServe` plus existing charge/canHit/aim/muted. Ready screen selects mode and difficulty. Duel HUD shows You/Bot points, server, current rally; practice keeps time and target scores. Duel results show winner/points/best rally. Explain arcade single-fault serve. Point and contact feedback must describe real simulation events. Keep keyboard focus, cancellation and reduced-motion behavior.

Scene API stays `new TennisCourt(container)`, `render(snapshot,extras)`, `notify(event)`, `resize()`, `aimAt()`, `dispose()`. `extras.mode` and `effects` select opponent versus training props, and enable bounded procedural effects. Optional `isAnimating()` allows a short final celebration after simulation finishes. No perpetual rendering in ready/paused/finished. Reduced motion or effects-off suppresses particles, trails, shake and decorative UI motion, while movement/ball/racket remain readable.

Visuals: distinct coral human/lavender bot, running/weight-shift, forehand/backhand follow-through, toss/serve, a short ball trail, bounce rings, contact sparks/dust, score pulse and victory reaction. Pool effects; do not allocate textures, meshes or materials every frame. Reuse the current cream/green/lime/coral/lavender palette and local fonts.

## Required evidence

Node tests: existing practice/route suite stays green; deterministic legal multi-shot rally; finite bot motion and difficulty; serve order/service fault; net/out/double-bounce/serve volley; single scoring; 7-point/two-point-lead finish; pause/restart; shot quality/power effects; dt partition stability.

Browser: choose difficulty/mode, manual serve+toss, a real bot return and human hit, real point progression, pause/resume/restart, practice still scores, effects on/off changes actual scene state, no runtime errors. Inspect one gameplay screenshot and one animation/point screenshot. No physical-mobile claim without device evidence. Preserve the running local server; close only the QA tab at completion.

## INKWAVE ink motion

`effects.js` renders thick camera-facing mesh ribbons (not one-pixel WebGL lines), team-colored racket slashes, 96 pooled droplet instances, 32 pooled irregular ground splats and six expanding landing rings. Ground ink lives for at most 12 seconds and is purely decorative. Hits/serves reset ribbon history so a new direction does not connect across a contact. Charge aura is visible only while actually charging in play. Static paint does not extend the finished-state rendering window.

The court passes `{ charge, charging, player, bot, camera, playing }` as an optional fourth effects-update argument. Avatar squash/stretch, charge pulse, serve leap, ball stretch and camera recoil are suppressed when effects are disabled or reduced motion is requested. Essential limbs/ball movement and textual scoring remain visible. Menu/restart clears paint; effects off clears all active VFX immediately. UI comic words and score sweeps follow the same real events and motion preference.

`npm run test:tennis` includes GPU-independent tests using the vendored Three.js module: contact geometry and ink color, bounded resources across repeated contacts, expiry, full toggle cleanup, and static paint not prolonging rendering. Node's VM-module experimental flag is used only by this test harness, not by the web app.
