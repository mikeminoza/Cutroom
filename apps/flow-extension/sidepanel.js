// The side panel: offers to make the pictures of the project open in Cutroom (splitting its script
// into scenes first if need be), or takes a project's scenes sent from its Images step, or a
// pasted storyboard. It keeps your character's pictures and the options, and runs the scenes
// through Flow one at a time (content.js does the clicking). Each picture goes straight onto its
// scene in Cutroom (through cutroom.js in Cutroom's tab); a pasted storyboard's pictures, extra
// versions and anything Cutroom can't take are saved as Downloads/Cutroom/<folder>/scene-001.png.
import { currentProject, itemsFromCutroom, mainCharacter, projectOffer, siteOrigin } from './lib/cutroom.js'
import { parseStoryboard } from './lib/parse.js'
import {
  extensionFor,
  fileName,
  folderName,
  relatedIndex,
  shapePrompt,
  wantsCharacter,
} from './lib/prompt.js'

const FLOW = /^https:\/\/([\w-]+\.)*(flow\.google(\.com)?|labs\.google)(\/|$)/
const KEY = 'cutroom-flow'
/** Where background.js leaves what a Cutroom page sent. */
const INCOMING = 'cutroom-flow-incoming'
/** Where background.js keeps the Cutroom tabs and the project each has open. */
const TABS = 'cutroom-flow-tabs'
/** Flow's address as you last used it (kept by background.js), and where to go without one. */
const LAST_FLOW = 'cutroom-flow-url'
const DEFAULT_FLOW = 'https://labs.google/fx/tools/flow'
/** The registered copy of cutroom.js for Cutroom online. */
const SITE_SCRIPT = 'cutroom-site'
const DEFAULTS = { attach: true, continuity: true, anatomy: true, saveAll: true, timeout: 180, pause: 8 }
const MAX_PICTURE_BYTES = 6 * 1024 * 1024

let state = {
  source: null,
  folder: '',
  items: [],
  character: { name: '', looks: '', mention: '', images: [] },
  settings: { ...DEFAULTS },
  controls: {},
  /** The Cutroom project the scenes came from: { origin, tabId, projectId, title, sentAt }. */
  cutroom: null,
  /** Cutroom online's address, once connected. */
  address: '',
  /** When the last project sent from Cutroom was read, so it's read once. */
  incomingAt: 0,
}
/** The first picture of each scene made in this session, to match related scenes to. */
const made = new Map()
let running = false
let stopping = false
/** A project sent while a run was going: it's read when the run ends. */
let waitingIncoming = null
/**
 * The project open in Cutroom, as the panel offers it: where it is ({ tabId, origin, projectId }),
 * what Cutroom says about it (summary), and what's going on (busy, a line saying what).
 */
let detected = null

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- saving and loading

let saveTimer = 0
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => chrome.storage.local.set({ [KEY]: state }), 250)
}

async function load() {
  const saved = (await chrome.storage.local.get(KEY))[KEY]
  if (saved) {
    state = {
      ...state,
      ...saved,
      settings: { ...DEFAULTS, ...saved.settings },
      character: { ...state.character, ...saved.character },
      controls: saved.controls ?? {},
      // A run interrupted by closing the panel left a scene "running".
      items: (saved.items ?? []).map((item) =>
        item.status === 'running' ? { ...item, status: 'todo' } : item,
      ),
    }
  }
  fill()
  render()
  showConnection()
  takeIncoming((await chrome.storage.local.get(INCOMING))[INCOMING])
  detect()
}

function fill() {
  $('storyboard').value = state.source?.text ?? ''
  $('folder').value = state.folder
  $('characterName').value = state.character.name
  $('characterLooks').value = state.character.looks
  $('characterMention').value = state.character.mention
  for (const key of ['attach', 'continuity', 'anatomy', 'saveAll']) $(key).checked = state.settings[key]
  $('timeout').value = state.settings.timeout
  $('pause').value = state.settings.pause
  $('cutroomAddress').value = state.address
}

// ---------------------------------------------------------------- the storyboard

