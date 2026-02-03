
import { computeAccessibleName, getRole } from 'dom-accessibility-api';

export interface AXNode {
    refId: number;
    role: string;
    name: string;
    tagName: string;
    attributes: Record<string, string>;
    value?: string | null;
    children?: AXNode[];
}

export class AXTreeManager {
    private elementMap: Map<number, Element> = new Map();
    private counter: number = 0;

    public capture(root: Element): AXNode[] {
        this.elementMap.clear();
        this.counter = 0;
        return this.buildTree(root);
    }

    public getElement(refId: number): Element | undefined {
        return this.elementMap.get(refId);
    }

    private buildTree(element: Element): AXNode[] {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || element.getAttribute('aria-hidden') === 'true') {
            return [];
        }

        const tag = element.tagName.toLowerCase();

        // Skip all SVG internals - only keep interactive SVGs as a single unit
        const svgSkip = ['path', 'g', 'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'mask', 'use', 'symbol', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline', 'text', 'tspan', 'style'];
        if (svgSkip.includes(tag)) {
            return [];
        }

        const role = getRole(element);

        // Recursively get children first
        let children: AXNode[] = [];
        for (const child of Array.from(element.children)) {
            children.push(...this.buildTree(child));
        }

        // Define interactive roles that we want to keep
        const interactiveRoles = [
            'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
            'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch',
            'slider', 'spinbutton', 'searchbox', 'scrollbar', 'progressbar'
        ];

        // Define structural roles that provide context (keep if they have a name)
        const structuralRoles = [
            'heading', 'navigation', 'main', 'banner', 'contentinfo', 'complementary',
            'form', 'region', 'article', 'alert', 'dialog', 'alertdialog', 'menu',
            'menubar', 'tablist', 'tabpanel', 'tree', 'treegrid', 'grid', 'table',
            'list', 'listitem', 'group'
        ];

        const isInteractive = role && interactiveRoles.includes(role);
        const isStructuralWithName = role && structuralRoles.includes(role);
        const hasTabindex = element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1';
        const isClickable = element.hasAttribute('onclick') || element.hasAttribute('data-click') ||
            (element as HTMLElement).onclick !== null;

        // Determine if this element is worth keeping
        const shouldKeep = isInteractive || hasTabindex || isClickable;

        // For structural elements without names, just flatten to children
        if (!shouldKeep) {
            // Keep structural with meaningful children or name
            if (isStructuralWithName && children.length > 0) {
                // Just return children flattened - structure is less important for LLM
                return children;
            }
            return children;
        }

        // It's an interactive node - capture it
        let name = computeAccessibleName(element);
        if (!name) {
            name = this.getFallbackName(element);
        }

        this.counter++;
        const refId = this.counter;
        this.elementMap.set(refId, element);

        return [{
            refId: refId,
            role: role || 'generic',
            name: name,
            tagName: tag,
            attributes: this.getAttributes(element),
            value: (element as HTMLInputElement).value || undefined,
            children: children.length > 0 ? children : undefined
        }];
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
