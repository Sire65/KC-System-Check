// KC System Check – optional W3C Trace Context helper.
// Rein additiv: Fehlt/versagt Trace Context, bleibt der bestehende Datenpfad unverändert.

const TRACEPARENT_RE = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;

export function validTraceparent(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!TRACEPARENT_RE.test(v)) return false;
  const [, traceId, parentId] = v.split('-');
  return traceId !== '00000000000000000000000000000000' &&
    parentId !== '0000000000000000';
}

export function traceHeaders(source = {}) {
  const out = {};
  const traceparent = typeof source.traceparent === 'string' ? source.traceparent.trim() : '';
  if (validTraceparent(traceparent)) out.traceparent = traceparent;

  // tracestate/baggage sind optional. Harte Groessenbegrenzung verhindert,
  // dass der Diagnosepfad fuer grosse oder offensichtlich ungeeignete Werte missbraucht wird.
  const tracestate = typeof source.tracestate === 'string' ? source.tracestate.trim() : '';
  if (out.traceparent && tracestate && tracestate.length <= 512 && !/[\r\n]/.test(tracestate)) {
    out.tracestate = tracestate;
  }
  const baggage = typeof source.baggage === 'string' ? source.baggage.trim() : '';
  if (out.traceparent && baggage && baggage.length <= 1024 && !/[\r\n]/.test(baggage)) {
    out.baggage = baggage;
  }
  return out;
}

export function withTraceHeaders(existingHeaders = {}, source = {}) {
  const trace = traceHeaders(source);
  if (!Object.keys(trace).length) return existingHeaders;
  return { ...existingHeaders, ...trace };
}
