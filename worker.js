// Cloudflare Worker: Cara HQ snapshot API
// - POST /live  (requires X-API-Key)
// - GET  /live  (public, CORS)
// KV binding: CARA_HQ
// Env var: API_KEY

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname !== '/live') {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    if (request.method === 'GET') {
      const body = await env.CARA_HQ.get('live_json');
      if (!body) return new Response(JSON.stringify({ ok: false, error: 'no data' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(body, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (request.method === 'POST') {
      const key = request.headers.get('X-API-Key') || '';
      if (!env.API_KEY || key !== env.API_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const text = await request.text();
      // basic validation: must be JSON
      try { JSON.parse(text); } catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await env.CARA_HQ.put('live_json', text);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
};
