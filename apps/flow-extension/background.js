// Opens the side panel when you click the extension's icon, keeps track of the Cutroom tabs and
// the project each has open (the side panel offers the one you looked at last), and takes the
// scenes Cutroom sends (Images step → "Make in Flow"): they're kept for the side panel, Flow is
// brought up in the same window, and the side panel opens beside it. The making itself happens in
// the side panel (sidepanel.js) and in Flow's page (content.js).
const FLOW = /^https:\/\/([\w-]+\.)*(flow\.google(\.com)?|labs\.google)(\/|$)/
const DEFAULT_FLOW = 'https://labs.google/fx/tools/flow'
const INCOMING = 'cutroom-flow-incoming'
const LAST_FLOW = 'cutroom-flow-url'
/** The Cutroom tabs, by tab id: { tabId, origin, projectId, at }, `at` when you last looked at it. */
const TABS = 'cutroom-flow-tabs'

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

// One change to the Cutroom tabs at a time, so two tabs reporting together don't undo each other.
let tabsQueue = Promise.resolve()
function changeTabs(change) {
  tabsQueue = tabsQueue
    .then(async () => {
      const tabs = (await chrome.storage.local.get(TABS))[TABS] ?? {}
      if (change(tabs) !== false) await chrome.storage.local.set({ [TABS]: tabs })
    })
    .catch(() => {})
}

/** A Cutroom tab said which project it has open (or none, on another page). */
function noteCutroomTab(sender, projectId, seen) {
  changeTabs((tabs) => {
    const before = tabs[sender.tab.id]
    tabs[sender.tab.id] = {
      tabId: sender.tab.id,
      origin: new URL(sender.url).origin,
      projectId: typeof projectId === 'string' && projectId ? projectId : null,
      // Only looking at a tab makes its project the current one; a tab loading behind doesn't.
      at: seen ? Date.now() : (before?.at ?? 0),
    }
  })
}

chrome.tabs.onRemoved.addListener((tabId) => {
  changeTabs((tabs) => {
    if (!tabs[tabId]) return false
    delete tabs[tabId]
  })
})
// Tab ids don't outlive the browser.
chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove(TABS))

// Flow's address as you last used it (your project), to open it there next time.
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url && FLOW.test(change.url)) chrome.storage.local.set({ [LAST_FLOW]: change.url })
})

/** The scenes sent from a Cutroom page, as the side panel reads them. */
function incomingFrom(payload, tab) {
  if (!payload || typeof payload !== 'object') throw new Error('Nothing was sent.')
  const scenes = Array.isArray(payload.scenes) ? payload.scenes : []
  if (scenes.length === 0) throw new Error('This project has no scenes yet.')
  return {
    projectId: String(payload.projectId ?? ''),
    title: String(payload.title ?? ''),
    text: String(payload.text ?? ''),
    scenes,
    characters: Array.isArray(payload.characters) ? payload.characters : [],
    origin: new URL(tab.url).origin,
    tabId: tab.id,
    sentAt: Date.now(),
  }
}

async function receive(payload, tab) {
  await chrome.storage.local.set({ [INCOMING]: incomingFrom(payload, tab) })
  const here = await chrome.tabs.query({ windowId: tab.windowId })
  const flow = here.find((other) => other.url && FLOW.test(other.url))
  if (flow) {
    await chrome.tabs.update(flow.id, { active: true })
  } else {
    const url = (await chrome.storage.local.get(LAST_FLOW))[LAST_FLOW] || DEFAULT_FLOW
    await chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1, url, active: true })
  }
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'cutroom:here' && sender.tab?.id !== undefined && sender.url) {
    noteCutroomTab(sender, message.projectId, Boolean(message.seen))
    return
  }
  if (message?.type !== 'cutroom:send' || !sender.tab?.url) return
  // First of all, while Chrome still counts the click in Cutroom that sent this. It can still be
  // refused: Cutroom then says to click the extension's icon.
  const panel = chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(
    () => true,
    () => false,
  )
  receive(message.payload, sender.tab).then(
    async (result) => sendResponse({ ...result, panel: await panel }),
    (error) => sendResponse({ ok: false, error: error?.message ?? String(error) }),
  )
  return true
})
