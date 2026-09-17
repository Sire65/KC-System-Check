const TRACEPARENT_RE = /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i;

export function validTraceparent(value: string | null | undefined) {
  if (!value || !TRACEPARENT_RE.test(value)) return false;
  const [, traceId, parentId] = value.split("-");
  return !/^0{32}$/i.test(traceId) && !/^0{16}$/i.test(parentId);
}

export function incomingTraceHeaders(req: Request): Record<string, string> {
  const traceparent = req.headers.get("traceparent") || "";
  if (!validTraceparent(traceparent)) return {};
  const out: Record<string, string> = { traceparent };
  const tracestate = req.headers.get("tracestate") || "";
  const baggage = req.headers.get("baggage") || "";
  if (tracestate.length <= 512 && !/[\r\n]/.test(tracestate) && tracestate) out.tracestate = tracestate;
  if (baggage.length <= 1024 && !/[\r\n]/.test(baggage) && baggage) out.baggage = baggage;
  return out;
}

export function withTraceHeaders(init: RequestInit = {}, trace: Record<string, string> = {}): RequestInit {
  if (!trace.traceparent) return init;
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(trace)) headers.set(key, value);
  return { ...init, headers };
}
