var DISCORD_INVITE = "https://discord.gg/stwdgFEWHR";
var EVENTS_HOSTED = 0; // Set this by hand; the bot doesn't track events.

// No made-up numbers: members, online and staff only show what the server reports.
var STATS = { members: null, online: null, staff: null, events: EVENTS_HOSTED };

document.querySelectorAll("[data-discord]").forEach(function(a){ a.href = DISCORD_INVITE; if (DISCORD_INVITE !== "#") { a.target = "_blank"; a.rel = "noopener"; } });

var menu = document.getElementById("menu"), links = document.getElementById("links");
menu.addEventListener("click", function(){ var o = links.classList.toggle("open"); menu.setAttribute("aria-expanded", o); });
links.addEventListener("click", function(e){ if (e.target.tagName === "A") { links.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); } });

var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function run(el){
  var end = STATS[el.dataset.key];
  if (typeof end !== "number") { el.textContent = "—"; return; }
  if (reduce || !end) { el.textContent = end.toLocaleString("en-AU"); return; }
  var t0 = null;
  function step(t){ if (!t0) t0 = t; var p = Math.min((t - t0) / 1400, 1); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString("en-AU"); if (p < 1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}
function start(){
  var els = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }); }, { threshold: .6 });
    els.forEach(function(el){ io.observe(el); });
  } else { els.forEach(run); }
}

fetch("/api/stats", { cache: "no-store" })
  .then(function(r){ return r.ok ? r.json() : {}; })
  .then(function(d){
    ["members", "online", "staff"].forEach(function(k){
      if (typeof d[k] === "number") STATS[k] = d[k]; // accepts 0 too
    });
  })
  .catch(function(){})
  .then(start);