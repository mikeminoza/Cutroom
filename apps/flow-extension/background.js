// Opens the side panel when you click the extension's icon. Everything else happens in the side
// panel (sidepanel.js) and in Flow's page (content.js).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
