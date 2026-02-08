
import { computeAccessibleName, getRole } from 'dom-accessibility-api';

export interface AXNode {
    refId?: number;              // Only interactive elements have refId
    role: string;
    name?: string;               // Semantic label (from accessible name or ancestor context)
    tagName?: string;            // Only for interactive elements
    attributes?: Record<string, string>;
    value?: string | null;
    children?: AXNode[];
}

// Compact node format: [refId, role, name, value?]
export type CompactAXNode = [number, string, string, string?];

// Configuration for token optimization
const MAX_NAME_LENGTH = 80;  // Truncate long names to save tokens

/**
 * Truncate name to save tokens while preserving meaning
 */
function truncateName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    if (name.length <= MAX_NAME_LENGTH) return name;
    return name.substring(0, MAX_NAME_LENGTH - 3) + '...';
}

// Technical data-* attributes to ignore
const TECHNICAL_DATA_ATTRS = [
    'data-v-', 'data-reactroot', 'data-reactid', 'data-testid',
    'data-cy', 'data-index', 'data-key', 'data-id', 'data-node-key'
];

// Keywords that suggest a data-* attribute contains semantic label
const SEMANTIC_DATA_KEYWORDS = /label|name|title|desc|text|field|heading|caption/i;

/**
 * Extract semantic label from data-* attributes
 */
function extractDataLabel(element: Element): string | null {
    for (const attr of Array.from(element.attributes)) {
        if (!attr.name.startsWith('data-')) continue;
        // Skip technical attributes
        if (TECHNICAL_DATA_ATTRS.some(tech => attr.name.startsWith(tech))) continue;
        // Check if attribute name suggests semantic value
        if (SEMANTIC_DATA_KEYWORDS.test(attr.name) && attr.value.trim()) {
            return attr.value.trim();
        }
    }
    return null;
}

/**
 * Get text from aria-labelledby referenced elements
 */
function getAriaLabelledByText(element: Element): string | null {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (!labelledBy) return null;

    const ids = labelledBy.split(/\s+/);
    const texts: string[] = [];
    for (const id of ids) {
        const labelEl = document.getElementById(id);
        if (labelEl) {
            const text = labelEl.textContent?.trim();
            if (text) texts.push(text);
        }
    }
    return texts.length > 0 ? texts.join(' ') : null;
}

/**
 * Get heading text from within a container element
 */
function getHeadingText(element: Element): string | null {
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
        const text = heading.textContent?.trim();
        if (text && text.length < 100) return text;
    }
    return null;
}

/**
 * Get legend text from fieldset
 */
function getLegendText(element: Element): string | null {
    if (element.tagName.toLowerCase() === 'fieldset') {
        const legend = element.querySelector('legend');
        if (legend) {
            const text = legend.textContent?.trim();
            if (text) return text;
        }
    }
    return null;
}

/**
 * Comprehensive semantic label extraction with priority
 */
function getSemanticLabel(element: Element): string | null {
    return (
        element.getAttribute('aria-label') ||
        getAriaLabelledByText(element) ||
        extractDataLabel(element) ||
        getLegendText(element) ||
        getHeadingText(element) ||
        null
    );
}

export class AXTreeManager {
    private elementMap: Map<number, Element> = new Map();
    private counter: number = 0;



    /**
     * Build a semantic tree that preserves ancestor context for interactive elements
     */
    public captureTree(root: Element): AXNode | null {
        this.elementMap.clear();
        this.counter = 0;
        const children = this.buildSemanticTree(root);
        if (children.length === 0) return null;
        if (children.length === 1) return children[0];
        return {
            role: 'tree',
            children: children
        };
    }

    private buildSemanticTree(element: Element): AXNode[] {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || element.getAttribute('aria-hidden') === 'true') {
            return [];
        }

        const tag = element.tagName.toLowerCase();

