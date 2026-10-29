/**
 * A DOM + canvas stub just good enough to boot src/main.js under node --test.
 * It renders into a no-op 2D context and mirrors the classes the real HTML ships
 * with, so title/pause state behaves the way it does in a browser.
 */

import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const ctxStub = new Proxy(
  {
    measureText: () => ({ width: 64 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
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
    this.dataset = {};
    this.children = [];
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
      fn({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0, deltaY: 0, ...event });
    }
  }

  getBoundingClientRect() {
    return { width: 1366, height: 768, left: 0, top: 0, right: 1366, bottom: 768 };
  }

  getContext() {
    return ctxStub;
  }

  setPointerCapture() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    this.html = value;
    this.children = [];
  }

  get innerHTML() {
    return this.html || '';
  }

  get offsetWidth() {
    return 120;
  }
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
        const el = new Element(id);
        for (const c of initialClasses(id)) el.classList.add(c);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement: (tag) => new Element(tag),
    addEventListener() {},
    hidden: false,
  };

  globalThis.window = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    devicePixelRatio: 2,
    AudioContext: class {
      constructor() {
        this.currentTime = 0;
        this.state = 'running';
        this.destination = {};
      }

      createOscillator() {
        return {
          type: '',
          frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() { return this; },
          start() {},
          stop() {},
        };
      }

      createGain() {
        return {
          gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() { return this; },
        };
      }

      resume() {}
    },
  };

  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.ResizeObserver = class { observe() {} };

  let clock = 0;

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
    /** Run `n` animation frames at ~60 fps. */
    run(n) {
      for (let i = 0; i < n; i++) {
        const fn = frames.shift();
        if (!fn) throw new Error('the game stopped scheduling frames');
        clock += 1000 / 60;
        fn(clock);
      }
    },
  };
}
