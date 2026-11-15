// Persona Icons for plain HTML pages: a vanilla port of PersonaIcon.tsx + useInteraction.ts + Face.tsx
// (persona-icons skill). The engine (controller, interaction, personalities, presets, rigs) is used
// unchanged; only the React binding is rewritten, so the landing needs no React and no build step.
//
//   <span data-persona="ghost" data-personality="shy" data-size="140" data-label="Ghost"></span>
//   mountPersonas();

import { PersonaController } from './controller';
import {
  defaultInteractionConfig,
  initialInteractionState,
  nextInteractionDeadline,
  reduceInteraction,
  type InteractionConfig,
  type InteractionInput,
  type PointerKind,
} from './interaction';
import { prefersReducedMotion } from './motion';
import { personalities, type PersonalityName } from './personalities';
import { resolveRig } from './rigs';
import { iconNodes } from './icons';
import type { Expression, FaceSpec, PersonaEvent, Personality } from './types';

const SVG = 'http://www.w3.org/2000/svg';
const f = (n: number) => Math.round(n * 100) / 100;

/* ── Face overlay (port of Face.tsx): strokes in the icon's own 24×24 grid ── */
function eyePath(expr: Expression, x: number, y: number, size: number, side: -1 | 1): string {
  const g = Math.min(1.4, Math.max(0.8, size));
  const line = `M${f(x)} ${f(y - size / 2)}v${f(size)}`;
  const dot = (dy = 0) => `M${f(x)} ${f(y + dy)}h.01`;
  const arcUp = `M${f(x - g)} ${f(y + 0.35 * g)}Q${f(x)} ${f(y - 1.05 * g)} ${f(x + g)} ${f(y + 0.35 * g)}`;
  const brow = (innerLift: number) => {
    const outerX = x - side * g;
    const innerX = x + side * 0.8 * g;
    return `M${f(outerX)} ${f(y - 1.1 * g + (innerLift > 0 ? 0.6 * g : 0))}L${f(innerX)} ${f(y - 1.1 * g + (innerLift > 0 ? 0 : 0.6 * g))}`;
  };
  switch (expr) {
    case 'neutral': return line;
    case 'happy':
    case 'love': return arcUp;
    case 'wink': return side === -1 ? line : arcUp;
    case 'bashful': return dot(0.4 * g);
    case 'closed': return `M${f(x - g)} ${f(y)}h${f(2 * g)}`;
    case 'sleepy': return `M${f(x - g)} ${f(y - 0.2 * g)}h${f(2 * g)}${dot(0.45 * g)}`;
    case 'angry': return `${dot(0.2 * g)}${brow(-1)}`;
    case 'sad': return `${dot(0.2 * g)}${brow(1)}`;
    case 'dizzy': return `M${f(x - 0.7 * g)} ${f(y - 0.7 * g)}l${f(1.4 * g)} ${f(1.4 * g)}M${f(x + 0.7 * g)} ${f(y - 0.7 * g)}l${f(-1.4 * g)} ${f(1.4 * g)}`;
    case 'squint': {
      const tip = x + side * -0.6 * g;
      const back = x + side * 0.8 * g;
      return `M${f(back)} ${f(y - 0.75 * g)}L${f(tip)} ${f(y)}L${f(back)} ${f(y + 0.75 * g)}`;
    }
    case 'focused': return `${line}M${f(x - g)} ${f(y - size / 2 - 0.9)}h${f(2 * g)}`;
    case 'surprised': return '';
  }
}

function mouthPath(expr: Expression, x: number, y: number): string | null {
  switch (expr) {
    case 'happy':
    case 'love':
    case 'wink': return `M${f(x - 1)} ${f(y)}Q${f(x)} ${f(y + 1.1)} ${f(x + 1)} ${f(y)}`;
    case 'sad': return `M${f(x - 1)} ${f(y + 0.5)}Q${f(x)} ${f(y - 0.5)} ${f(x + 1)} ${f(y + 0.5)}`;
    case 'angry': return `M${f(x - 0.9)} ${f(y)}h1.8`;
    case 'dizzy': return `M${f(x - 1.2)} ${f(y)}q.6 -.6 1.2 0t1.2 0`;
    default: return null;
  }
}

