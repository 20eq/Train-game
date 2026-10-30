/**
 * A DOM + canvas stub just good enough to boot the real app under node.
 * It reads index.html so overlay state starts the way it does in a browser.
 */

import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const ctxStub = new Proxy(
  {
    measureText: () => ({ width: 64 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  },
);

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this.textContent = '';
    this.className = '';
    this.style = {
      setProperty(key, value) { this[key] = value; },
      getPropertyValue(key) { return this[key] || ''; },
      removeProperty(key) { delete this[key]; },
    };
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this.classes.add(x)),
      remove: (...c) => c.forEach((x) => this.classes.delete(x)),
      contains: (c) => this.classes.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !this.classes.has(c) : Boolean(on);
        if (next) this.classes.add(c);
        else this.classes.delete(c);
        return next;
      },
    };
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) {
      fn({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, deltaY: 0, ...event });
    }
  }

  getBoundingClientRect() {
    return { width: 1280, height: 720, left: 0, top: 0, right: 1280, bottom: 720 };
  }

  getContext() { return ctxStub; }

  setPointerCapture() {}

  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    this.html = value;
    if (value === '') this.children = [];
  }

  get innerHTML() {
    return this.html || '';
  }

  removeAttribute(name) {
    delete this[name];
    if (name === 'hidden') this.hidden = false;
  }

  setAttribute(name, value) {
    this[name] = value;
    if (name === 'hidden') this.hidden = true;
  }

  get offsetWidth() { return 120; }
}

function initialClasses(id) {
  const patterns = [
    new RegExp(`id="${id}"[^>]*class="([^"]*)"`),
    new RegExp(`class="([^"]*)"[^>]*id="${id}"`),
  ];
  for (const re of patterns) {
    const m = HTML.match(re);
    if (m) return m[1].split(/\s+/).filter(Boolean);
  }
  return [];
}

export function installDom() {
  const elements = new Map();
  const windowListeners = new Map();

  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const el = new Element('div');
        el.id = id;
        for (const c of initialClasses(id)) el.classList.add(c);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement(tag) {
      if (tag === 'canvas') {
        const c = new Element('canvas');
        c.width = 0;
        c.height = 0;
        c.getContext = () => ctxStub;
        return c;
      }
      return new Element(tag);
    },
    addEventListener() {},
    hidden: false,
  };

  globalThis.window = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    AudioContext: class {
      constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
      createOscillator() {
        return {
          type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() { return this; }, start() {}, stop() {},
        };
      }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } };
      }
      resume() {}
    },
  };

  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.ResizeObserver = class { observe() {} };

  return {
    elements,
    press(code) {
      for (const fn of windowListeners.get('keydown') || []) {
        fn({ code, key: code, repeat: false, preventDefault() {} });
      }
    },
    release(code) {
      for (const fn of windowListeners.get('keyup') || []) {
        fn({ code, key: code, preventDefault() {} });
      }
    },
  };
}
