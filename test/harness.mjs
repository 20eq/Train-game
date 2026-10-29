/**
 * Minimal DOM/canvas stub so the real game.js can boot inside node --test.
 * It renders into a no-op 2D context and exposes the internals via window.__TG.
 */

const ctxStub = new Proxy(
  {
    measureText: () => ({ width: 60 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    canvas: null,
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
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.className = '';
    this.style = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !this.classes.has(c) : Boolean(on);
        if (next) this.classes.add(c);
        else this.classes.delete(c);
        return next;
      },
    };
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) {
      fn({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, ...event });
    }
  }

  getBoundingClientRect() {
    return { width: 960, height: 640, left: 0, top: 0, right: 960, bottom: 640 };
  }

  getContext() {
    return ctxStub;
  }

  setPointerCapture() {}

  get offsetWidth() {
    return 100;
  }
}

export function installDom() {
  const elements = new Map();
  const windowListeners = new Map();

  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(id));
      return elements.get(id);
    },
    addEventListener() {},
    hidden: false,
  };

  globalThis.window = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    devicePixelRatio: 1,
  };

  globalThis.requestAnimationFrame = () => 0;
  globalThis.ResizeObserver = undefined;

  const key = (type, code) => {
    for (const fn of windowListeners.get(type) || []) fn({ code, preventDefault() {} });
  };

  return { elements, key };
}
