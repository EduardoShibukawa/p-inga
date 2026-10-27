// Registro de clientes SSE. Fechar é idempotente e silencioso: um cliente que
// já desconectou (controller fechado/cancelado) só sai do conjunto, uma vez.
type Ctrl = ReadableStreamDefaultController;

const sseClients = new Set<Ctrl>();
const encoder = new TextEncoder();

export function addSseClient(ctrl: Ctrl): void {
  sseClients.add(ctrl);
}

export function removeSseClient(ctrl: Ctrl): boolean {
  return sseClients.delete(ctrl);
}

export function sseClientCount(): number {
  return sseClients.size;
}

/** Remove e fecha o cliente. Retorna true só se estava inscrito e fechou agora. */
export function closeSseClient(ctrl: Ctrl): boolean {
  if (!sseClients.delete(ctrl)) return false;
  try {
    ctrl.close();
    return true;
  } catch {
    return false; // já fechado pelo outro lado: nada a fazer
  }
}

export function closeAllSseClients(): void {
  for (const ctrl of [...sseClients]) closeSseClient(ctrl);
}

export function notifySse(event: string, data: unknown): void {
  const bytes = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const ctrl of [...sseClients]) {
    try {
      ctrl.enqueue(bytes);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}
