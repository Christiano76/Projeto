import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renova a sessão do Supabase e protege as páginas. No modo local (sem
 * Supabase) não há autenticação e o middleware não faz nada.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured =
    !!url && !!anon && !!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.AGENCY_FORCE_MEMORY_MODE !== 'true';
  if (!configured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith('/login') || path.startsWith('/api/') || path.startsWith('/auth/');
  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf)$).*)'],
};
