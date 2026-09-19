/**
 * The offline banner's text, for a member and — with the extra sentence — for
 * the developer at this desk. A member on someone else's instance has no way
 * to run a script and should never be told to; the host-facing hint is
 * appended only in a developer build, where `import.meta.env.DEV` is true.
 * It is false in every production image, so a member can never see it.
 *
 * A pure function (rather than a module-level constant) so a caller decides
 * the environment explicitly — Vitest runs with DEV true, so reading
 * `import.meta.env` from inside this module would never exercise the
 * production string.
 */
export const offlineMessage = (isDev: boolean): string => {
  const member = "Can't reach the server. Retrying automatically…"
  return isDev ? `${member} Is the API running? (start-dev.cmd)` : member
}