function read(text, name) {
  const items = parseStoryboard(text)
  // A scene read again with the same prompt keeps what was done with it.
  const before = new Map(state.items.map((item) => [`${item.number}|${item.prompt}`, item]))
  state.items = items.map((item) => {
    const old = before.get(`${item.number}|${item.prompt}`)
    return {
      ...item,
      status: old?.status ?? 'todo',
      files: old?.files ?? [],
      error: '',
      character: old?.character ?? 'auto',
      related: old?.related ?? 'auto',
    }
  })
  // The folder follows the file's name unless you changed it.
  const usualFolder = state.source?.name ? folderName(state.source.name) : ''
  state.source = { name: name ?? state.source?.name ?? '', text }
  if (name && (!state.folder || state.folder === usualFolder)) state.folder = folderName(name)
  // A pasted storyboard isn't tied to a Cutroom project: its pictures go to Downloads.
  state.cutroom = null
  save()
  fill()
  render()
}

/**
 * A project sent from Cutroom's Images step ("Make in Flow"): its scenes, which already have a
 * picture, and its main character's pictures. Read once; a run going on finishes first.
 */
function takeIncoming(incoming) {
  if (!incoming?.sentAt || incoming.sentAt <= state.incomingAt) return
  if (running) {
    waitingIncoming = incoming
    say(`“${incoming.title}” arrived from Cutroom: it loads when this run stops.`)
    return
  }
  waitingIncoming = null
  state.incomingAt = incoming.sentAt
  const sameProject = state.cutroom?.projectId === incoming.projectId
  const items = itemsFromCutroom(incoming, sameProject ? state.items : [])
  if (items.length === 0) {
    save()
    say(`“${incoming.title}” has no scene prompts yet. Split the script into scenes in Cutroom first.`)
    return
  }
  state.items = items
  state.source = { name: incoming.title, text: incoming.text }
  state.folder = folderName(incoming.title)
  state.cutroom = {
    origin: incoming.origin,
    tabId: incoming.tabId,
    projectId: incoming.projectId,
    title: incoming.title,
    sentAt: incoming.sentAt,
  }
  const main = mainCharacter(incoming)
  if (main) {
    const same = state.character.name.trim().toLowerCase() === main.name.toLowerCase()
    state.character = {
      name: main.name,
      looks: main.looks,
      // The @name you gave Flow for this character stays; another character's doesn't.
      mention: same ? state.character.mention : '',
      images: main.images,
    }
  }
  if (!sameProject) made.clear()
  save()
  fill()
  render()
  const todo = items.filter((item) => item.status !== 'done').length
  say(
    todo
      ? `${todo} of ${items.length} scenes to make${main ? `, with ${main.name}'s pictures` : ''}. Press Start.`
      : `Every scene of “${incoming.title}” already has a picture. Use "Make again" on one to redo it.`,
  )
}

// ---------------------------------------------------------------- the project open in Cutroom

/** Asks Cutroom's tab about its project (through cutroom.js and Cutroom's page). */
async function askCutroom(where, request) {
  let answer
  try {
    answer = await chrome.tabs.sendMessage(where.tabId, {
      type: 'cutroom:project',
      projectId: where.projectId,
      ...request,
    })
  } catch {
    throw new Error('Cutroom’s tab didn’t answer. Reload it, then come back here.')
  }
  if (!answer?.ok) throw new Error(answer?.error || 'Cutroom’s tab didn’t answer. Reload it.')
  return answer.project
}

/** Finds the project you last looked at in Cutroom and asks Cutroom how far along it is. */
async function detect() {
  const here = currentProject((await chrome.storage.local.get(TABS))[TABS])
  if (!here) {
    detected = null
    renderDetected()
    return
  }
  const same = detected?.tabId === here.tabId && detected?.projectId === here.projectId
  if (same && detected.busy) return
  const mine = { ...here, summary: same ? detected.summary : null, error: '', busy: false, doing: '' }
  detected = mine
  renderDetected()
  try {
    mine.summary = await askCutroom(here, { detail: 'summary' })
  } catch (error) {
    mine.error = error.message
  }
  // Another project may have been opened meanwhile: that one's answer is the one to show.
  if (detected === mine) renderDetected()
}

let detectTimer = 0
function detectSoon() {
  clearTimeout(detectTimer)
  detectTimer = setTimeout(detect, 400)
}

