
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

// Message handler for commands from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TOGGLE_SIDEBAR') {
        sidebar.toggle();
        return false;
    }

    if (message.action === 'GET_AX_TREE') {
        try {
            const tree = axTreeManager.capture(document.body);
            // Flatten the tree - remove children nesting
            const flatNodes = flattenTree(tree);
            sendResponse({
                success: true,
                data: flatNodes,
                url: window.location.href,
                title: document.title
            });
        } catch (e) {
            sendResponse({ success: false, error: String(e) });
        }
        return true; // Keep channel open for async response
    }

    if (message.action === 'EXECUTE_ACTION') {
        const { type, refId, text } = message.params || {};
        try {
            const result = executeAction(type, refId, text);
            sendResponse({ success: true, result });
        } catch (e) {
            sendResponse({ success: false, error: String(e) });
        }
        return true;
    }

    return false;
});

// Flatten AXTree by removing children nesting
function flattenTree(nodes: any[]): any[] {
    const result: any[] = [];
    function traverse(nodeList: any[]) {
        for (const node of nodeList) {
            const { children, ...flatNode } = node;
            result.push(flatNode);
            if (children) {
                traverse(children);
            }
        }
    }
    traverse(nodes);
    return result;
}

// Execute browser actions by refId
function executeAction(type: string, refId: number, text?: string): any {
    const element = axTreeManager.getElement(refId);
    if (!element) {
        throw new Error(`Element with refId ${refId} not found`);
    }

    const htmlElement = element as HTMLElement;

    switch (type) {
        case 'click':
            htmlElement.click();
            return { clicked: true, refId };

        case 'type':
            if (!text) {
                throw new Error('Text is required for type action');
            }
            if (htmlElement.tagName === 'INPUT' || htmlElement.tagName === 'TEXTAREA') {
                (htmlElement as HTMLInputElement).value = text;
                htmlElement.dispatchEvent(new Event('input', { bubbles: true }));
                htmlElement.dispatchEvent(new Event('change', { bubbles: true }));
                return { typed: true, refId, text };
            } else {
                throw new Error(`Element ${refId} is not an input or textarea`);
            }

        case 'focus':
            htmlElement.focus();
            return { focused: true, refId };

        case 'scroll':
            htmlElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { scrolled: true, refId };

        case 'hover':
            htmlElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            htmlElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            return { hovered: true, refId };

        case 'clear':
            if (htmlElement.tagName === 'INPUT' || htmlElement.tagName === 'TEXTAREA') {
                (htmlElement as HTMLInputElement).value = '';
                htmlElement.dispatchEvent(new Event('input', { bubbles: true }));
                htmlElement.dispatchEvent(new Event('change', { bubbles: true }));
                return { cleared: true, refId };
            } else {
                throw new Error(`Element ${refId} is not an input or textarea`);
            }

        default:
            throw new Error(`Unknown action type: ${type}`);
    }
}

// Expose functions for manual debugging in console
(window as any).getAXTree = () => {
    sidebar.refresh();
    const tree = axTreeManager.capture(document.body);
    console.log(JSON.stringify(tree, null, 2));
    return tree;
};

(window as any).getElement = (refId: number) => {
    return axTreeManager.getElement(refId);
};

(window as any).executeAction = executeAction;
