# Scene editing: from slideshow to explainer-channel edit

Date: 2026-10-27. Status: proposed.

## Why

Picture changes look like a slideshow: a plain cut, then a slow zoom that eases in from a
standstill, with no sound. Channels in this niche (crude doodle / stick-figure explainers such as
Sam O'Nella Academy and Casually Explained, and the faceless channels that copy them) mostly cut
plainly too. What makes their edits feel alive is:

- every picture is already moving when it appears, at the same steady speed as its neighbours;
- a zoom-cut to a detail of the same picture on a key word or joke;
- flashy transitions only where the script moves to a new section;
- a short camera shake on a punchline;
- sound effects under all of it: a whoosh on movement, an impact on reveals.

Guides for this kind of video also warn that over-cutting backfires, especially in longer videos,
so the effects are deliberately rare and spaced out.

The look was agreed with the animated demo "Genre reference" (punch-in on every cut, zoom-through
and flash were tried and dropped).

## The editing vocabulary

Five pieces. The browser preview and the ffmpeg render share their numbers through
`@cutroom/shared`, as the transition timings already do, so the preview keeps playing the way the
video renders.

### 1. Steady drift (every picture)

The camera moves (`zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `none`) keep their amounts
(zoom up to 12% at 0.05 per second, pan up to 10% at 0.04 per second) but run at a constant speed
instead of today's half-linear / half-cosine curve. A picture arrives already moving, and two
pictures with the same move cut together smoothly.

The AI is told to keep the same move through a run of scenes within a section and change it at a
new section, instead of "vary it between scenes".

### 2. Zoom-cut to a detail (accent `zoom`)

At the accent moment the framing jumps to 1.4× around the scene's focus point and keeps moving
until the scene ends. For a layered scene (Library background and pose), the zoom centres on the
pose's head (the top third of its box, on its side).

- Rules: dropped for scenes shorter than 1.2 s; the moment is kept at least 0.4 s after the cut
  and 0.5 s before the end.
- Sound: a short swish (0.16 s) whose loudest point lands on the zoom frame.

### 3. Shake on the punchline (accent `shake`)

At the accent moment the frame shakes and settles over 0.4 s:

- `dx = A·sin(2π·11·t)·e^(−8t)` and `dy = 0.6·A·cos(2π·8.5·t)·e^(−8t)`, with `A` = 1.8% of the width.
- The framing is enlarged by `1 + 0.04·e^(−8t)` during the shake, so the edges never show: the
  margin shrinks at the same rate as the shake.
- Sound: a thud (a low sine drop with a short noise click) at the start of the shake.

### 4. Whip transition (transition `whip`)

A new transition beside `cut`, `crossfade` and `fade-black`, for a new section or idea.

- It runs for 0.3 s (9 frames at 30 fps) from the cut. The previous picture slides out to the left
  while still moving (it gets a `tail`, exactly like a crossfade), and the new one slides in from
  the right. Both use cubic ease-in-out.
- A horizontal blur follows the speed. A shared `whipFrame(progress, width)` returns the offset
  and blur for a progress from 0 to 1. The render evaluates it at each of its frames and the
  preview at each displayed frame, so both follow the same curve.
- Limits: it is capped at half the shorter picture. With no previous picture it falls back to a
  plain cut. Inside a joined shot (back-to-back layered scenes on the same background) it stays the
  shot's continuous cut.
- Sound: a whoosh (0.35 s, rising, loudest point where the slide lands).

### 5. Sound effects

The three sounds (`whoosh`, `swish`, `thud`) are synthesised by one deterministic function in
`packages/shared/src/sfx.ts`: seeded noise, a sweeping band-pass filter and an envelope, or a
sine drop for the thud. That keeps them free of licences and binary files, and makes the preview
and render play the same samples.

They sit well under the voice and are switched by a new project setting, `soundEffects` (on by
default, carried by series and Shorts like `textOverlays`).

## Data model

| Where | Change |
|---|---|
| `Transition` (shared types) | adds `'whip'`; `normalizeTransition` maps `whip`, `swipe`, `slide` to it |
| `scenes` table | `accent text NOT NULL DEFAULT 'none'` (`'none' \| 'zoom' \| 'shake'`), `accent_word text NOT NULL DEFAULT ''` |
| `projects` table, series template | `sound_effects boolean NOT NULL DEFAULT true` |
| DTOs, validation, job payload | carry the new fields through to the worker |

The accent moment comes from a shared `accentTime(scene, words)`. It takes the start of the first
caption word inside the scene that matches `accentWord`, ignoring case and punctuation. With no
word or no match, it uses the scene start for a shake and the middle of the scene for a zoom. The
clamps above then apply. Without a transcript, the estimated caption words (`wordsFromScenes`) are
used, as captions already do.

## Who picks the effects

1. **When the AI splits a script.** The storyboard prompt gains:
   - `transition` `"whip"`, for moving on to a new section or idea;
   - `accent` `"zoom"`, on the key word of an important line, in about 1 scene in 6;
   - `accent` `"shake"`, on punchlines and big reveals, used rarely;
   - `accentWord`, copied exactly from the narration.

   After the reply, code enforces the spacing so a chatty model can't over-edit: shakes at least
   15 s apart, whips at least 20 s apart, and no zoom on two scenes in a row. The extra accents are
   dropped.
2. **For a project that's already split, such as the current 61-scene video.**
   - A new **Editing** panel on the Preview step has an **Add effects with AI** button. It makes
     one Gemini text call over the scenes' narration and timing, split into parts like the
     storyboard for long scripts. It sets every scene's accent and accent word, and switches
     transitions only between `cut` and `whip` (crossfades and dips are kept).
   - The same spacing rules apply.
   - The panel also holds the **Sound effects** switch.
3. **By hand.** The Script step's **Picture details** get:
   - a **Whip in** option under **Transition in** (the Images step's dropdown gets it for free from
     `TRANSITIONS`);
   - an **Accent** select (None / Zoom-cut / Shake);
   - an **On the word** field next to it.

   Manual choices are never re-spaced.

## Render (worker)

- **Drift, zoom-cut and shake** are all changes to the existing `perspective` expression in
  `motionFilter`:
  - linear progress;
  - an `if(gte(in, Nz), …)` step that shrinks the visible rectangle by 1/1.4 around the anchor;
  - shake offsets added to the four corners inside the shake window.

  None of this adds per-frame cost.
- **Whip.** The incoming clip already receives the previous picture for crossfades, and the whip
  uses the same plumbing:
  - the old and new pictures are overlaid on a background canvas at `x` expressions taken from
    `whipFrame`;
  - the composite is blurred with one `gblur` per frame (`enable='eq(n,k)'`, horizontal sigma
    from `whipFrame`, vertical sigma near 0), then laid over the clip with `eof_action=pass`, like
    the crossfade.

  The cost is about that of a crossfade, and only for 9 frames.
- **Sound.**
  - The worker writes the three WAVs (48 kHz mono) into the work dir.
  - The final pass adds one input per sound used, `asplit`s it per event, delays each copy with
    `adelay`, mixes them into `[sfx]` at a fixed level, and mixes that into the voice / ducked
    music before the existing `alimiter`.
  - The events come from the render's own segment plan: a whip only plays where the plan kept
    one, and accents use `accentTime`.
  - No events, or `soundEffects` off, leaves the audio graph exactly as today.

## Preview (web)

- `motionStyle` gets the same linear progress, an extra zoom-cut scale (origin at the focus or
  pose head) and the shake offsets.
- The whip uses the outgoing layer the crossfade already has. Both layers are translated, and an
  inline SVG `feGaussianBlur` has its `stdDeviation` set per frame from `whipFrame`.
- The sound effects are synthesised once into `AudioBuffer`s from `sfx.ts`. The rAF loop plays
  each event as the clock crosses it (never when seeking past it), and only while playing with
  `soundEffects` on.

## Existing projects

- Every video gets the steady drift on its next preview or render.
- Nothing else changes until scenes get accents or whips, either from **Add effects with AI**, a
  new split, or by hand.
- Sound effects default to on, but there is nothing to play until there are events.

## Testing

- **Shared:**
  - `normalizeTransition` and `planTransitions` with `whip` (tail, caps, no previous picture);
  - `whipFrame` (offset goes from 0 to 1 monotonically, blur 0 at both ends, peak in the middle);
  - `accentTime` (word match, fallbacks, clamps, short scenes);
  - the AI spacing rules;
  - `sfx` (deterministic, expected length, loudest point where specified, never clipping).
- **Worker:**
  - `motionFilter` with the zoom-cut and shake;
  - `segmentArgs` for a whip (both pictures, unique pad names, one blur per frame);
  - `audioPlan` with and without effects;
  - a real ffmpeg smoke render of a three-scene video with a whip, a zoom-cut, a shake and sound,
    checking that it finishes at the exact duration (CI has ffmpeg).
- **Web:** server tests for the new columns, the validation, and the AI action's spacing.
- **By eye:** the Preview step against the agreed demo.

## Out of scope

Zoom-through and flash transitions, a pop sound for on-screen text or poses, a sound-effect volume
control or custom sound uploads, and changing how often pictures change (already about every
3 seconds, which matches the niche).
