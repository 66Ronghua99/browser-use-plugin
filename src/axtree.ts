
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

        const role = getRole(element);
        const name = computeAccessibleName(element);

        // Recursively get children
        let children: AXNode[] = [];
        for (const child of Array.from(element.children)) {
            children.push(...this.buildTree(child));
        }

        const isGeneric = !role || role === 'generic' || role === 'presentation' || role === 'none';

        if (isGeneric && !name) {
            // This is a wrapper. Return its children directly (flattening).
            return children;
        }

        // It's an interesting node.
        this.counter++;
        const refId = this.counter;
        this.elementMap.set(refId, element);

        return [{
            refId: refId,
            role: role || 'generic',
            name: name,
            tagName: element.tagName.toLowerCase(),
            attributes: this.getAttributes(element),
            value: (element as HTMLInputElement).value || undefined,
            children: children.length > 0 ? children : undefined
        }];
    }

    private getAttributes(element: Element): Record<string, string> {
        const attrs: Record<string, string> = {};
        const allowList = ['type', 'placeholder', 'alt', 'title', 'aria-label', 'aria-checked', 'aria-expanded', 'aria-selected', 'disabled', 'readonly'];

        for (const name of allowList) {
            const val = element.getAttribute(name);
            if (val !== null) {
                attrs[name] = val;
            }
        }
        return attrs;
    }
}
