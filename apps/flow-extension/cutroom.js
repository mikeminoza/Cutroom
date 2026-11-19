// Runs in Cutroom's own pages (localhost, or the address you connect in the side panel). It lets a
// project hand its scenes to the extension (Images step → "Make in Flow"), and puts each picture
// made in Flow on its scene through Cutroom's own upload, so nothing goes through Downloads.
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

  const post = (message) => window.postMessage({ source: TO_PAGE, ...message }, location.origin)
  const announce = () => post({ type: 'ready', version: chrome.runtime.getManifest().version })

  /** Pictures handed to the page, by request: what to do when the page answers. */
  const waiting = new Map()
  let next = 0

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
    } else if (data.type === 'picture-received') {
      waiting.get(data.requestId)?.received()
    } else if (data.type === 'picture-saved') {
      waiting.get(data.requestId)?.saved({ ok: Boolean(data.ok), error: data.error })
    }
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'cutroom:picture') return
    const requestId = `picture-${Date.now()}-${++next}`
    const finish = (answer) => {
      clearTimeout(timer)
      waiting.delete(requestId)
      sendResponse(answer)
    }
    let timer = setTimeout(
      () => finish({ ok: false, error: 'this tab isn’t a Cutroom page that can take pictures.' }),
      CLAIM_TIMEOUT_MS,
    )
    waiting.set(requestId, {
      received: () => {
        clearTimeout(timer)
        timer = setTimeout(
          () => finish({ ok: false, error: 'Cutroom took too long to save the picture.' }),
          SAVE_TIMEOUT_MS,
        )
      },
      saved: finish,
    })
    post({ type: 'picture', requestId, ...message.picture })
    return true
  })

  announce()
})()
