/**
 * Minimal text/event-stream parser over a fetch body. Buffers across chunk
 * boundaries, joins multi-line `data:` fields, and dispatches one callback per
 * event. Used for both the agent reply stream and /api/events.
 */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string, event: string | undefined) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder();
  let buf = '';
  let dataLines: string[] = [];
  let eventName: string | undefined;

  const flush = () => {
    if (dataLines.length) onEvent(dataLines.join('\n'), eventName);
    dataLines = [];
    eventName = undefined;
  };

  const handleLine = (line: string) => {
    if (line === '') return flush();
    if (line.startsWith(':')) return; // comment / keep-alive
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
  };

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) !== -1) {
        const line = buf.slice(0, nl);
        const sep = buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1;
        buf = buf.slice(nl + sep);
        handleLine(line);
      }
    }
    buf += decoder.decode();
    if (buf) handleLine(buf);
    flush();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
