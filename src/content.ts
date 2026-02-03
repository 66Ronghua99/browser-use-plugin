
import { AXTreeManager } from './axtree';
import { Sidebar } from './sidebar';

console.log("AXTree Extension Loaded.");

const axTreeManager = new AXTreeManager();
const sidebar = new Sidebar(axTreeManager);

// Mount invisible initially
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        sidebar.mount();
    });
} else {
    sidebar.mount();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TOGGLE_SIDEBAR') {
        sidebar.toggle();
    }
});

(window as any).getAXTree = () => {
    // Refresh to get latest state
    sidebar.refresh();
    const tree = axTreeManager.capture(document.body); // This might double work if refresh called capture, but OK.
    console.log(JSON.stringify(tree, null, 2));
    return tree;
};

(window as any).getElement = (refId: number) => {
    return axTreeManager.getElement(refId);
};
