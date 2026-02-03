
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_SIDEBAR" }).catch(err => {
            console.warn("Could not send message to tab (content script might not be loaded):", err);
        });
    }
});
