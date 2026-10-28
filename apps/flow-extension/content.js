// Runs inside Google Flow and does what the side panel asks, one picture at a time: adds the
// reference pictures, puts the prompt in Flow's prompt box, presses Generate, waits for the new
// pictures and sends them back. It finds Flow's controls by looking for them, or by what you
// showed it with "Show Cutroom Flow's controls" in the side panel.
;(() => {
  // Already running (and not left over from before the extension was reloaded).
  if (window.__cutroomFlow?.alive()) return
  window.__cutroomFlow = {
    alive: () => {
      try {
        return Boolean(chrome.runtime?.id)
      } catch {
        return false
      }
    },
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function visible(el) {
    if (!el?.isConnected) return false
    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }

  /** What an element says about itself: its label, placeholder or text. */
  function labelOf(el) {
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-placeholder'),
      el.innerText,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  }

  // ---------------------------------------------------------------- remembering a control

  function pathOf(el) {
    const steps = []
    let node = el
    while (node && node.nodeType === 1 && node !== document.body && steps.length < 10) {
      const parent = node.parentElement
      const same = parent ? [...parent.children].filter((c) => c.tagName === node.tagName) : []
      const nth = same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''
      steps.unshift(`${node.tagName.toLowerCase()}${nth}`)
      node = parent
    }
    return steps.join(' > ')
  }

  /** How to find this control again, even after Flow re-renders the page. */
  function describe(el) {
    const tag = el.tagName.toLowerCase()
    const attributes = ['aria-label', 'placeholder', 'data-placeholder', 'data-testid', 'name', 'title']
      .map((name) => [name, el.getAttribute(name)])
      .filter(([, value]) => value && value.length < 80)
      .map(([name, value]) => `[${name}="${CSS.escape(value)}"]`)
      .join('')
    // Ids that look generated (":r3:", "mat-input-12") change between visits: not used.
    const id = el.id && !/\d{2,}|:/.test(el.id) ? `#${CSS.escape(el.id)}` : ''
    return {
      tag,
      selector: id || (attributes ? `${tag}${attributes}` : ''),
      label: labelOf(el),
      path: pathOf(el),
    }
  }

  function locate(saved) {
    if (!saved) return null
    for (const selector of [saved.selector, saved.path]) {
      if (!selector) continue
      try {
        const found = [...document.querySelectorAll(selector)].filter(visible)
        const same = found.find((el) => saved.label && labelOf(el) === saved.label)
        if (same || found.length) return same ?? found[0]
      } catch {
        // A selector this page can't parse: try the next way.
      }
    }
    return (
      [...document.querySelectorAll(saved.tag)].find(
        (el) => visible(el) && saved.label && labelOf(el) === saved.label,
      ) ?? null
    )
  }

  // ---------------------------------------------------------------- finding Flow's controls

  function promptBox(saved) {
    const shown = locate(saved)
    if (shown) return shown
    const boxes = [
      ...document.querySelectorAll(
        'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], input[type="text"]',
      ),
    ].filter((el) => visible(el) && !el.disabled && !el.readOnly)
    let best = null
    let bestScore = -1
    for (const box of boxes) {
      const rect = box.getBoundingClientRect()
      let score = Math.min(rect.width * rect.height, 200_000) / 1000
      if (/prompt|describe|create|imagine|what (do|would) you|type|idea/i.test(labelOf(box))) score += 500
      if (/search/i.test(labelOf(box))) score -= 400
      if (score > bestScore) {
        best = box
        bestScore = score
      }
    }
    return best
  }

  function generateButton(saved, box) {
    const shown = locate(saved)
    if (shown) return shown
    const near = box?.getBoundingClientRect()
    let best = null
    let bestScore = 0
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') continue
      const words = labelOf(button).toLowerCase()
      let score = 0
      if (/\b(generate|create|send|submit|make|run|go)\b/.test(words)) score += 10
      // Google's icon font spells its icons out: arrow_forward, send, spark.
      if (/arrow_forward|arrow_upward|north|send|auto_awesome|spark/.test(words)) score += 8
      if (
        /\b(cancel|close|delete|remove|download|share|settings|menu|back|upload|add|attach|more|help|sign)\b/.test(
          words,
        )
      )
        score -= 20
      if (near) {
        const rect = button.getBoundingClientRect()
        const distance = Math.hypot(
          rect.left + rect.width / 2 - near.right,
          rect.top + rect.height / 2 - near.bottom,
        )
        score += Math.max(0, 6 - distance / 80)
      }
      if (score > bestScore) {
        best = button
        bestScore = score
      }
    }
    return bestScore >= 4 ? best : null
  }

  function fileInput() {
    return (
      [...document.querySelectorAll('input[type="file"]')].find(
        (input) => !input.disabled && (!input.accept || /image|png|jpe?g|\*/i.test(input.accept)),
      ) ?? null
    )
  }

  // ---------------------------------------------------------------- typing the prompt

  const textOf = (el) =>
    'value' in el && typeof el.value === 'string' ? el.value : el.innerText || el.textContent || ''

  function setPrompt(el, text) {
    el.focus()
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // Through the native setter, so React and other frameworks see the change.
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      // Rich editors listen for typed input: select what is there and "type" over it.
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      if (!document.execCommand('insertText', false, text)) {
        el.textContent = text
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      }
    }
    const probe = text.replace(/\s+/g, ' ').slice(0, 30)
    return textOf(el).replace(/\s+/g, ' ').includes(probe)
  }

  // ---------------------------------------------------------------- pictures

  const srcOf = (img) => img.currentSrc || img.src

  /** The pictures on the page big enough to be results (not icons or avatars). */
  function pictures() {
    return [...document.images].filter((img) => {
      const src = srcOf(img)
      return (
        src &&
        !/^data:image\/svg|\.svg(\?|$)/i.test(src) &&
        img.complete &&
        img.naturalWidth >= 256 &&
        img.naturalHeight >= 256 &&
        visible(img)
      )
    })
  }

  /** Waits for pictures that weren't there before, then a little longer for the rest of the set. */
  async function newPictures(before, { timeoutMs, settleMs }, status) {
    const start = Date.now()
    let firstAt = null
    let found = []
    while (Date.now() - start < timeoutMs) {
      await sleep(1000)
      found = pictures().filter((img) => !before.has(srcOf(img)))
      if (found.length && firstAt === null) firstAt = Date.now()
      if (firstAt !== null && Date.now() - firstAt >= settleMs) break
      status(
        found.length
          ? `Got ${found.length} ${found.length === 1 ? 'picture' : 'pictures'}, waiting for the rest…`
          : `Waiting for Flow (${Math.round((Date.now() - start) / 1000)} s)…`,
      )
    }
    return [...new Map(found.map((img) => [srcOf(img), img])).values()]
  }

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }

  /** A picture's file, or its address when the page can't read it (the side panel then can). */
  async function pictureData(img) {
    const src = srcOf(img)
    try {
      const response = await fetch(src, { credentials: 'include' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      return { dataUrl: await readAsDataUrl(blob), mime: blob.type || 'image/png', width: img.naturalWidth }
    } catch {
      return { url: src, mime: 'image/png', width: img.naturalWidth }
    }
  }

  // ---------------------------------------------------------------- reference pictures

  async function filesFrom(images) {
    return Promise.all(
      images.map(async (image, i) => {
        const blob = await (await fetch(image.dataUrl)).blob()
        return new File([blob], image.name || `reference-${i + 1}.png`, { type: image.type || blob.type })
      }),
    )
  }

  /**
   * Gives Flow the reference pictures: through its upload control (as shown, or any image file
   * input), or by pasting them into the prompt box. Returns how, or null when it found no way.
   */
  async function attach(images, saved, box) {
    if (!images.length) return 'nothing to attach'
    const files = await filesFrom(images)
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    const button = locate(saved)
    let input = null
    if (button) {
      button.click()
      for (let i = 0; i < 20 && !input; i++) {
        await sleep(150)
        input = fileInput()
      }
    }
    input ??= fileInput()
    if (input) {
      input.files = transfer.files
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(3000)
      return 'upload'
    }
    if (box) {
      box.focus()
      box.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
      )
      await sleep(3000)
      return 'paste'
    }
    return null
  }

  // ---------------------------------------------------------------- one picture

  async function generate(request, status) {
    const box = promptBox(request.controls?.prompt)
    if (!box)
      throw new Error(
        "Couldn't find Flow's prompt box. Open the image tool, or show it with “Show Cutroom Flow's controls”.",
      )
    let attached = 'none'
    if (request.attachments?.length) {
      status('Adding the reference pictures…')
      attached = (await attach(request.attachments, request.controls?.attach, box)) ?? 'failed'
    }
    const before = new Set(pictures().map(srcOf))
    status('Typing the prompt…')
    if (!setPrompt(box, request.prompt)) {
      throw new Error(
        "Couldn't type into Flow's prompt box. Show Cutroom the prompt box with “Show Cutroom Flow's controls”.",
      )
    }
    await sleep(600)
    const button = generateButton(request.controls?.generate, box)
    if (!button)
      throw new Error("Couldn't find Flow's Generate button. Show it with “Show Cutroom Flow's controls”.")
    button.click()
    status('Flow is making the picture…')
    const found = await newPictures(
      before,
      { timeoutMs: request.timeoutMs, settleMs: request.settleMs },
      status,
    )
    if (found.length === 0) {
      throw new Error(`Flow made no new picture within ${Math.round(request.timeoutMs / 1000)} s.`)
    }
    status(`Saving ${found.length} ${found.length === 1 ? 'picture' : 'pictures'}…`)
    // Biggest first: the main result before any thumbnails of it.
    const images = await Promise.all(found.map(pictureData))
    images.sort((a, b) => b.width - a.width)
    return { images, attached }
  }

  // ---------------------------------------------------------------- showing Cutroom a control

  const TEACH = {
    prompt: {
      ask: 'Click the box where you type the prompt.',
      pick: 'textarea, input, [contenteditable], [role="textbox"]',
    },
    generate: { ask: 'Click the button that starts making the picture.', pick: 'button, [role="button"], a' },
    attach: {
      ask: 'Click the button that adds a picture (reference or ingredient).',
      pick: 'button, [role="button"], label, a',
    },
  }

  function teach(what) {
    const step = TEACH[what]
    return new Promise((resolve, reject) => {
      const banner = document.createElement('div')
      banner.textContent = `Cutroom: ${step.ask} Press Esc to cancel.`
      Object.assign(banner.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        background: '#151a23',
        color: '#fff',
        font: '600 14px system-ui, sans-serif',
        padding: '10px 16px',
        borderRadius: '8px',
        boxShadow: '0 6px 24px rgba(0,0,0,.3)',
        pointerEvents: 'none',
      })
      document.documentElement.append(banner)
      let outlined = null
      const outline = (el) => {
        if (outlined) outlined.style.outline = outlined.dataset.cutroomOutline ?? ''
        outlined = el
        if (el) {
          el.dataset.cutroomOutline = el.style.outline
          el.style.outline = '3px solid #ffb800'
        }
      }
      const target = (event) => event.target.closest?.(step.pick) ?? event.target
      const done = () => {
        outline(null)
        banner.remove()
        document.removeEventListener('mouseover', over, true)
        document.removeEventListener('click', click, true)
        document.removeEventListener('keydown', key, true)
      }
      const over = (event) => outline(target(event))
      const click = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const el = target(event)
        done()
        resolve(describe(el))
      }
      const key = (event) => {
        if (event.key !== 'Escape') return
        done()
        reject(new Error('Cancelled.'))
      }
      document.addEventListener('mouseover', over, true)
      document.addEventListener('click', click, true)
      document.addEventListener('keydown', key, true)
    })
  }

  /** Outlines the controls Cutroom would use now, for a moment. */
  async function check(controls) {
    const box = promptBox(controls?.prompt)
    const found = {
      prompt: box,
      generate: generateButton(controls?.generate, box),
      attach: locate(controls?.attach) ?? fileInput(),
    }
    for (const el of Object.values(found))
      if (el && el.type !== 'file') el.style.outline = '3px solid #ffb800'
    await sleep(2500)
    for (const el of Object.values(found)) if (el && el.type !== 'file') el.style.outline = ''
    return { prompt: Boolean(found.prompt), generate: Boolean(found.generate), attach: Boolean(found.attach) }
  }

  // ---------------------------------------------------------------- talking to the side panel

  const handlers = {
    ping: async () => ({ url: location.href }),
    teach: (message) => teach(message.what),
    check: (message) => check(message.controls),
    generate: (message, status) => generate(message, status),
  }

  globalThis.chrome?.runtime?.onConnect?.addListener((port) => {
    if (port.name !== 'cutroom-flow') return
    port.onMessage.addListener(async (message) => {
      const status = (text) => port.postMessage({ id: message.id, status: text })
      try {
        const result = await handlers[message.type](message, status)
        port.postMessage({ id: message.id, ok: true, result })
      } catch (error) {
        port.postMessage({
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })

  // For the extension's own test page (dev/fake-flow.html), which can't use chrome.runtime.
  if (window.__cutroomFlowTest) window.__cutroomFlowTest.handlers = handlers
})()
