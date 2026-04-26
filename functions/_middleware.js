// functions/_middleware.js
// ══════════════════════════════════════════════════════════════
// EuAqui — Cloudflare Pages Middleware
// Injeta Open Graph tags para bots (WhatsApp, Facebook, etc.)
//
// INSTALAÇÃO:
//   1. Cria a pasta "functions" na raiz do teu repositório
//   2. Coloca este ficheiro em: functions/_middleware.js
//   3. Faz commit e push — o Cloudflare Pages detecta automaticamente
//
// Variáveis de ambiente (Cloudflare Pages → Settings → Environment Variables):
//   SUPABASE_URL   = https://gpustnmwxlolgyevjjtf.supabase.co
//   SUPABASE_ANON  = eyJhbGci...
//   R2_PUBLIC_BASE = https://media.euaqui.store
// ══════════════════════════════════════════════════════════════

async function sbFetch(env, table, id, columns) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(columns)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey':        env.SUPABASE_ANON,
      'Authorization': `Bearer ${env.SUPABASE_ANON}`,
      'Accept':        'application/json',
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function toWorkerUrl(url, r2Base) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('media.euaqui.store') || url.includes('midia.euaqui.store')) return url;
  if (url.includes('supabase.co')) {
    try {
      const u = new URL(url);
      if (!u.pathname.includes('/storage/v1/object/public/')) return url;
      const path = u.pathname.replace(/^\/storage\/v1\/object\/public\//, '');
      return r2Base + '/media/' + encodeURIComponent(path);
    } catch(e) { return url; }
  }
  return url;
}

async function resolveOG(reqUrl, env) {
  const R2_BASE = (env.R2_PUBLIC_BASE || 'https://media.euaqui.store').replace(/\/$/, '');
  const DEFAULT = `${R2_BASE}/media/og-default.png`;
  const base    = 'https://euaqui.store';

  const defaults = {
    title:       'EuAqui — Sua rede, seu mundo',
    description: 'Descubra lojas, produtos e pessoas perto de você no EuAqui.',
    image:       DEFAULT,
    url:         base,
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON) return defaults;

  const postId = reqUrl.searchParams.get('post');
  const bizId  = reqUrl.searchParams.get('biz');
  const commId = reqUrl.searchParams.get('comm');

  if (postId) {
    try {
      const post = await sbFetch(env, 'posts', postId, 'id,content,media_urls,user_id');
      if (!post) return defaults;
      let author = 'Alguém';
      if (post.user_id) {
        const p = await sbFetch(env, 'profiles', post.user_id, 'full_name,username');
        if (p) author = p.full_name || ('@' + p.username) || author;
      }
      const raw = Array.isArray(post.media_urls) ? post.media_urls[0]
                : (typeof post.media_urls === 'string' ? JSON.parse(post.media_urls || '[]')[0] : null);
      return {
        title:       `${author} no EuAqui`,
        description: (post.content || '').slice(0, 160).replace(/\n/g, ' ') || 'Veja este post no EuAqui!',
        image:       toWorkerUrl(raw, R2_BASE) || DEFAULT,
        url:         `${base}/?post=${postId}`,
      };
    } catch(e) { return defaults; }
  }

  if (bizId) {
    try {
      const biz = await sbFetch(env, 'businesses', bizId, 'name,description,logo_url,banner_url,category');
      if (!biz) return defaults;
      return {
        title:       `${biz.name} — EuAqui`,
        description: biz.description || `Conheça ${biz.name} no EuAqui!`,
        image:       toWorkerUrl(biz.logo_url, R2_BASE) || toWorkerUrl(biz.banner_url, R2_BASE) || DEFAULT,
        url:         `${base}/?biz=${bizId}`,
      };
    } catch(e) { return defaults; }
  }

  if (commId) {
    try {
      const comm = await sbFetch(env, 'communities', commId, 'name,description,avatar_url,banner_url');
      if (!comm) return defaults;
      return {
        title:       `${comm.name} — Comunidade no EuAqui`,
        description: comm.description || `Junte-se à comunidade ${comm.name} no EuAqui!`,
        image:       toWorkerUrl(comm.avatar_url, R2_BASE) || toWorkerUrl(comm.banner_url, R2_BASE) || DEFAULT,
        url:         `${base}/?comm=${commId}`,
      };
    } catch(e) { return defaults; }
  }

  return defaults;
}

function buildOG({ title, description, image, url }) {
  const e = s => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
  <meta property="og:title"       content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:image"       content="${e(image)}">
  <meta property="og:url"         content="${e(url)}">
  <meta property="og:type"        content="website">
  <meta property="og:site_name"   content="EuAqui">
  <meta name="description"        content="${e(description)}">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${e(title)}">
  <meta name="twitter:description" content="${e(description)}">
  <meta name="twitter:image"       content="${e(image)}">`;
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Só actua em pedidos com parâmetros OG — passa tudo o resto directamente
  const hasOG = url.searchParams.has('post')
             || url.searchParams.has('biz')
             || url.searchParams.has('comm');

  if (!hasOG) return next();

  // Resolve os dados OG do Supabase
  const meta = await resolveOG(url, env);

  // Busca o HTML do Pages
  const res = await next();
  const ct  = res.headers.get('Content-Type') || '';
  if (!ct.includes('text/html')) return res;

  let html = await res.text();

  // Remove OG tags genéricas existentes (evita duplicados)
  html = html.replace(/<meta\s[^>]*(property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>/gi, '');

  // Injeta as tags correctas logo após <head>
  html = html.replace(/(<head[^>]*>)/i, `$1\n${buildOG(meta)}`);

  // Actualiza o <title>
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${meta.title.replace(/</g, '&lt;')}</title>`);

  return new Response(html, {
    status:  res.status,
    headers: {
      'Content-Type':  'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-OG-Injected': 'true',
    },
  });
}
