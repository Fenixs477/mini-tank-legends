// Embedded nature OBJ data (base64)
declare global {
  interface Window { __OBJ_DATA__: Record<string, string>; }
}
(window as typeof window & { __OBJ_DATA__: Record<string, string> }).__OBJ_DATA__ =
  (window as any).__OBJ_DATA__ || {};