function faceMarkup(face: FaceSpec, expression: Expression, drawNeutral: boolean): string {
  if (expression === 'neutral' && !drawNeutral) return '';
  const size = face.size ?? 1;
  const blush = expression === 'love' || expression === 'bashful';
  const mouth = face.mouth && expression !== 'surprised' ? mouthPath(expression, face.mouth[0], face.mouth[1]) : null;
  const eyes = face.eyes.map(([x, y], i) => {
    const side = (i === 0 ? -1 : 1) as -1 | 1;
    const glyph = expression === 'surprised'
      ? `<circle cx="${x}" cy="${y}" r="${f(0.75 * Math.min(1.4, Math.max(0.8, size)))}"/>`
      : `<path d="${eyePath(expression, x, y, size, side)}"/>`;
    return `<g data-pi-eye="${side === -1 ? 'l' : 'r'}">${glyph}</g>`;
  }).join('');
  const blushes = blush ? face.eyes.map(([x, y], i) => `<ellipse class="pi-blush" cx="${x + (i === 0 ? -0.6 : 0.6)}" cy="${y + 1.9}" rx="1.1" ry="0.6"/>`).join('') : '';
  const mouthEl = mouth ? `<path class="pi-mouth" d="${mouth}"/>` : '';
  const surprisedMouth = expression === 'surprised' && face.mouth ? `<circle class="pi-mouth" cx="${face.mouth[0]}" cy="${f(face.mouth[1] + 0.3)}" r="0.7"/>` : '';
  return `<g class="pi-face" data-expression="${expression}">${eyes}${blushes}${mouthEl}${surprisedMouth}</g>`;
}

/* ── Interaction wiring (port of useInteraction.ts) ── */
const SLOP = 8;
const pointerKind = (t: string): PointerKind => (t === 'touch' ? 'touch' : t === 'pen' ? 'pen' : 'mouse');
const isInside = (r: DOMRect, x: number, y: number) => x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;

function attachInteraction(el: HTMLElement, onEvent: (e: PersonaEvent) => void, config: InteractionConfig): () => void {
  let state = initialInteractionState;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detach: (() => void) | null = null;
  let lastPointer: PointerKind = 'mouse';
  const now = () => performance.now();

  function dispatch(input: InteractionInput) {
    const { state: next, events } = reduceInteraction(state, input, config);
    state = next;
    for (const e of events) onEvent(e);
    if (timer) clearTimeout(timer);
    timer = null;
    const deadline = nextInteractionDeadline(next, config);
    if (deadline !== null) timer = setTimeout(() => dispatch({ type: 'tick', now: now() }), Math.max(0, deadline - now()));
  }

  const onEnter = (e: PointerEvent) => dispatch({ type: 'enter', pointer: pointerKind(e.pointerType), now: now() });
  const onLeave = (e: PointerEvent) => dispatch({ type: 'leave', pointer: pointerKind(e.pointerType), now: now() });
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const kind = pointerKind(e.pointerType);
    const id = e.pointerId;
    lastPointer = kind;
    try { el.setPointerCapture(id); } catch { /* the window listeners below still see the release */ }
    if (state.pressed) dispatch({ type: 'cancel', now: now() });
    dispatch({ type: 'down', now: now() });
    detach?.();
    const cleanup = () => {
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      detach = null;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      cleanup();
      const inside = isInside(el.getBoundingClientRect(), ev.clientX, ev.clientY);
      dispatch({ type: 'up', now: now(), inside });
      if (!inside || kind === 'touch') dispatch({ type: 'leave', pointer: kind, now: now() });
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      cleanup();
      dispatch({ type: 'cancel', now: now() });
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    detach = cleanup;
  };
  const onKeyDown = (e: KeyboardEvent) => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) dispatch({ type: 'down', now: now() }); };
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') dispatch({ type: 'up', now: now(), inside: true }); };
  const onBlur = () => dispatch({ type: 'cancel', now: now() });
  const onContext = (e: Event) => { if (lastPointer === 'touch') e.preventDefault(); };

  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('keyup', onKeyUp);
  el.addEventListener('blur', onBlur);
  el.addEventListener('contextmenu', onContext);
  return () => {
    if (timer) clearTimeout(timer);
    detach?.();
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('keyup', onKeyUp);
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('contextmenu', onContext);
  };
}

/* ── The component ── */
export interface PersonaOptions {
  icon: string;
  personality?: PersonalityName | Personality;
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** 'auto' animates native faces (ghost, cat, bot); true also draws faces on face-friendly icons. */
  face?: 'auto' | boolean;
  /** A toy: reacts to the pointer, but is hidden from assistive tech and out of the tab order. */
  toy?: boolean;
  /** Never reacts to input; only idles and looks. */
  decorative?: boolean;
  interaction?: Partial<InteractionConfig>;
  onPersonaEvent?: (e: PersonaEvent) => void;
}

export interface PersonaHandle { root: HTMLElement; signal(): void; destroy(): void }

