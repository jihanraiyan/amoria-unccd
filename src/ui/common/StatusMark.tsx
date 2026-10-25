// Visible status cue so warn and bad values never rely on color alone.

/** "!" for under strain, "!!" for critical; nothing when healthy. `word` is read by screen readers. */
export function StatusMark({ tone, word }: { tone: 'good' | 'warn' | 'bad'; word?: string }) {
  if (tone === 'good') return null
  return (
    <span className={`ml-0.5 font-bold ${tone === 'bad' ? 'text-bad' : 'text-warn'}`} data-testid="status-mark" title={word}>
      <span aria-hidden>{tone === 'bad' ? '!!' : '!'}</span>
      {word && <span className="sr-only"> ({word})</span>}
    </span>
  )
}