function renderDetected() {
  const card = $('detected')
  // The project already loaded below needs no card: Start carries on with it.
  const loaded =
    detected && state.cutroom?.projectId === detected.projectId && state.cutroom?.origin === detected.origin
  card.hidden = !detected || Boolean(loaded)
  if (card.hidden) return
  const { summary, error, busy, doing } = detected
  $('detectedTitle').textContent = summary ? `“${summary.title || 'Untitled'}”` : 'a project'
  const offer = summary ? projectOffer(summary) : null
  $('detectedText').textContent = busy ? doing : error || (offer ? offer.text : 'Looking at it…')
  const button = $('detectedAction')
  button.hidden = !offer?.action || Boolean(error && !busy)
  button.textContent = offer?.label ?? ''
  button.disabled = running || busy
}

/**
 * Flow in front in this window (its tab, or a new one where you last used it), once its prompt
 * box is there: a page still loading would fail the first scene.
 */
async function bringUpFlow() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!active?.url || !FLOW.test(active.url)) {
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const flow = tabs.find((tab) => tab.url && FLOW.test(tab.url))
    if (flow) await chrome.tabs.update(flow.id, { active: true })
    else {
      const url = (await chrome.storage.local.get(LAST_FLOW))[LAST_FLOW] || DEFAULT_FLOW
      await chrome.tabs.create({ url, active: true })
    }
  }
  const until = Date.now() + 45_000
  while (Date.now() < until) {
    let link
    try {
      link = await connect()
    } catch {
      await sleep(1500) // Still loading.
      continue
    }
    try {
      if ((await link.call({ type: 'ready', controls: state.controls })).prompt) return
    } catch {
      return // Flow's page answered but can't say: Start finds out, and says what's wrong.
    } finally {
      link.port.disconnect()
    }
    await sleep(1500)
  }
}

/** The card's button: split the script into scenes, or load the project and make its pictures. */
async function actOnDetected() {
  const where = detected
  if (!where?.summary || where.busy || running) return
  const offer = projectOffer(where.summary)
  const doing = (text) => {
    where.busy = true
    where.doing = text
    renderDetected()
    // Also below: once the project is loaded, the card makes way for its scenes.
    say(text)
  }
  try {
    if (offer.action === 'split') {
      doing('Splitting the script into scenes with AI. This can take a minute or two…')
      where.summary = await askCutroom(where, { detail: 'summary', split: true })
      return
    }
    doing('Getting its scenes and character pictures from Cutroom…')
    const project = await askCutroom(where, { detail: 'full' })
    takeIncoming({ ...project, origin: where.origin, tabId: where.tabId, sentAt: Date.now() })
    if (offer.action !== 'make' || state.cutroom?.projectId !== project.projectId) return
    doing('Bringing up Flow…')
    await bringUpFlow()
    where.busy = false
    await start()
  } catch (error) {
    say(error.message)
  } finally {
    where.busy = false
    renderDetected()
  }
}

function characterOptions() {
  const { name, looks, mention, images } = state.character
  return { name, description: looks, mention, pictured: images.length > 0 }
}

function hasCharacter() {
  const { name, looks, mention, images } = state.character
  return Boolean(images.length || mention.trim() || name.trim() || looks.trim())
}

/** Does this scene get the character: as set on the scene, or when it shows a person. */
function characterFor(item) {
  if (!hasCharacter() || item.character === 'off') return false
  return item.character === 'on' || wantsCharacter(item, { name: state.character.name })
}

/** The index of the earlier scene this one should match, if any. */
function relatedFor(index) {
  const item = state.items[index]
  if (!state.settings.continuity || item.related === 'none') return null
  if (item.related !== 'auto') {
    const earlier = state.items.findIndex((other) => other.number === Number(item.related))
    return earlier >= 0 && earlier < index ? earlier : null
  }
  return relatedIndex(state.items, index)
}

function promptFor(index, relatedAttached) {
  const item = state.items[index]
  const earlier = relatedFor(index)
  return shapePrompt(item, {
    character: characterOptions(),
    withCharacter: characterFor(item),
    related: earlier !== null && relatedAttached ? { number: state.items[earlier].number } : null,
    anatomy: state.settings.anatomy,
  })
}

// ---------------------------------------------------------------- showing it

const STATE_LABEL = { todo: 'To do', running: 'Making…', done: 'Done', failed: 'Failed' }

