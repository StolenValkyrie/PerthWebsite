// Perth Roleplay: staff login, live stats and moderation API (Cloudflare Worker)
const API = "https://discord.com/api/v10";
const ROLE_LEVELS = [
  ["1566066035189354590", 1], // General
  ["1566066035189354589", 2], // Supervisory
  ["1566066035189354588", 3], // Management
  ["1566066035189354591", 4], // Directive
];
const NEEDS = { warn: 1, timeout: 1, kick: 2, ban: 3 }; // minimum staff level per action
const SESSION_DAYS = 7;
const enc = new TextEncoder();

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function makeToken(env, obj) {
  const p = b64(enc.encode(JSON.stringify(obj)));
  return p + "." + (await hmac(env.SESSION_SECRET, p));
}
async function readToken(env, token) {
  if (!token) return null;
  const [p, s] = token.split(".");
  if (!p || !s || !safeEq(await hmac(env.SESSION_SECRET, p), s)) return null;
  try { const o = JSON.parse(unb64(p)); return o.exp > Date.now() / 1000 ? o : null; } catch { return null; }
}
const getCookie = (req, name) => ((req.headers.get("Cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)")) || [])[1] || null;
const setCookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

const dc = (env, path, opts = {}) =>
  fetch(API + path, { ...opts, headers: { Authorization: "Bot " + env.DISCORD_BOT_TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) } });

