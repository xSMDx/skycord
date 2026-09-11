/**
 * Whether a keydown is navigation: the keys that bring focus rings back after
 * a pointer interaction hid them. See the listener in main.ts.
 *
 * `key` is optional because in practice it is. Chrome's autofill dispatches a
 * keydown with no `key`, and reading `.startsWith` off that threw from a
 * capture-phase listener on window.
 */
export const isNavigationKey = (key: string | undefined): boolean =>
  key === 'Tab' || !!key?.startsWith('Arrow')
