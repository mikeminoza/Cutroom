# Cutroom for Flow

A Chrome extension that makes every picture of a Cutroom project in
[Google Flow](https://labs.google/fx/tools/flow), one after another, and puts each one on its scene
in Cutroom. You don't paste prompts or press Generate yourself.

- The side panel knows which project you have open in Cutroom (on any step) and offers to make
  its missing pictures in one click. If the project has a script that isn't split into scenes yet,
  it splits it with AI first, so every scene has a picture prompt.
- Or, in Cutroom, press **Make in Flow** on a project's **Images** step. It hands every scene's
  prompt, and your character's pictures, to the extension and brings up Flow; press **Start** in
  the side panel.
- Each scene's prompt is typed into Flow and generated, and the picture lands on its scene in
  Cutroom as soon as it's made.
- Your character's pictures (from the project's characters) go with every scene that shows them.
- Related scenes (the same alarm clock, the same bedroom) get the earlier scene's picture as a
  reference, so they match.
- Every prompt asks for normal anatomy, which cuts down on extra arms and fingers.
- Extra versions are saved as `Downloads/Cutroom/<folder>/more/scene-001b.png`. If Cutroom can't
  take a picture (no Cutroom tab open), it's saved in Downloads too, and the scene says so.
- A storyboard pasted or loaded as a **.txt** (Script step → Storyboard → **Copy all**) still works.
  Its pictures go to `Downloads/Cutroom/<folder>/scene-001.png`, ready to drop on the Images step.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (`apps/flow-extension`).
3. Pin **Cutroom for Flow** to the toolbar.
4. Cutroom on this computer (`localhost`) needs nothing else. For Cutroom online, open the side
   panel, expand **Using Cutroom online?**, enter its address and press **Connect** (Chrome asks
   to allow that one site).

After changing these files, press the reload button on the extension's card, then reload Flow and
Cutroom's tabs.

## Use

1. Open the project in Cutroom (any step), then open the side panel (the extension's icon). Under
   **Open in Cutroom** it shows the project you looked at last and what it needs:
   - **Make 18 pictures**: loads its scenes (the ones with a picture are marked done), brings up
     Flow and starts. The rest of this list is for checking and changing things first.
   - **Split into scenes with AI**: the script has no scenes yet. This splits it (as the Script
     step's AI split does, a minute or two); then **Make … pictures** appears.
   - No button: the project has no script yet, or every scene already has a picture (**Load its
     scenes** to make one again).

   Or, in Cutroom, open the project's **Images** step and press **Make in Flow**. Flow opens (or
   comes to the front) next to the Cutroom tab, and the side panel shows the scenes. If the side
   panel doesn't open by itself, click the extension's icon.
2. Check the list if you like. It shows every scene, whether it gets your character, and which
   earlier scene it should match. Change either per scene, and open **Prompt** to see exactly what
   goes to Flow.
3. **Your character** is filled in from the project's main character (the one most scenes call
   for). If you saved the character in Flow (as an ingredient), put its name as Flow knows it, for
   example `@Cappy`.
4. **Flow's controls** (first time only): press **Check what it finds**. The prompt box and buttons
   it would use are outlined in yellow. If one is wrong or missing, press its button and click it in
   Flow's page.
5. Press **Start**. Keep the Flow tab in front while it runs, because Chrome slows down hidden
   tabs. Keep the Cutroom tab open too (in the background is fine): that's where pictures are
   saved. **Stop after this one** finishes the current scene and stops. **Start** carries on from
   the first scene not done yet (or the scene number you enter).

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

`cutroom.js` runs in Cutroom's pages. It tells Cutroom the extension is there, and tells
`background.js` which project the tab has open (`/projects/<id>`), noting when you look at the tab,
so the side panel can offer the project you looked at last. It passes **Make in Flow**'s scenes to
`background.js` (which keeps them, brings up Flow and opens the side panel), and hands the side
panel's questions about a project, and each finished picture, to Cutroom's page. The page answers
with the project (splitting a script with no scenes yet with AI first) and uploads each picture
onto its scene (`apps/web/src/components/flow-bridge.tsx`). Cutroom's page and `cutroom.js` talk
with window messages: `{ source: 'cutroom' }` one way, `{ source: 'cutroom-flow' }` the other.

`sidepanel.js` takes those scenes (`lib/cutroom.js`) or reads a pasted storyboard (`lib/parse.js`),
works out each scene's prompt and pictures (`lib/prompt.js`) and runs the scenes one at a time.
`content.js` runs in Flow's page: it adds the pictures (through Flow's upload control, or by pasting
them into the prompt box), types the prompt, presses Generate, waits for the new pictures and sends
them back to be saved.

Flow's page isn't documented and changes from time to time, so the extension finds its controls by
looking for them, and remembers whatever you show it. `dev/fake-flow.html` is a stand-in page for
trying `content.js` without Flow.

Each picture uses your Flow credits, and this clicks Flow's own buttons for you at a calm pace, as
you would. Google's terms may limit automating its services, so keep the pause between prompts
and watch the first few scenes.

Tests: `pnpm --filter @cutroom/flow-extension test`.
