
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
            const tree = axTreeManager.captureTree(document.body);
            sendResponse({
                success: true,
                data: tree,
                url: window.location.href,
                title: document.title
            });
        } catch (e) {
            sendResponse({ success: false, error: String(e) });
        }
        return true; // Keep channel open for async response
    }

    // Compact format: [[refId, role, name, value?], ...]
    // Saves ~85% tokens compared to full tree
    if (message.action === 'GET_AX_TREE_COMPACT') {
        try {
            const compactTree = axTreeManager.captureCompactTree(document.body);
            sendResponse({
                success: true,
                data: compactTree,
                url: window.location.href,
                title: document.title,
                count: compactTree.length
            });
        } catch (e) {
            sendResponse({ success: false, error: String(e) });
        }
        return true;
    }

    if (message.action === 'GET_PAGE_TEXT') {
        try {
            const params = message.params || {};
            const maxLength = params.maxLength || 8000;
            const selector = params.selector || null;

            const textContent = extractPageText(selector, maxLength);
            sendResponse({
                success: true,
                data: textContent,
                url: window.location.href,
                title: document.title
            });
        } catch (e) {
            sendResponse({ success: false, error: String(e) });
        }
        return true;
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

/**
 * Extract readable text content from the page
 * Useful for reading email body, article content, etc.
 */
function extractPageText(selector: string | null, maxLength: number): { text: string; truncated: boolean } {
    let root: Element = document.body;

    if (selector) {
        const selected = document.querySelector(selector);
        if (selected) {
            root = selected;
        }
    }

    // Common content selectors for various sites
    const contentSelectors = [
        // Gmail email body
        '[role="main"] .a3s.aiL',
        '[role="main"] .ii.gt',
        // Generic article content
        'article',
        '[role="article"]',
        'main',
        '[role="main"]',
        '.content',
        '#content',
    ];

    // Try to find main content area
    let contentRoot = root;
    if (!selector) {
        for (const sel of contentSelectors) {
            const found = root.querySelector(sel);
            if (found && found.textContent && found.textContent.trim().length > 100) {
                contentRoot = found;
                break;
            }
        }
    }

    // Extract text, preserving some structure
    const textParts: string[] = [];

    function extractText(element: Element, depth: number = 0): void {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return;
        }

        const tag = element.tagName.toLowerCase();

        // Skip certain elements
        const skipTags = ['script', 'style', 'noscript', 'svg', 'img', 'video', 'audio', 'iframe'];
        if (skipTags.includes(tag)) {
            return;
        }

        // Block-level elements that should have line breaks
        const blockTags = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'section', 'article', 'header', 'footer', 'br', 'hr'];

        // Add heading markers
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
            const text = element.textContent?.trim();
            if (text) {
                const level = parseInt(tag[1]);
                const prefix = '#'.repeat(level);
                textParts.push(`\n${prefix} ${text}\n`);
                return;
            }
        }

        // Process children
        let hasChildElements = false;
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent?.trim();
                if (text) {
                    textParts.push(text);
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                hasChildElements = true;
                extractText(child as Element, depth + 1);
            }
        }

        // Add line break after block elements
        if (blockTags.includes(tag) && textParts.length > 0) {
            const lastPart = textParts[textParts.length - 1];
            if (lastPart && !lastPart.endsWith('\n')) {
                textParts.push('\n');
            }
        }
    }

    extractText(contentRoot);

    // Clean up the text
    let fullText = textParts
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const truncated = fullText.length > maxLength;
    if (truncated) {
        fullText = fullText.substring(0, maxLength) + '...';
    }

    return { text: fullText, truncated };
}

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
function executeAction(type: string, refId: number | null, text?: string): any {
    // Handle global actions that don't require a specific element
    if (type === 'keypress') {
        if (!text) {
            throw new Error('Key is required for keypress action');
        }
        return sendKeypress(text);
    }

    if (type === 'scroll_page') {
        const direction = text || 'down';
        if (direction === 'up') {
            window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (direction === 'down') {
            window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        } else if (direction === 'top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (direction === 'bottom') {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
        return { scrolled: true, direction };
    }

    // Element-specific actions require refId
    if (refId === null || refId === undefined) {
        throw new Error(`refId is required for action type: ${type}`);
    }

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

// Send keyboard events
function sendKeypress(key: string): any {
    const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
        'enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
        'escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
        'tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
        'backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        'delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
        'arrowup': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        'arrowdown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        'arrowright': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        'space': { key: ' ', code: 'Space', keyCode: 32 },
        'home': { key: 'Home', code: 'Home', keyCode: 36 },
        'end': { key: 'End', code: 'End', keyCode: 35 },
        'pageup': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
        'pagedown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    };

    const keyLower = key.toLowerCase();
    const keyInfo = keyMap[keyLower] || { key: key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

    const target = document.activeElement || document.body;

    const keydownEvent = new KeyboardEvent('keydown', {
        key: keyInfo.key,
        code: keyInfo.code,
        keyCode: keyInfo.keyCode,
        which: keyInfo.keyCode,
        bubbles: true,
        cancelable: true
    });

    const keypressEvent = new KeyboardEvent('keypress', {
        key: keyInfo.key,
        code: keyInfo.code,
        keyCode: keyInfo.keyCode,
        which: keyInfo.keyCode,
        bubbles: true,
        cancelable: true
    });

    const keyupEvent = new KeyboardEvent('keyup', {
        key: keyInfo.key,
        code: keyInfo.code,
        keyCode: keyInfo.keyCode,
        which: keyInfo.keyCode,
        bubbles: true,
        cancelable: true
    });

    target.dispatchEvent(keydownEvent);
    target.dispatchEvent(keypressEvent);
    target.dispatchEvent(keyupEvent);

    return { keypress: true, key: keyInfo.key, target: (target as HTMLElement).tagName };
}

// Expose functions for manual debugging in console
(window as any).getAXTree = () => {
    sidebar.refresh();
    const tree = axTreeManager.captureTree(document.body);
    console.log(JSON.stringify(tree, null, 2));
    return tree;
};

(window as any).getElement = (refId: number) => {
    return axTreeManager.getElement(refId);
};

(window as any).executeAction = executeAction;
