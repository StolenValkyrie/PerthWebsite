// Fallback numbers; members and online are replaced by live data from /api/stats.
var DISCORD_INVITE = "https://discord.gg/stwdgFEWHR";
var STATS = { members: 14, online: 7, staff: 4, events: 0 };

document.querySelectorAll("[data-discord]").forEach(function(a){ a.href = DISCORD_INVITE; if (DISCORD_INVITE !== "#") { a.target = "_blank"; a.rel = "noopener"; } });

var menu = document.getElementById("menu"), links = document.getElementById("links");
menu.addEventListener("click", function(){ var o = links.classList.toggle("open"); menu.setAttribute("aria-expanded", o); });
links.addEventListener("click", function(e){ if (e.target.tagName === "A") { links.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); } });

var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function run(el){
  var end = STATS[el.dataset.key] || 0;
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
fetch("/api/stats").then(function(r){ return r.json(); }).then(function(d){
  if (d.members) STATS.members = d.members;
  if (d.online) STATS.online = d.online;
}).catch(function(){}).then(start);