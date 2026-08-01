let idSeq = 0;

export function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}-${Date.now().toString(36)}`;
}