const levelOf = (roles) => ROLE_LEVELS.reduce((m, [id, l]) => (roles.includes(id) ? Math.max(m, l) : m), 0);
async function getMember(env, id) {
  const r = await dc(env, `/guilds/${env.GUILD_ID}/members/${id}`);
  return r.ok ? r.json() : null;
}
async function requireStaff(env, req) {
  const session = await readToken(env, getCookie(req, "pr_session"));
  if (!session) return null;
  const m = await getMember(env, session.id); // checked live, so removed staff lose access immediately
  const level = m ? levelOf(m.roles) : 0;
  return level > 0 ? { session, level } : null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/auth/login") {
      const state = crypto.randomUUID();
      const to = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&response_type=code&scope=identify&state=${state}&redirect_uri=${encodeURIComponent(url.origin + "/auth/callback")}`;
      return new Response(null, { status: 302, headers: { Location: to, "Set-Cookie": setCookie("pr_state", state, 600) } });
    }

    if (path === "/auth/callback") {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code || !state || state !== getCookie(req, "pr_state")) return new Response("Login expired. Go back and try again.", { status: 400 });
      const tok = await fetch(API + "/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: url.origin + "/auth/callback" }),
      });
      if (!tok.ok) return new Response("Discord login failed.", { status: 400 });
      const { access_token } = await tok.json();
      const me = await (await fetch(API + "/users/@me", { headers: { Authorization: "Bearer " + access_token } })).json();
      const token = await makeToken(env, { id: me.id, name: me.global_name || me.username, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 });
      const h = new Headers({ Location: "/dashboard" });
      h.append("Set-Cookie", setCookie("pr_session", token, SESSION_DAYS * 86400));
      h.append("Set-Cookie", setCookie("pr_state", "", 0));
      return new Response(null, { status: 302, headers: h });
    }

    if (path === "/auth/logout") {
      return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": setCookie("pr_session", "", 0) } });
    }

    if (path === "/api/bot/stats" && req.method === "POST") {
      const auth = req.headers.get("Authorization") || "";
      if (!env.BOT_PUSH_SECRET || !safeEq(auth, "Bearer " + env.BOT_PUSH_SECRET)) return json({ error: "Unauthorized" }, 401);
      let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
      const n = (v) => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);
      await env.DB.prepare("INSERT INTO stats (id, members, online, staff, updated) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET members=excluded.members, online=excluded.online, staff=excluded.staff, updated=excluded.updated")
        .bind(n(b.members), n(b.online), n(b.staff), Math.floor(Date.now() / 1000)).run();
      return json({ ok: true });
    }

    if (path === "/api/stats") {
      // Prefer numbers pushed by the bot (accurate); fall back to Discord's approximate counts if they're missing or stale.
      const row = await env.DB.prepare("SELECT members, online, staff, updated FROM stats WHERE id = 1").first();
      const fresh = row && Date.now() / 1000 - row.updated < 900;
      const out = fresh ? { members: row.members, online: row.online, staff: row.staff } : {};
      if (out.members == null || out.online == null) {
        const r = await dc(env, `/guilds/${env.GUILD_ID}?with_counts=true`);
        if (r.ok) {
          const g = await r.json();
          if (out.members == null) out.members = g.approximate_member_count;
          if (out.online == null) out.online = g.approximate_presence_count;
        }
      }
      return json(out, 200, { "Cache-Control": "public, max-age=60" });
    }

    if (path === "/dashboard") {
      const session = await readToken(env, getCookie(req, "pr_session"));
      if (!session) return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
      if (!(await requireStaff(env, req))) return new Response("You need a staff role to use the dashboard.", { status: 403 });
      return env.ASSETS.fetch(new Request(url.origin + "/dashboard", req));
    }

    if (path === "/api/me") {
      const s = await requireStaff(env, req);
      return s ? json({ name: s.session.name, level: s.level }) : json({ error: "Not signed in as staff" }, 401);
    }

    if (path === "/api/log") {
      if (!(await requireStaff(env, req))) return json({ error: "Staff only" }, 403);
      const user = url.searchParams.get("user");
      const q = user && /^\d{17,20}$/.test(user)
        ? env.DB.prepare("SELECT * FROM actions WHERE target_id = ? ORDER BY id DESC LIMIT 50").bind(user)
        : env.DB.prepare("SELECT * FROM actions ORDER BY id DESC LIMIT 50");
      return json({ rows: (await q.all()).results });
    }

    if (path === "/api/mod" && req.method === "POST") {
      if (req.headers.get("Origin") !== url.origin) return json({ error: "Bad origin" }, 403);
      const s = await requireStaff(env, req);
      if (!s) return json({ error: "Staff only" }, 403);
      let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
      const action = String(b.action || ""), target = String(b.userId || ""), reason = String(b.reason || "").trim().slice(0, 400);
      const minutes = Math.min(Math.max(parseInt(b.minutes, 10) || 0, 0), 40320);
      if (!NEEDS[action]) return json({ error: "Unknown action" }, 400);
      if (!/^\d{17,20}$/.test(target)) return json({ error: "Enter a valid Discord user ID" }, 400);
      if (!reason) return json({ error: "A reason is required" }, 400);
      if (action === "timeout" && !minutes) return json({ error: "Enter timeout minutes" }, 400);
      if (s.level < NEEDS[action]) return json({ error: "Your staff rank can't do that action" }, 403);
      if (target === s.session.id) return json({ error: "You can't moderate yourself" }, 400);

      const member = await getMember(env, target);
      if (member && levelOf(member.roles) > 0) return json({ error: "Staff members can't be moderated here" }, 403);
      if (!member && action !== "ban") return json({ error: "That user isn't in the server" }, 404);

      const headers = { "X-Audit-Log-Reason": encodeURIComponent(`${s.session.name}: ${reason}`.slice(0, 400)) };
      let r = { ok: true };
      if (action === "timeout") r = await dc(env, `/guilds/${env.GUILD_ID}/members/${target}`, { method: "PATCH", headers, body: JSON.stringify({ communication_disabled_until: new Date(Date.now() + minutes * 60000).toISOString() }) });
      if (action === "kick") r = await dc(env, `/guilds/${env.GUILD_ID}/members/${target}`, { method: "DELETE", headers });
      if (action === "ban") r = await dc(env, `/guilds/${env.GUILD_ID}/bans/${target}`, { method: "PUT", headers, body: JSON.stringify({ delete_message_seconds: 0 }) });
      if (!r.ok) return json({ error: `Discord refused (${r.status}). Check the bot's permissions and that its role is above the target.` }, 502);

      await env.DB.prepare("INSERT INTO actions (ts, actor_id, actor_name, action, target_id, reason, minutes) VALUES (?,?,?,?,?,?,?)")
        .bind(Math.floor(Date.now() / 1000), s.session.id, s.session.name, action, target, reason, action === "timeout" ? minutes : null).run();
      return json({ ok: true });
    }

    return env.ASSETS.fetch(req);
  },
};