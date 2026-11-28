const history = [];
export function diagnostic(area, event, details = {}) {
  const entry = { time: new Date().toISOString(), area, event, ...details };
  history.push(entry);
  if (history.length > 60) history.shift();
  console.info(`[Worth a Stop][${area}] ${event}`, details);
}
export function readDiagnostics() { return structuredClone(history); }
