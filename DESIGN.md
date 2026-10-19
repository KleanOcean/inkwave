# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-19
- Primary product surfaces: default tennis 1v1 duel, selectable 60-second practice; original shooter at `?game=inkwave`.
- Evidence reviewed: `README.md`, `index.html`, `styles/ui.css`, `src/main.js`, `src/game/character.js`, `src/game/physics.js`, `tools/build-dist.py`.

## Brand
- Personality: bold, playful ink-sport arcade; bring INKWAVE's saturated team ink, oversized splashes and cartoon impact into tennis.
- Trust signals: visible court boundaries, readable ball/shadow, honest scoring and instructions.
- Avoid: heavy postprocessing, downloaded art, glass panels, unrelated menus.

## Product goals
- Goals: a playable 1v1 bot duel with Easy/Normal difficulty, serving, meaningful shot contact, first-to-seven/win-by-two scoring and richer animation; preserve 60-second practice.
- Non-goals: full sets/games, multiplayer, coaching claims, spin simulation.
- Success signals: a real serve leads to human/bot exchanges, legal bounces and a single point outcome; a match finishes and restarts. Practice remains playable.
- Current implementation contract: `docs/TENNIS-DUEL.md`.

## Personas and jobs
- Primary personas: casual desktop players; the requesting user has limited available memory.
- User jobs: understand the controls, time a swing, improve target accuracy across short sessions.
- Key contexts of use: local browser; mouse/keyboard first, touch controls as a fallback.

## Information architecture
- Primary navigation: duel/practice, difficulty, start, pause/resume, replay; discreet original-game link.
- Core routes/screens: `/` tennis ready/playing/paused/results, default duel; `?game=inkwave` original game.
- Content hierarchy: court and ball first, time/score second, controls and feedback third.

## Design principles
- Keep feedback tied to real simulation events; no cosmetic scoring. Ground ink is decorative and does not change tennis rules.
- Effects must be visible at the normal full-court camera distance: use solid mesh widths and large silhouettes rather than one-pixel lines. Keep the moving ball readable.
- Make aiming, contact opportunity and shot outcome visible without relying on color.
- Tradeoffs: an independent lightweight tennis scene shares the vendored Three.js but avoids loading the shooter's ink atlas, character rigs and battle systems. New simple sports avatar follows the existing procedural art approach.

## Visual language
- Color: cream `#f3f0e7`, deep green `#153d35`, lime `#e5f67a`, coral `#ff845c`, lavender `#a59bf8`; high-energy effects use ink coral `#ff4a45`, electric violet `#7060ff`, and cream highlights.
- Typography: existing local Rubik and Titan One; Chinese system sans fallback.
- Spacing/layout rhythm: compact masthead, generous scene space, one strong ready/results panel.
- Shape/radius/elevation: crisp court lines, circular targets, modest button radii and solid borders.
- Motion: exaggerated anticipation, squash/stretch and follow-through; thick tapered team-ink ball ribbons; broad racket slashes; large droplet bursts; cosmetic ground ink splats that grow on landing; charge aura; comic impact words and score sweeps. Each effect follows real gameplay events, with short bounded lifetimes and fixed reusable pools. The effects toggle and reduced-motion preference suppress all decorative VFX and exaggerated motion.
- Imagery/iconography: code-generated court, player, racket, net and environment; no external media.

## Components
- Existing components to reuse: vendored Three.js, local fonts, app/UI DOM mount points, static server and distribution pipeline.
- New/changed components: tennis scene with two actors and pooled effects, pure practice/duel rules, mode/difficulty controls, dual score HUD, ready/pause/results screens and charge meter.
- Variants and states: duel/practice, Easy/Normal, server/toss/rally/between points, three aim presets, contact timing, charge, sound/effects toggles.
- Token/component ownership: tennis styles scoped to tennis UI; original game styles loaded only on its route.

## Accessibility
- Target standard: keyboard-operable surrounding UI, readable contrast and controls; the spatial game itself is visual.
- Keyboard/focus behavior: WASD/arrows move; 1/2/3 select aim; Space hold/release swings; Escape pauses; dialogs focus their primary action.
- Contrast/readability: solid UI surfaces and text labels alongside color feedback.
- Screen-reader semantics: named buttons, score/timer labels, polite outcome announcements, real hidden states.
- Reduced motion and sensory considerations: no flashing or strobe. With effects enabled, contacts may use a brief, small camera recoil that returns to the fixed court view. Disable recoil, auras, trails and celebratory motion with the effects toggle or reduced-motion preference; retain essential ball/actor movement and readable feedback. Optional synthesized sound is muted by default.

## Responsive behavior
- Supported breakpoints/devices: desktop and small tablet/phone browser sizes.
- Layout adaptations: side panel becomes compact overlay; camera fits full court; HUD and controls avoid overlap.
- Touch/hover differences: visible movement pad and hold-to-swing button on touch; no pointer lock.

## Interaction states
- Loading: initialize one small scene and local modules; start only when initialization succeeds.
- Empty: ready screen with a visible court and three targets.
- Error: readable error and reload action; failed WebGL cannot leave a working-looking start button.
- Success: practice points follow first landings; duel points follow net/out/two bounces and are awarded once. Results show mode-appropriate score and best streak/rally.
- Disabled: gameplay input is inactive outside a running challenge; pausing/hidden tab cancels held inputs.
- Offline/slow network: no runtime network dependencies beyond this static origin.

## Content voice
- Tone: brief and encouraging, Chinese instructions with English sports branding.
- Terminology: 回球、靶区、连击、蓄力、剩余时间.
- Microcopy rules: explain when to release a swing, not just which key to press; distinguish net, out and missed ball.

## Implementation constraints
- Framework/styling system: plain ES modules, DOM/CSS, vendored Three.js; no new dependencies.
- Design-token constraints: use the color/font decisions above and existing local fonts.
- Performance constraints: capped pixel ratio and frame rate, one canvas, no ink atlas/postprocessing, no animation loop while paused/hidden.
- Compatibility constraints: modern WebGL2 browser; preserve original game and its existing smoke-test entry.
- Test/screenshot expectations: deterministic practice/duel rules tests, syntax/distribution checks, one Ego Lite QA page verifying real exchanges, point outcomes, pause/replay, retained practice and effects changes. Close the QA tab; preserve the server the user requested for play. Touch support is not certified on physical hardware.

## Open questions
- None blocking the approved bot duel. Multiplayer and full tennis sets/games are future scope.