function render() {
  const list = $('scenes')
  list.replaceChildren()
  const autoRelated = state.items.map((_, i) => relatedIndex(state.items, i))
  state.items.forEach((item, index) => {
    const li = document.createElement('li')
    const head = document.createElement('div')
    head.className = 'scene-head'
    const number = Object.assign(document.createElement('span'), {
      className: 'number',
      textContent: item.number,
    })
    const time = Object.assign(document.createElement('span'), {
      className: 'time',
      textContent: item.range?.label ?? '',
    })
    const status = Object.assign(document.createElement('span'), {
      className: `state ${item.status}`,
      textContent:
        item.status === 'done' && item.files.length ? `✓ ${item.files[0]}` : STATE_LABEL[item.status],
    })
    head.append(number, time, status)

    const text = Object.assign(document.createElement('p'), {
      className: 'scene-text',
      textContent: item.prompt.split('\n')[0],
    })

    const options = document.createElement('div')
    options.className = 'scene-options'
    const auto = wantsCharacter(item, { name: state.character.name })
    options.append(
      choice(
        'Character',
        item.character,
        [
          ['auto', `auto (${hasCharacter() && auto ? 'yes' : 'no'})`],
          ['on', 'yes'],
          ['off', 'no'],
        ],
        (value) => {
          item.character = value
          save()
          render()
        },
      ),
      choice(
        'Match',
        String(item.related),
        [
          [
            'auto',
            `auto (${autoRelated[index] === null ? 'nothing' : `scene ${state.items[autoRelated[index]].number}`})`,
          ],
          ['none', 'nothing'],
          ...state.items.slice(0, index).map((other) => [String(other.number), `scene ${other.number}`]),
        ],
        (value) => {
          item.related = value
          save()
          render()
        },
      ),
    )
    const details = document.createElement('details')
    const summary = Object.assign(document.createElement('summary'), { textContent: 'Prompt' })
    const pre = Object.assign(document.createElement('pre'), { textContent: promptFor(index, true) })
    details.append(summary, pre)
    options.append(details)
    if (item.status === 'done' || item.status === 'failed') {
      const again = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'quiet',
        textContent: 'Make again',
        disabled: running,
      })
      again.addEventListener('click', () => {
        item.status = 'todo'
        save()
        render()
      })
      options.append(again)
    }
    li.append(head, text, options)
    if (item.error)
      li.append(Object.assign(document.createElement('p'), { className: 'error', textContent: item.error }))
    list.append(li)
  })

  const done = state.items.filter((item) => item.status === 'done').length
  $('summary').textContent = state.items.length
    ? `${state.items.length} scenes${state.items.at(-1)?.range ? `, to ${state.items.at(-1).range.label.split(' – ')[1]}` : ''}`
    : ''
  $('bar').style.width = state.items.length ? `${(done / state.items.length) * 100}%` : '0'
  if (!running) {
    $('status').textContent = state.items.length
      ? `${done} of ${state.items.length} done.`
      : 'Open a project in Cutroom, or read a storyboard, to begin.'
  }
  $('start').disabled = running || state.items.length === 0
  $('stop').hidden = !running
  const linked = Boolean(state.cutroom)
  $('linked').hidden = !linked
  $('manual').hidden = linked
  $('unlink').disabled = running
  if (linked) {
    $('linkedTitle').textContent = `“${state.cutroom.title || 'Untitled'}”`
    $('linkedSummary').textContent = `(${done} of ${state.items.length} have a picture)`
  }
  $('folderLabel').firstChild.textContent = linked ? 'Extra versions go to ' : 'Save to '
  for (const what of ['prompt', 'generate', 'attach']) {
    const mark = document.querySelector(`[data-learned="${what}"]`)
    mark.textContent = state.controls[what] ? '✓ shown' : 'auto'
    mark.className = state.controls[what] ? 'learned' : 'muted'
  }
  const thumbs = $('characterImages')
  thumbs.replaceChildren(
    ...state.character.images.map((image) =>
      Object.assign(document.createElement('img'), { src: image.dataUrl, alt: image.name }),
    ),
  )
  renderDetected()
}

function choice(label, value, options, onChange) {
  const wrap = document.createElement('label')
  wrap.append(`${label} `)
  const select = document.createElement('select')
  for (const [key, text] of options) select.append(new Option(text, key, false, key === value))
  select.disabled = running
  select.addEventListener('change', () => onChange(select.value))
  wrap.append(select)
  return wrap
}

