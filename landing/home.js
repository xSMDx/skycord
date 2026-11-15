import { mountPersonas } from './vendor/persona-icons-0.1.js';

// The characters in the hero and the ending: Lucide line art that idles, blinks,
// looks at the pointer and reacts to it. They handle reduced motion themselves,
// so this loads either way.
window.__personas = mountPersonas();
window.__personaReady = true;