        // Skip SVG internals
        const svgSkip = ['path', 'g', 'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'mask', 'use', 'symbol', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'text', 'tspan', 'style'];
        if (svgSkip.includes(tag)) {
            return [];
        }

        const role = getRole(element);

        // Recursively get children first
        let children: AXNode[] = [];
        for (const child of Array.from(element.children)) {
            children.push(...this.buildSemanticTree(child));
        }

        // Interactive roles
        const interactiveRoles = [
            'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
            'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch',
            'slider', 'spinbutton', 'searchbox', 'scrollbar', 'progressbar'
        ];

        const isInteractive = role && interactiveRoles.includes(role);
        const hasTabindex = element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1';
        const isClickable = element.hasAttribute('onclick') || element.hasAttribute('data-click') ||
            (element as HTMLElement).onclick !== null;

        const isInteractiveElement = isInteractive || hasTabindex || isClickable;

        // Check if this element has semantic label
        const semanticLabel = getSemanticLabel(element);

        // If interactive element, create a node with refId
        if (isInteractiveElement) {
            let name = computeAccessibleName(element);
            if (!name) {
                name = this.getFallbackName(element);
            }

            this.counter++;
            const refId = this.counter;
            this.elementMap.set(refId, element);

            const node: AXNode = {
                refId: refId,
                role: role || 'generic',
                name: truncateName(name),  // Apply truncation to save tokens
                tagName: tag,
                attributes: this.getCompactAttributes(element),  // Use compact attributes
                value: (element as HTMLInputElement).value || undefined,
            };

            // Include children if they exist (nested interactive elements)
            if (children.length > 0) {
                node.children = children;
            }

            return [node];
        }

        // If has semantic label and has interactive descendants, keep as container
        if (semanticLabel && children.length > 0) {
            return [{
                role: role || 'group',
                name: truncateName(semanticLabel),  // Apply truncation
                children: children
            }];
        }

        // Otherwise, hoist children up (skip this node)
        return children;
    }

    public getElement(refId: number): Element | undefined {
        return this.elementMap.get(refId);
    }

    /**
     * Capture a compact flat list of interactive elements
     * Format: [[refId, role, name, value?], ...]
     * Much smaller than full tree - saves ~85% tokens
     */
    public captureCompactTree(root: Element): CompactAXNode[] {
        this.elementMap.clear();
        this.counter = 0;

        const result: CompactAXNode[] = [];
        this.collectInteractiveElements(root, result);
        return result;
    }

    private collectInteractiveElements(element: Element, result: CompactAXNode[]): void {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || element.getAttribute('aria-hidden') === 'true') {
            return;
        }

        const tag = element.tagName.toLowerCase();

        // Skip SVG internals
        const svgSkip = ['path', 'g', 'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'mask', 'use', 'symbol', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'text', 'tspan', 'style'];
        if (svgSkip.includes(tag)) {
            return;
        }

        const role = getRole(element);

        // Interactive roles
        const interactiveRoles = [
            'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
            'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch',
            'slider', 'spinbutton', 'searchbox', 'scrollbar', 'progressbar'
        ];

        const isInteractive = role && interactiveRoles.includes(role);
        const hasTabindex = element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1';
        const isClickable = element.hasAttribute('onclick') || element.hasAttribute('data-click') ||
            (element as HTMLElement).onclick !== null;

        if (isInteractive || hasTabindex || isClickable) {
            let name = computeAccessibleName(element);
            if (!name) {
                name = this.getFallbackName(element);
            }

            this.counter++;
            const refId = this.counter;
            this.elementMap.set(refId, element);

            const value = (element as HTMLInputElement).value;
            const truncatedName = truncateName(name) || '';

            if (value) {
                result.push([refId, role || 'generic', truncatedName, value]);
            } else {
                result.push([refId, role || 'generic', truncatedName]);
            }
        }

        // Recurse into children
        for (const child of Array.from(element.children)) {
            this.collectInteractiveElements(child, result);
        }
    }

    /**
     * Get only essential attributes to reduce token usage
     */
    private getCompactAttributes(element: Element): Record<string, string> | undefined {
        const attrs: Record<string, string> = {};

        // Only include attributes that help with interaction, skip redundant ones
        const importantAttrs = ['aria-expanded', 'aria-checked', 'aria-selected', 'aria-disabled', 'disabled', 'type', 'placeholder'];

        for (const attrName of importantAttrs) {
            const value = element.getAttribute(attrName);
            if (value !== null) {
                attrs[attrName] = value;
            }
        }

        return Object.keys(attrs).length > 0 ? attrs : undefined;
    }

