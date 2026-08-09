// crypto.randomUUID() only exists in "secure contexts" (HTTPS, or
// localhost) — it's undefined when a phone hits the dev server over the LAN
// by IP address over plain HTTP. These ids only need to be unique per-device,
// not cryptographically random, so Math.random() is fine as a fallback.
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
