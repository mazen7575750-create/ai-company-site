/* ============================================================================
   الشركة — سكربت المزامنة
   يوضع هذا الملف في الريبو جانب index.html على فرع gh-pages.
   بيقرأ الحالة من GitHub كل دقيقة، ويرسمها على الخريطة 3D.
   ========================================================================== */
const RAW = "https://raw.githubusercontent.com/mazen7575750-create/ai-company-site/main/company.json";

/* ---------- شريط الحالة ---------- */
function bar() {
  if (document.getElementById("sync-bar")) return document.getElementById("sync-bar");
  const d = document.createElement("div");
  d.id = "sync-bar";
  d.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;background:#0d1726ee;" +
    "color:#dfe8f5;font:13px/1.7 system-ui;padding:7px 14px;display:flex;" +
    "gap:14px;align-items:center;justify-content:center;backdrop-filter:blur(6px);" +
    "border-bottom:1px solid #1e2c42;flex-wrap:wrap;direction:rtl";
  d.innerHTML =
    '<span id="sync-dot" style="width:9px;height:9px;border-radius:50%;background:#48c78e;' +
    'display:inline-block"></span>' +
    '<span id="sync-txt">…</span>';
  document.body.appendChild(d);
  document.body.style.paddingTop = "40px";
  return d;
}
function setBar(txt, ok = true) {
  bar();
  document.getElementById("sync-txt").textContent = txt;
  document.getElementById("sync-dot").style.background = ok ? "#48c78e" : "#e05c5c";
}

/* ---------- لوحة الحالة الجانبية ---------- */
function panel() {
  let p = document.getElementById("live-panel");
  if (p) return p;
  p = document.createElement("div");
  p.id = "live-panel";
  p.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:99998;width:270px;max-height:56vh;" +
    "overflow:auto;background:#0d1726f2;color:#dfe8f5;font:12px/1.8 system-ui;" +
    "border:1px solid #1e2c42;border-radius:12px;padding:12px;direction:rtl;" +
    "backdrop-filter:blur(8px);box-shadow:0 8px 28px #0008";
  document.body.appendChild(p);
  return p;
}
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render(d) {
  const tasks = d.tasks || [];
  const done = tasks.filter((t) => t.status === "approved").length;
  const live = tasks.filter((t) =>
    ["queued", "running", "under_review"].includes(t.status)
  );
  const arts = d.artifacts || [];
  const act = (d.activity || []).slice(-6).reverse();

  const p = panel();
  p.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">🏢 دفتر الشركة</div>
    <div style="color:#8fa7c4">
      👥 ${(d.agents || []).length} موظف &nbsp;•&nbsp; 📁 ${(d.projects || []).length} مشروع<br>
      ✅ ${done}/${tasks.length} مهمة &nbsp;•&nbsp; 📄 ${arts.length} ملف
    </div>
    <div style="margin:10px 0 6px;border-top:1px solid #1e2c42"></div>
    <div style="font-weight:600;margin-bottom:4px">${
      live.length ? `⏳ شغّالين دلوقتي (${live.length})` : "😴 مفيش شغل جاري"
    }</div>
    ${live
      .slice(0, 5)
      .map(
        (t) =>
          `<div style="color:#9fd4ff;margin-bottom:3px">• ${esc(
            (t.title || "").slice(0, 46)
          )} <span style="color:#66788f">— ${
            { queued: "في الطابور", running: "بينفّذ", under_review: "تحت المراجعة" }[
              t.status
            ] || t.status
          }</span></div>`
      )
      .join("")}
    <div style="margin:10px 0 6px;border-top:1px solid #1e2c42"></div>
    <div style="font-weight:600;margin-bottom:4px">📄 آخر الملفات</div>
    ${arts
      .slice(-4)
      .reverse()
      .map((a) => `<div style="color:#c8b6ff">• ${esc((a.title || a.id || "").slice(0, 44))}</div>`)
      .join("") || '<div style="color:#66788f">لسه مفيش</div>'}
    <div style="margin:10px 0 6px;border-top:1px solid #1e2c42"></div>
    <div style="font-weight:600;margin-bottom:4px">📢 آخر الأخبار</div>
    ${act
      .map((a) => `<div style="color:#9bb0c9;margin-bottom:3px">• ${esc((a.text || "").slice(0, 70))}</div>`)
      .join("") || '<div style="color:#66788f">—</div>'}
  `;
}

/* ---------- تحديث دوري ---------- */
let last = 0;
async function pull() {
  try {
    const r = await fetch(RAW + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    last = Date.now();
    const tasks = d.tasks || [];
    const live = tasks.filter((t) => ["queued", "running", "under_review"].includes(t.status)).length;
    const who = d.loop && d.loop.lastOperation ? d.loop.lastOperation : "—";
    setBar(
      live
        ? `⚙️ الشركة شغالة — ${live} مهمة جارية • آخر عملية: ${who}`
        : `😴 الشركة نايمة — مفيش شغل معلّق • آخر تحديث ${new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}`,
      true
    );
    render(d);
    window.__companyState = d;
  } catch (e) {
    setBar(`⚠️ تعذر قراءة حالة الشركة (${e.message}) — هحاول تاني`, false);
  }
}

addEventListener("DOMContentLoaded", () => {
  bar();
  panel();
  pull();
  setInterval(pull, 60_000);
});
if (document.readyState !== "loading") {
  bar();
  panel();
  pull();
  setInterval(pull, 60_000);
}
