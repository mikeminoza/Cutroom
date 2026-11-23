// Runs in Cutroom's own pages (localhost, or the address you connect in the side panel). It tells
// the extension which project this tab has open (the side panel offers to make its pictures) and
// answers the side panel about it, lets a project hand its scenes to the extension (Images step →
// "Make in Flow"), and puts each picture made in Flow on its scene through Cutroom's own upload,
// so nothing goes through Downloads.
//
// Cutroom's page and this script talk with window messages: the page's are { source: 'cutroom' },
// these are { source: 'cutroom-flow' }. Only messages from this same page are listened to.
;(() => {
  /** False once the extension is reloaded or removed: this copy of the script is then left over. */
  const alive = () => {
    try {
      return Boolean(globalThis.chrome?.runtime?.id)
    } catch {
      return false
    }
  }
  // Already here (Cutroom on localhost also connected by address, or injected again).
  if (window.__cutroomFlowPage?.alive()) return
  window.__cutroomFlowPage = { alive }

  const FROM_PAGE = 'cutroom'
  const TO_PAGE = 'cutroom-flow'
  // Cutroom says it has the picture at once; a page that doesn't isn't a Cutroom page (or an old one).
  const CLAIM_TIMEOUT_MS = 4_000
  // Then it has this long to store it (an upload of a few MB) and save the scene.
  const SAVE_TIMEOUT_MS = 120_000
  // Reading a project is quick; splitting its script with AI can take the AI's whole time budget.
  const PROJECT_TIMEOUT_MS = 60_000
  const SPLIT_TIMEOUT_MS = 330_000

  const post = (message) => window.postMessage({ source: TO_PAGE, ...message }, location.origin)
  const announce = () => post({ type: 'ready', version: chrome.runtime.getManifest().version })

  /** Requests handed to the page, by id: what to do when the page answers. */
  const waiting = new Map()
  let next = 0

  /**
   * Hands a request to Cutroom's page and answers `sendResponse` with what the page says. The page
   * says at once that it has it (one that doesn't isn't a Cutroom page, or an old one), then has
   * `answerMs` to finish.
   */
  function askPage(message, { answerMs, notCutroom, tooSlow }, sendResponse) {
    const requestId = `${message.type}-${Date.now()}-${++next}`
    const finish = (answer) => {
      clearTimeout(timer)
      waiting.delete(requestId)
      sendResponse(answer)
    }
    let timer = setTimeout(() => finish({ ok: false, error: notCutroom }), CLAIM_TIMEOUT_MS)
    waiting.set(requestId, {
      received: () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish({ ok: false, error: tooSlow }), answerMs)
      },
      answered: finish,
    })
    post({ ...message, requestId })
  }

  // ---------------------------------------------------------------- which project is open here

  // A project's page is /projects/<id>, whatever step is open.
  const projectHere = () => /^\/projects\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null
  let reported
  /**
   * Tells the extension this tab's project: when it changes, or always when `force`d. While you're
   * looking at this tab, that makes its project the one the side panel offers.
   */
  function report(force) {
    if (!alive()) return clearInterval(watcher)
    const projectId = projectHere()
    if (!force && projectId === reported) return
    reported = projectId
    try {
      chrome.runtime
        .sendMessage({ type: 'cutroom:here', projectId, seen: document.visibilityState === 'visible' })
        .catch(() => {})
    } catch {
      // The extension was reloaded: this copy is left over.
    }
  }
  // Cutroom changes pages without reloading, so look now and then.
  const watcher = setInterval(() => report(false), 1000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') report(true)
  })
  window.addEventListener('focus', () => report(true))

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    const data = event.data
    if (!data || data.source !== FROM_PAGE || !alive()) return
    if (data.type === 'hello') announce()
    else if (data.type === 'send') {
      chrome.runtime
        .sendMessage({ type: 'cutroom:send', payload: data.payload })
        .then(
          (answer) =>
            answer ?? { ok: false, error: 'The extension did not answer. Reload it and try again.' },
          (error) => ({ ok: false, error: error?.message ?? String(error) }),
        )
        .then((answer) => post({ type: 'sent', requestId: data.requestId, ...answer }))
    } else if (data.type === 'picture-received' || data.type === 'project-received') {
      waiting.get(data.requestId)?.received()
    } else if (data.type === 'picture-saved') {
      waiting.get(data.requestId)?.answered({ ok: Boolean(data.ok), error: data.error })
    } else if (data.type === 'project') {
      waiting
        .get(data.requestId)
        ?.answered({ ok: Boolean(data.ok), project: data.project, error: data.error })
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'cutroom:picture') {
      askPage(
        { type: 'picture', ...message.picture },
        {
          answerMs: SAVE_TIMEOUT_MS,
          notCutroom: 'this tab isn’t a Cutroom page that can take pictures.',
          tooSlow: 'Cutroom took too long to save the picture.',
        },
        sendResponse,
      )
      return true
    }
    if (message?.type === 'cutroom:project') {
      askPage(
        {
          type: 'project-request',
          projectId: message.projectId,
          detail: message.detail,
          split: Boolean(message.split),
        },
        {
          answerMs: message.split ? SPLIT_TIMEOUT_MS : PROJECT_TIMEOUT_MS,
          notCutroom:
            'Cutroom’s tab didn’t answer. Reload it; if it still doesn’t, Cutroom needs updating to work with this extension.',
          tooSlow: message.split
            ? 'Splitting the script took too long. Check the Script step in Cutroom.'
            : 'Cutroom took too long to answer.',
        },
        sendResponse,
      )
      return true
    }
  })

  announce()
  report(true)
})()