const say = (text) => {
  $('status').textContent = text
}

// ---------------------------------------------------------------- talking to Flow

async function flowTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !FLOW.test(tab.url)) {
    throw new Error('Open Google Flow in the active tab of this window first.')
  }
  return tab
}

async function showConnection() {
  try {
    await flowTab()
    $('connection').textContent = 'Flow is open in this tab: ready.'
  } catch (error) {
    $('connection').textContent = error.message
  }
}

/** A connection to the Flow tab: `call` sends one request and waits for its answer. */
async function connect() {
  const tab = await flowTab()
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  const port = chrome.tabs.connect(tab.id, { name: 'cutroom-flow' })
  const waiting = new Map()
  let next = 0
  port.onMessage.addListener((message) => {
    const request = waiting.get(message.id)
    if (!request) return
    if (message.status) {
      request.onStatus?.(message.status)
      return
    }
    waiting.delete(message.id)
    if (message.ok) request.resolve(message.result)
    else request.reject(new Error(message.error))
  })
  port.onDisconnect.addListener(() => {
    for (const request of waiting.values()) request.reject(new Error("Flow's tab was closed or reloaded."))
    waiting.clear()
  })
  const call = (message, onStatus) =>
    new Promise((resolve, reject) => {
      const id = ++next
      waiting.set(id, { resolve, reject, onStatus })
      port.postMessage({ ...message, id })
    })
  await call({ type: 'ping' })
  return { port, call }
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A picture Flow's page couldn't read itself: fetched from here, or left as its address. */
async function pictureFile(image) {
  if (image.dataUrl) return image
  try {
    const response = await fetch(image.url, { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    return { dataUrl: await readAsDataUrl(blob), mime: blob.type || image.mime }
  } catch {
    return image
  }
}

const safe = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'storyboard'

/**
 * Puts a picture on its scene in Cutroom, through cutroom.js in a Cutroom tab: the one that sent
 * the project, or else any other tab of the same Cutroom.
 */
async function saveToCutroom(item, image, name) {
  if (!image.dataUrl) throw new Error("Flow's picture couldn't be read to send it to Cutroom.")
  const { origin, projectId } = state.cutroom
  const picture = { projectId, sceneId: item.sceneId, number: item.number, name, dataUrl: image.dataUrl }
  const tabs = [state.cutroom.tabId]
  try {
    for (const tab of await chrome.tabs.query({ url: `${origin}/*` })) tabs.push(tab.id)
  } catch {
    // Not allowed to look: the tab that sent the project is the only one tried.
  }
  let problem = `no Cutroom tab answered. Open ${origin} in a tab to save pictures there.`
  for (const tabId of new Set(tabs)) {
    let answer
    try {
      answer = await chrome.tabs.sendMessage(tabId, { type: 'cutroom:picture', picture })
    } catch {
      continue // Closed, on another site now, or opened before the extension was (re)loaded.
    }
    if (answer?.ok) {
      state.cutroom.tabId = tabId
      return
    }
    if (answer?.error) problem = answer.error
  }
  throw new Error(problem)
}

/** One scene: its pictures go in, its prompt is typed, its results are saved. */
async function makeScene(link, index) {
  const item = state.items[index]
  item.status = 'running'
  item.error = ''
  render()
  const onStatus = (text) => say(`Scene ${item.number}: ${text}`)
  const attachments = []
  if (state.settings.attach && characterFor(item)) attachments.push(...state.character.images)
  const earlier = relatedFor(index)
  const reference = earlier !== null ? made.get(state.items[earlier].number) : null
  const relatedAttached = Boolean(state.settings.attach && reference)
  if (relatedAttached) {
    attachments.push({
      name: `scene-${state.items[earlier].number}.png`,
      type: reference.mime,
      dataUrl: reference.dataUrl,
    })
  }
  try {
    const result = await link.call(
      {
        type: 'generate',
        prompt: promptFor(index, relatedAttached),
        attachments,
        controls: state.controls,
        timeoutMs: state.settings.timeout * 1000,
        settleMs: 6000,
      },
      onStatus,
    )
    const keep = state.settings.saveAll ? result.images : result.images.slice(0, 1)
    const files = []
    const notes = []
    for (const [variant, found] of keep.entries()) {
      const image = await pictureFile(found)
      const name = fileName(item.number, variant, { extension: extensionFor(image.mime) })
      if (variant === 0 && image.dataUrl) made.set(item.number, { dataUrl: image.dataUrl, mime: image.mime })
      // From Cutroom: the main picture goes straight onto its scene there.
      if (variant === 0 && state.cutroom && item.sceneId) {
        onStatus('putting the picture on its scene in Cutroom…')
        try {
          await saveToCutroom(item, image, name)
          files.push('in Cutroom')
          continue
        } catch (error) {
          notes.push(`Saved to Downloads instead: ${error.message}`)
        }
      }
      // The main picture next to the others for Cutroom's Images step; extra versions to one side.
      const path = `Cutroom/${safe(state.folder)}/${variant === 0 ? '' : 'more/'}${name}`
      await chrome.downloads.download({
        url: image.dataUrl ?? image.url,
        filename: path,
        conflictAction: 'overwrite',
      })
      files.push(name)
    }
    item.status = 'done'
    item.files = files
    if (attachments.length && result.attached === 'failed') {
      notes.push("Made without the reference pictures: show Cutroom Flow's add-picture button in step 3.")
    }
    item.error = notes.join(' ')
    return true
  } catch (error) {
    item.status = 'failed'
    item.error = error.message
    // Without the prompt box or Generate button every other scene would fail the same way.
    return !/Couldn't (find|type)|closed or reloaded/.test(error.message)
  } finally {
    save()
    render()
  }
}

async function start() {
  if (running) return
  const from = Number($('from').value) || 1
  const queue = state.items
    .map((_, index) => index)
    .filter((index) => state.items[index].status !== 'done' && state.items[index].number >= from)
  if (queue.length === 0) {
    say('Every scene from there is done. Use "Make again" on a scene, or "Mark all as to do".')
    return
  }
  let link
  try {
    link = await connect()
  } catch (error) {
    say(error.message)
    return
  }
  running = true
  stopping = false
  render()
  let finished = 0
  for (const [n, index] of queue.entries()) {
    if (stopping) break
    const keepGoing = await makeScene(link, index)
    finished++
    if (!keepGoing) break
    if (n < queue.length - 1 && !stopping) {
      // A human-like pause between prompts, a little different each time.
      const seconds = state.settings.pause * (0.8 + Math.random() * 0.4)
      say(`Next scene in ${Math.round(seconds)} s…`)
      await sleep(seconds * 1000)
    }
  }
  running = false
  link.port.disconnect()
  render()
  const failed = state.items.filter((item) => item.status === 'failed').length
  const where = state.cutroom
    ? state.items.some((item) => item.error.startsWith('Saved to Downloads'))
      ? `Pictures are on their scenes in Cutroom, except the ones marked: those are in Downloads/Cutroom/${safe(state.folder)}.`
      : 'Pictures are on their scenes in Cutroom.'
    : `Pictures are in Downloads/Cutroom/${safe(state.folder)}.`
  say(
    `${stopping ? 'Stopped' : 'Finished'} after ${finished} ${finished === 1 ? 'scene' : 'scenes'}${
      failed ? `; ${failed} failed (see the list)` : ''
    }. ${where}`,
  )
  if (waitingIncoming) takeIncoming(waitingIncoming)
  // The project open in Cutroom has fewer pictures to make now.
  detectSoon()
}

/**
 * Cutroom online: asks Chrome for that site, then has cutroom.js run in its pages (and in the ones
 * open now), so its projects get the Make in Flow button. Localhost needs none of this.
 */
async function connectAddress() {
  const origin = siteOrigin($('cutroomAddress').value)
  if (!origin) {
    $('addressResult').textContent = 'Enter Cutroom’s address, like https://cutroom.example.com.'
    return
  }
  // Asked first, straight from the click: Chrome only shows the question then.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
  if (!granted) {
    $('addressResult').textContent = 'Chrome didn’t allow it, so nothing changed.'
    return
  }
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT] }).catch(() => {})
    await chrome.scripting.registerContentScripts([
      {
        id: SITE_SCRIPT,
        matches: [`${origin}/*`],
        js: ['cutroom.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ])
    for (const tab of await chrome.tabs.query({ url: `${origin}/*` })) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['cutroom.js'] }).catch(() => {})
    }
  } catch (error) {
    $('addressResult').textContent = error.message
    return
  }
  state.address = origin
  save()
  fill()
  $('addressResult').textContent = `Connected. Open a project on ${origin}: its Images step has Make in Flow.`
}

