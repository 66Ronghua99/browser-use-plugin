
import { AXNode, AXTreeManager } from './axtree';

export class Sidebar {
    private host: HTMLElement;
    private shadow: ShadowRoot;
    private manager: AXTreeManager;
    private highlightBox: HTMLElement | null = null;

    private isVisible: boolean = false;

    constructor(manager: AXTreeManager) {
        this.manager = manager;
        this.host = document.createElement('div');
        this.host.id = 'axtree-sidebar-host';
        this.host.style.display = 'none'; // Initially hidden
        this.shadow = this.host.attachShadow({ mode: 'open' });
    }

    public toggle() {
        this.isVisible = !this.isVisible;
        this.host.style.display = this.isVisible ? 'block' : 'none';
        if (this.isVisible) {
            this.refresh();
        }
    }

    public mount() {
        document.body.appendChild(this.host);
        this.shadow.innerHTML = `
            <style>
                :host {
                    all: initial;
                }
                .container {
                    position: fixed;
                    top: 0;
                    right: 0;
                    width: 350px;
                    height: 100vh;
                    background: #f8f9fa;
                    border-left: 1px solid #ddd;
                    box-shadow: -2px 0 5px rgba(0,0,0,0.1);
                    display: flex;
                    flex-direction: column;
                    font-family: system-ui, -apple-system, sans-serif;
                    z-index: 2147483647;
                }
                .header {
                    padding: 10px;
                    background: #333;
                    color: white;
                    font-weight: bold;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }
                .node-item {
                    background: white;
                    border: 1px solid #eee;
                    margin-bottom: 8px;
                    padding: 8px;
                    border-radius: 4px;
                    font-size: 13px;
                }
                .node-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 4px;
                }
                .ref-id {
                    background: #e1f5fe;
                    color: #0277bd;
                    padding: 2px 5px;
                    border-radius: 3px;
                    font-weight: bold;
                    font-size: 11px;
                }
                .role {
                    color: #555;
                    font-weight: 500;
                }
                .name {
                    color: #333;
                    margin-bottom: 6px;
                    display: block;
                }
                .controls {
                    display: flex;
                    gap: 5px;
                }
                button {
                    padding: 4px 8px;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    transition: background 0.2s;
                }
                .btn-highlight { return background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; }
                .btn-highlight:hover { background: #ffe0b2; }
                .btn-click { background: #e8f5e9; color: #1b5e20; border: 1px solid #c8e6c9; }
                .btn-click:hover { background: #c8e6c9; }
                
                #highlight-overlay {
                    position: fixed;
                    border: 2px solid red;
                    background: rgba(255, 0, 0, 0.1);
                    pointer-events: none;
                    z-index: 2147483646;
                    display: none;
                    transition: all 0.2s;
                }
            </style>
            <div id="highlight-overlay"></div>
            <div class="container">
                <div class="header">
                    AXTree Inspector
                    <button id="refresh-btn">Refresh</button>
                </div>
                <div class="content" id="list"></div>
            </div>
        `;

        this.highlightBox = this.shadow.getElementById('highlight-overlay');
        this.shadow.getElementById('refresh-btn')?.addEventListener('click', () => this.refresh());
    }

    public refresh() {
        const nodes = this.manager.capture(document.body);
        const list = this.shadow.getElementById('list');
        if (!list) return;

        list.innerHTML = '';
        const flatList: AXNode[] = [];
        this.flattenForDisplay(nodes, flatList);

        flatList.forEach(node => {
            const el = document.createElement('div');
            el.className = 'node-item';
            el.innerHTML = `
                <div class="node-header">
                    <span class="role">${node.role} (tag: ${node.tagName})</span>
                    <span class="ref-id">#${node.refId}</span>
                </div>
                ${node.name ? `<span class="name">"${node.name}"</span>` : ''}
                <div class="controls">
                    <button class="btn-highlight" data-id="${node.refId}">Highlight</button>
                    ${this.isInteractive(node) ? `<button class="btn-click" data-id="${node.refId}">Click</button>` : ''}
                    ${node.tagName === 'input' || node.tagName === 'textarea' ? `<button class="btn-input" data-id="${node.refId}">Input</button>` : ''}
                </div>
            `;
            list.appendChild(el);

            el.querySelector('.btn-highlight')?.addEventListener('click', () => this.highlight(node.refId));
            el.querySelector('.btn-click')?.addEventListener('click', () => this.click(node.refId));
            el.querySelector('.btn-input')?.addEventListener('click', () => {
                const val = prompt('Enter text:');
                if (val !== null) this.type(node.refId, val);
            });
        });
    }

    private flattenForDisplay(nodes: AXNode[], result: AXNode[]) {
        for (const node of nodes) {
            result.push(node);
            if (node.children) {
                this.flattenForDisplay(node.children, result);
            }
        }
    }

    private isInteractive(node: AXNode): boolean {
        return ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox'].includes(node.role) ||
            node.tagName === 'button' || node.tagName === 'a' || node.tagName === 'input';
    }

    private highlight(refId: number) {
        const el = this.manager.getElement(refId);
        if (!el || !this.highlightBox) return;

        const rect = el.getBoundingClientRect();
        this.highlightBox.style.display = 'block';
        this.highlightBox.style.left = `${rect.left}px`;
        this.highlightBox.style.top = `${rect.top}px`;
        this.highlightBox.style.width = `${rect.width}px`;
        this.highlightBox.style.height = `${rect.height}px`;

        // Also scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Hide after 2 seconds
        setTimeout(() => {
            if (this.highlightBox) this.highlightBox.style.display = 'none';
        }, 2000);
    }

    private click(refId: number) {
        const el = this.manager.getElement(refId);
        if (el) {
            this.highlight(refId);
            setTimeout(() => {
                (el as HTMLElement).click();
                console.log(`Clicked element #${refId}`);
            }, 200);
        }
    }

    private type(refId: number, text: string) {
        const el = this.manager.getElement(refId);
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            this.highlight(refId);
            (el as HTMLInputElement).value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`Typed "${text}" into element #${refId}`);
        }
    }
}