    /**
     * Fallback strategies to extract a meaningful name when computeAccessibleName fails.
     */
    private getFallbackName(element: Element): string {
        const tag = element.tagName.toLowerCase();

        // 0. Check for data-* attributes that contain label info (common in form frameworks)
        const dataAttrs = ['data-form-field-i18n-name', 'data-label', 'data-field-label', 'data-name'];
        for (const attr of dataAttrs) {
            // Check on element itself
            let value = element.getAttribute(attr);
            if (value) return value;

            // Check on parent/ancestor elements
            const ancestor = element.closest(`[${attr}]`);
            if (ancestor) {
                value = ancestor.getAttribute(attr);
                if (value) return value;
            }
        }

        // 0.5 Look for label in ancestor containers with label-like class names
        const labelClasses = ['label', 'form-label', 'formily-item-label', 'field-label', 'input-label', 'ant-form-item-label'];
        let current: Element | null = element.parentElement;
        let depth = 0;
        while (current && depth < 5) {
            // Check sibling elements with label-like classes
            for (const sibling of Array.from(current.children)) {
                if (sibling === element || sibling.contains(element)) continue;
                const sibClasses = sibling.className?.toString()?.toLowerCase() || '';
                const hasLabelClass = labelClasses.some(cls => sibClasses.includes(cls));
                if (hasLabelClass || sibling.tagName === 'LABEL') {
                    const text = sibling.textContent?.trim();
                    if (text && text.length < 100) {
                        return text.replace(/[*:：\s]+$/, '').trim();
                    }
                }
            }
            current = current.parentElement;
            depth++;
        }

        // 1. Check for placeholder attribute (common for inputs)
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
            return placeholder;
        }

        // 2. Check for title attribute
        const title = element.getAttribute('title');
        if (title) {
            return title;
        }

        // 3. For inputs, try to find associated label
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
            const id = element.getAttribute('id');
            if (id) {
                const label = document.querySelector(`label[for="${id}"]`);
                if (label) {
                    return label.textContent?.trim() || '';
                }
            }

            // Check if wrapped in a label
            const parentLabel = element.closest('label');
            if (parentLabel) {
                // Get text content excluding the input itself
                const clone = parentLabel.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('input, select, textarea').forEach(el => el.remove());
                const labelText = clone.textContent?.trim();
                if (labelText) {
                    return labelText;
                }
            }

            // Look for preceding sibling or nearby text that might be label
            const prevSibling = element.previousElementSibling;
            if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'DIV')) {
                const text = prevSibling.textContent?.trim();
                if (text && text.length < 50) {
                    return text.replace(/[*:：]$/, '').trim(); // Remove trailing * or :
                }
            }

            // Check parent container for label-like text
            const parent = element.parentElement;
            if (parent) {
                // Look for label-like siblings in parent
                for (const sibling of Array.from(parent.children)) {
                    if (sibling === element) continue;
                    const siblingTag = sibling.tagName.toLowerCase();
                    if (['label', 'span', 'div', 'p'].includes(siblingTag)) {
                        const text = sibling.textContent?.trim();
                        if (text && text.length < 50 && !text.includes('\n')) {
                            return text.replace(/[*:：]$/, '').trim();
                        }
                    }
                }
            }
        }

        // 4. For buttons without name, check for icon description or inner text
        if (tag === 'button' || element.getAttribute('role') === 'button') {
            // Check for aria-label on child icons
            const icon = element.querySelector('[aria-label], [title]');
            if (icon) {
                return icon.getAttribute('aria-label') || icon.getAttribute('title') || '';
            }

            // Get visible text
            const text = element.textContent?.trim();
            if (text && text.length < 100) {
                return text;
            }
        }

        // 5. For links, get href as last resort context
        if (tag === 'a') {
            const href = element.getAttribute('href');
            const text = element.textContent?.trim();
            if (text) return text;
            if (href && !href.startsWith('javascript:')) {
                // Extract filename or last path segment
                try {
                    const url = new URL(href, window.location.href);
                    const path = url.pathname.split('/').filter(s => s).pop();
                    if (path) return path;
                } catch {
                    // Ignore URL parse errors
                }
            }
        }

        return '';
    }

    private getAttributes(element: Element): Record<string, string> {
        const attrs: Record<string, string> = {};
        const allowList = ['type', 'placeholder', 'alt', 'title', 'aria-label', 'aria-checked', 'aria-expanded', 'aria-selected', 'disabled', 'readonly', 'name', 'id'];

        for (const name of allowList) {
            const val = element.getAttribute(name);
            if (val !== null) {
                attrs[name] = val;
            }
        }
        return attrs;
    }
}