// ---------------------------------------------------------------- the controls

async function teach(what) {
  let link
  try {
    link = await connect()
    say('Now click it in Flow’s page.')
    state.controls[what] = await link.call({ type: 'teach', what })
    save()
    say('Got it.')
  } catch (error) {
    say(error.message)
  } finally {
    link?.port.disconnect()
    render()
  }
}

async function check() {
  let link
  try {
    link = await connect()
    const found = await link.call({ type: 'check', controls: state.controls })
    const mark = (ok) => (ok ? '✓' : '✗ not found')
    $('checkResult').textContent =
      `Prompt box ${mark(found.prompt)} · Generate ${mark(found.generate)} · Add picture ${mark(found.attach)} (outlined in yellow on the page)`
  } catch (error) {
    $('checkResult').textContent = error.message
  } finally {
    link?.port.disconnect()
  }
}

async function addCharacterPictures(files) {
  for (const file of files) {
    if (state.character.images.length >= 3) break
    if (file.size > MAX_PICTURE_BYTES) {
      say(`${file.name} is over 6 MB: use a smaller picture.`)
      continue
    }
    state.character.images.push({ name: file.name, type: file.type, dataUrl: await readAsDataUrl(file) })
  }
  save()
  render()
}

// ---------------------------------------------------------------- wiring