export function mountPersona(host: Element, o: PersonaOptions): PersonaHandle | null {
  const nodes = iconNodes[o.icon];
  if (!nodes) { console.warn(`[persona-icons] Unknown icon "${o.icon}"`); return null; }
  const size = o.size ?? 24;
  const base = typeof o.personality === 'string' ? personalities[o.personality] : (o.personality ?? personalities.playful);
  const rig = resolveRig(o.icon);
  const config: InteractionConfig = { ...defaultInteractionConfig, ...o.interaction };
  const interactive = !o.decorative;

  let faceUnavailable = false;
  const faceWanted = () => !faceUnavailable && (o.face === false ? false : o.face === true ? !!rig.face : !!rig.face?.nativeEyes);
  let reduced = prefersReducedMotion();
  let expression: Expression = base.idle.expression ?? 'neutral';
  let asleep = false;

  // DOM: the four animation layers, each with one owner (see controller.ts).
  const root = document.createElement(interactive ? 'button' : 'span');
  root.className = 'pi';
  root.setAttribute('data-personality', base.name);
  root.style.setProperty('--pi-size', `${size}px`);
  root.style.setProperty('--pi-pivot', rig.pivot ?? '50% 50%');
  if (interactive) {
    (root as HTMLButtonElement).type = 'button';
    if (o.toy) { root.setAttribute('aria-hidden', 'true'); root.tabIndex = -1; }
    else root.setAttribute('aria-label', o.label ?? o.icon);
  } else {
    root.setAttribute('data-interactive', 'false');
    if (o.label) { root.setAttribute('role', 'img'); root.setAttribute('aria-label', o.label); } else root.setAttribute('aria-hidden', 'true');
  }
  const layer = (cls: string) => { const s = document.createElement('span'); s.className = `pi-layer ${cls}`; return s; };
  const idle = layer('pi-idle'), pose = layer('pi-pose'), drive = layer('pi-drive'), react = layer('pi-react');
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ xmlns: SVG, width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': String(o.strokeWidth ?? 2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `lucide lucide-${o.icon}` })) svg.setAttribute(k, v);
  for (const [tag, attrs] of nodes) { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.appendChild(el); }
  react.appendChild(svg); drive.appendChild(react); pose.appendChild(drive); idle.appendChild(pose); root.appendChild(idle);
  host.appendChild(root);

  let controller: PersonaController | null = null;
  function renderFace() {
    svg.querySelector('.pi-face')?.remove();
    if (!faceWanted() || !rig.face) return;
    const markup = faceMarkup(rig.face, expression, !rig.face.nativeEyes);
    if (!markup) return;
    const g = document.createElementNS(SVG, 'g');
    g.innerHTML = markup;
    const face = g.firstElementChild;
    if (face) svg.appendChild(face);
  }
  function renderZzz() {
    svg.querySelector('.pi-zzz')?.remove();
    if (!asleep) return;
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('class', 'pi-zzz'); p.setAttribute('d', 'M19.5 -2h3l-3 3h3');
    svg.appendChild(p);
  }
  function start() {
    controller?.destroy();
    root.toggleAttribute('data-reduced', reduced);
    const c = new PersonaController({ root, idle, pose, drive, react, svg }, {
      getPersonality: () => base, rig, size, reducedMotion: reduced, interaction: config, faceActive: faceWanted(),
      onExpression: (e) => { expression = e; renderFace(); if (faceWanted()) c.syncNativeEyes(e); },
      onAsleep: (a) => { asleep = a; if (a) root.setAttribute('data-asleep', 'true'); else root.removeAttribute('data-asleep'); renderZzz(); },
      onFaceUnavailable: () => { faceUnavailable = true; renderFace(); start(); },
    });
    controller = c;
    renderFace();
    c.start();
  }
  start();

  let releasedFromHold = false, cancelledPress = false;
  const onEvent = (e: PersonaEvent) => {
    if (e.type === 'press') releasedFromHold = cancelledPress = false;
    if (e.type === 'release') releasedFromHold = true;
    if (e.type === 'cancel') cancelledPress = true;
    controller?.handle(e);
    o.onPersonaEvent?.(e);
  };
  const detach = interactive ? attachInteraction(root, onEvent, config) : () => {};

  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMq = () => { const next = mq!.matches; if (next !== reduced) { reduced = next; start(); } };
  mq?.addEventListener('change', onMq);

  return {
    root,
    signal: () => controller?.signal(),
    destroy: () => { detach(); mq?.removeEventListener('change', onMq); controller?.destroy(); controller = null; root.remove(); },
  };
}

/** Mounts every <… data-persona="ghost" data-personality="shy" data-size="140" …> placeholder. */
export function mountPersonas(scope: ParentNode = document): PersonaHandle[] {
  const out: PersonaHandle[] = [];
  scope.querySelectorAll<HTMLElement>('[data-persona]').forEach((host) => {
    if (host.dataset.personaMounted) return;
    host.dataset.personaMounted = 'true';
    const h = mountPersona(host, {
      icon: host.dataset.persona!,
      personality: (host.dataset.personality as PersonalityName) || 'playful',
      size: host.dataset.size ? +host.dataset.size : 24,
      strokeWidth: host.dataset.stroke ? +host.dataset.stroke : 2,
      label: host.dataset.label,
      face: host.dataset.face === 'true' ? true : host.dataset.face === 'false' ? false : 'auto',
      toy: host.dataset.toy !== undefined,
      decorative: host.dataset.decorative !== undefined,
    });
    if (h) out.push(h);
  });
  return out;
}

export { personalities };
