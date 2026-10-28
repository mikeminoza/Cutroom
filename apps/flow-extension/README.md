# Cutroom for Flow

A Chrome extension that makes every picture of a Cutroom storyboard in
[Google Flow](https://flow.google/), one after another, and saves each one under its scene number.

- Paste the storyboard (Cutroom → Script step → Storyboard → **Copy all**) or load its **.txt**.
- Add one to three pictures of your main character: they go with every scene that shows them.
- Related scenes (the same alarm clock, the same bedroom) get the earlier scene's picture as a
  reference, so they match.
- Every prompt asks for normal anatomy, which cuts down on extra arms and fingers.
- Pictures are saved as `Downloads/Cutroom/<folder>/scene-001.png`, `scene-002.png`… Extra versions
  go in `more/` as `scene-001b.png`. Drop the folder's pictures on Cutroom's **Images** step and
  each one lands on its scene.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (`apps/flow-extension`).
3. Pin **Cutroom for Flow** to the toolbar.

After changing these files, press the reload button on the extension's card, then reload Flow.

## Use

1. Open Flow's image tool in a tab and click the extension's icon: the side panel opens beside it.
2. **Storyboard:** paste it or load the .txt. The list shows every scene, whether it gets your
   character, and which earlier scene it should match. Change either per scene, and open
   **Prompt** to see exactly what goes to Flow.
3. **Your character:** add their pictures and name. If you saved the character in Flow (as an
   ingredient), put its name as Flow knows it, for example `@Cappy`.
4. **Flow's controls:** press **Check what it finds**. The prompt box and buttons it would use are
   outlined in yellow. If one is wrong or missing, press its button and click it in Flow's page.
5. Press **Start**. Keep the Flow tab in front while it runs: Chrome slows down hidden tabs. **Stop
   after this one** finishes the current scene and stops; **Start** carries on from the first scene
   not done yet (or the scene number you enter).

## Getting the same character every time, with the right number of arms

- **Give the storyboard one protagonist.** Make the character in Cutroom's Library with a picture,
  add them to the channel niche (or the project), then split the script again with AI. Every scene
  that shows them names them and lists them under "Attach reference images for", instead of a
  different goblin, stick figure or "tired person" each time.
- **Use one clear reference picture:** the character alone, full body, front-facing, plain
  background, in a neutral pose. Two or three pictures (front and side) help more than many.
- **Make more than one version per prompt** when Flow offers it. With "Keep every version" on, all
  of them are saved, so you can pick the one with normal hands.
- **Simple poses win.** Hands holding small things, crossed arms and crowds are where models fail.
  The storyboard's AI now keeps to at most two characters and simple poses.
- **Most reliable of all: draw the character once.** In Cutroom's Library, make a set of poses of
  the character (cut-outs) and backgrounds without people. Layered scenes then put a clean pose on a
  background, so the character never gets redrawn, and never gets a third arm.

## How it works

`sidepanel.js` reads the storyboard (`lib/parse.js`), works out each scene's prompt and pictures
(`lib/prompt.js`) and runs the scenes one at a time. `content.js` runs in Flow's page: it adds the
pictures (through Flow's upload control, or by pasting them into the prompt box), types the prompt,
presses Generate, waits for the new pictures and sends them back to be saved.

Flow's page isn't documented and changes from time to time, so the extension finds its controls by
looking for them, and remembers whatever you show it. `dev/fake-flow.html` is a stand-in page for
trying `content.js` without Flow.

Each picture uses your Flow credits, and this clicks Flow's own buttons for you at a calm pace, as
you would. Google's terms may limit automating its services, so keep the pause between prompts
and watch the first few scenes.

Tests: `pnpm --filter @cutroom/flow-extension test`.