$('read').addEventListener('click', () => read($('storyboard').value))
$('storyboard').addEventListener('paste', () => setTimeout(() => read($('storyboard').value), 0))
$('file').addEventListener('change', async (event) => {
  const [file] = event.target.files
  if (file) read(await file.text(), file.name)
  event.target.value = ''
})
$('folder').addEventListener('input', (event) => {
  state.folder = event.target.value
  save()
})
for (const [id, key] of [
  ['characterName', 'name'],
  ['characterLooks', 'looks'],
  ['characterMention', 'mention'],
]) {
  $(id).addEventListener('input', (event) => {
    state.character[key] = event.target.value
    save()
    render()
  })
}
$('characterFile').addEventListener('change', async (event) => {
  await addCharacterPictures([...event.target.files])
  event.target.value = ''
})
$('clearCharacter').addEventListener('click', () => {
  state.character.images = []
  save()
  render()
})
for (const key of ['attach', 'continuity', 'anatomy', 'saveAll']) {
  $(key).addEventListener('change', (event) => {
    state.settings[key] = event.target.checked
    save()
    render()
  })
}
for (const [id, key, min] of [
  ['timeout', 'timeout', 30],
  ['pause', 'pause', 2],
]) {
  $(id).addEventListener('change', (event) => {
    state.settings[key] = Math.max(min, Number(event.target.value) || DEFAULTS[key])
    save()
  })
}
for (const button of document.querySelectorAll('[data-teach]')) {
  button.addEventListener('click', () => teach(button.dataset.teach))
}
$('check').addEventListener('click', check)
$('forget').addEventListener('click', () => {
  state.controls = {}
  save()
  render()
})
$('reset').addEventListener('click', () => {
  for (const item of state.items) {
    item.status = 'todo'
    item.error = ''
  }
  save()
  render()
})
$('unlink').addEventListener('click', () => {
  state.cutroom = null
  save()
  render()
  say('Paste a storyboard or load its .txt. Its pictures go to Downloads.')
})
$('connectAddress').addEventListener('click', connectAddress)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[INCOMING]) takeIncoming(changes[INCOMING].newValue)
  // You looked at another Cutroom tab or project.
  if (area === 'local' && changes[TABS]) detectSoon()
})
$('detectedAction').addEventListener('click', actOnDetected)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') detectSoon()
})
$('start').addEventListener('click', start)
$('stop').addEventListener('click', () => {
  stopping = true
  say('Stopping after this scene…')
})
chrome.tabs.onActivated.addListener(showConnection)
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete' || change.url) showConnection()
})

load()
