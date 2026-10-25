// Which modifier key the player's keyboard uses for undo and redo (the shortcut handler accepts both).

interface NavigatorUAData {
  platform?: string
}

/** True on Macs, iPads and iPhones, where undo is Cmd+Z rather than Ctrl+Z. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** "Cmd" on Apple platforms, "Ctrl" elsewhere. */
export const modKey = (): string => (isApplePlatform() ? 'Cmd' : 'Ctrl')
