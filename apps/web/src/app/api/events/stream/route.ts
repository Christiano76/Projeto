import type { LiveUpdate } from '@agency/core';
import { requireViewer } from '@/server/auth';
import { handleRouteError } from '@/server/http';
import { getRepository } from '@/server/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events com as atualizações da empresa — usado no MODO LOCAL.
 * Com Supabase configurado, o cliente usa Supabase Realtime diretamente.
 */
export async function GET(req: Request) {
  try {
    const viewer = await requireViewer();
    const repo = getRepository();
    if (!repo.subscribe) {
      return new Response('use Supabase Realtime', { status: 404 });
    }
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };
        send(`retry: 3000\n\n`);
        const unsubscribe = repo.subscribe!(viewer.companyId!, (u: LiveUpdate) => send(`data: ${JSON.stringify(u)}\n\n`));
        const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };
        req.signal.addEventListener('abort', () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* já fechado */
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
