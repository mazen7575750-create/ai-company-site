/* ============================================================================
   لوحة الشركة — إحصائيات حقيقية + طلب جديد من داخل الموقع
   تقرأ company.json من نفس الريبو (بدون أي مفتاح)
   ========================================================================== */
const DATA = "company.json";
const ISSUES = "https://github.com/mazen7575750-create/ai-company-site/issues/new?title=";

const AR_STATUS = {
  queued: "في الطابور",
  running: "بينفّذ",
  under_review: "تحت المراجعة",
  approved: "تم ✅",
  blocked_unconfigured: "متوقف",
  rejected: "مرفوض",
  failed: "فشل",
};
const AR_PROJ = {
  planning: "بيخطّط",
  active: "شغال",
  waiting_ceo_config: "مستني إعداد",
  done: "خلص ✅",
  paused: "موقوف",
};

const n = (x) => Number(x || 0);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const since = (ts) => {
  if (!ts) return "—";
  const m = Math.round((Date.now() - Number(ts)) / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return `قبل ${Math.round(h / 24)} يوم`;
};

/* ---------------------------- الواجهة ---------------------------- */
function style() {
  if (document.getElementById("dash-css")) return;
  const s = document.createElement("style");
  s.id = "dash-css";
  s.textContent = `
  #dash{position:fixed;inset:0;z-index:999999;background:transparent;color:#e6eefb;pointer-events:none;
    font:14px/1.75 system-ui,'Segoe UI',sans-serif;direction:rtl;overflow:auto;
    padding:0 0 40px}
  #dash *{box-sizing:border-box}
  #dash .wrap{max-width:920px;margin:0 auto;padding:0 14px;pointer-events:auto}
  #dash header{position:sticky;top:0;background:#0a1120ee;backdrop-filter:blur(10px);
    border-bottom:1px solid #1b2740;padding:12px 0;margin-bottom:18px;z-index:2;border-radius:0 0 14px 14px}
  #dash h1{margin:0;font-size:17px;font-weight:700;letter-spacing:.2px}
  #dash .sub{color:#7f93ae;font-size:12px;margin-top:2px}
  #dash .row{display:flex;gap:10px;flex-wrap:wrap}
  #dash .card{background:#101a2be6;border:1px solid #1e2c45;border-radius:14px;padding:10px 12px;flex:1;min-width:104px;backdrop-filter:blur(6px)}
  #dash .big{font-size:21px;font-weight:800;line-height:1.2;color:#fff}
  #dash .lbl{color:#8ba0bb;font-size:12px;margin-top:2px}
  #dash .sec{background:#0d1626ee;border:1px solid #1c2940;border-radius:14px;padding:16px;margin:12px 0}
  #dash .sec h2{margin:0 0 12px;font-size:14px;font-weight:700;color:#cfe0f5;
    display:flex;align-items:center;gap:8px}
  #dash .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;
    background:#1a2a44;color:#9dc4f0;margin:2px 2px 2px 0}
  #dash .item{padding:9px 0;border-bottom:1px solid #16223a;font-size:13px}
  #dash .item:last-child{border:0}
  #dash .muted{color:#71839c;font-size:12px}
  #dash .state{display:flex;align-items:center;gap:10px;padding:10px 14px;
    border-radius:12px;background:#0f1c2eee;border:1px solid #1f3049;margin-bottom:16px}
  #dash .dot{width:10px;height:10px;border-radius:50%;flex:none}
  #dash textarea{width:100%;min-height:92px;background:#0a1322;color:#e6eefb;
    border:1px solid #24365a;border-radius:12px;padding:12px;font:14px/1.7 inherit;resize:vertical}
  #dash button{background:#1d6fe8;color:#fff;border:0;border-radius:11px;padding:11px 20px;
    font:600 14px inherit;cursor:pointer;margin-top:10px}
  #dash button:active{transform:scale(.98)}
  #dash .bar{height:7px;background:#16233a;border-radius:99px;overflow:hidden;margin-top:6px}
  #dash .bar > i{display:block;height:100%;background:linear-gradient(90deg,#2f86ff,#5fd0a8)}
  #dash .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  @media(max-width:520px){#dash .grid2{grid-template-columns:1fr}}
  #dash .close{position:absolute;top:12px;left:14px;background:#1a2740;border:1px solid #27395a;color:#cfe0f5;border-radius:10px;padding:6px 12px;font-size:12px;cursor:pointer}
  `;
  document.head.appendChild(s);
}

function overlay() {
  let d = document.getElementById("dash");
  if (d) return d;
  d = document.createElement("div");
  d.id = "dash";
  d.innerHTML = '<div class="wrap"><div id="dash-body"></div></div>';
  document.body.appendChild(d);
  return d;
}

function open() {
  style();
  const d = overlay();
  d.style.display = "block";
  pull();
}
function close() {
  const d = document.getElementById("dash");
  if (d) d.style.display = "none";
}
window.companyDashboard = open;

/* ---------------------------- الرسم ---------------------------- */
function render(s) {
  const agents = s.agents || [];
  const tasks = s.tasks || [];
  const projects = s.projects || [];
  const arts = s.artifacts || [];
  const act = (s.activity || []).slice().reverse();
  const runs = s.runs || [];
  const chat = (s.ceoChat || []).slice().reverse();

  const done = tasks.filter((t) => t.status === "approved").length;
  const live = tasks.filter((t) => ["queued", "running", "under_review"].includes(t.status));
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const awake = live.length > 0 || projects.some((p) => ["planning", "active"].includes(p.status));
  const busy = agents.filter((a) => live.some((t) => t.agentId === a.id));

  const stateHtml = `
  <div class="state" style="border-color:${awake ? "#1f4a3a" : "#2a3350"};background:${awake ? "#0d1f1a" : "#0f1c2e"}">
    <span class="dot" style="background:${awake ? "#3ddc91" : "#66788f"};box-shadow:0 0 12px ${awake ? "#3ddc91" : "transparent"}"></span>
    <div style="flex:1">
      <b>${awake ? "الشركة صاحية وبتشتغل" : "الشركة نايمة"}</b>
      <div class="muted">${
        awake
          ? `${live.length} مهمة جارية • ${busy.length} موظف مشغول`
          : "مفيش شغل معلّق — هتصحى أول ما تضيف طلب"
      }</div>
    </div>
    <div class="muted" style="text-align:left">آخر جولة<br><b style="color:#cfe0f5">${since(
      s.loop && s.loop.lastOperationAt
    )}</b></div>
  </div>`;

  const stats = `
  <div class="row" style="margin-bottom:12px">
    <div class="card"><div class="big">${agents.length}</div><div class="lbl">👥 موظف</div></div>
    <div class="card"><div class="big">${projects.length}</div><div class="lbl">📁 مشروع</div></div>
    <div class="card"><div class="big">${tasks.length}</div><div class="lbl">📋 مهمة</div></div>
    <div class="card"><div class="big" style="color:#3ddc91">${arts.length}</div><div class="lbl">📄 ملف</div></div>
  </div>`;

  const progress = `
  <div class="sec">
    <h2>📊 الإنجاز العام</h2>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#8ba0bb">
      <span>خلص ${done} من ${tasks.length} مهمة</span><span><b style="color:#fff">${pct}%</b></span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div style="margin-top:12px" class="muted">
      ${Object.entries(
        tasks.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {})
      )
        .map(([k, v]) => `<span class="pill">${AR_STATUS[k] || k}: ${v}</span>`)
        .join("") || '<span class="pill">لسه مفيش مهام</span>'}
    </div>
  </div>`;

  const projectsHtml = projects.length
    ? `<div class="sec"><h2>📁 المشاريع</h2>${projects
        .slice(-6)
        .reverse()
        .map(
          (p) => `<div class="item"><b>${esc((p.title || p.goal || "").slice(0, 70))}</b>
          <span class="pill" style="float:left">${AR_PROJ[p.status] || p.status}</span>
          <div class="muted">${since(p.createdAt || p.updatedAt)}</div></div>`
        )
        .join("")}</div>`
    : "";

  const liveHtml = live.length
    ? `<div class="sec"><h2>⏳ شغّالين دلوقتي</h2>${live
        .slice(0, 8)
        .map((t) => {
          const a = agents.find((x) => x.id === t.agentId);
          return `<div class="item"><b>${esc((t.title || "").slice(0, 62))}</b>
          <span class="pill" style="float:left">${AR_STATUS[t.status] || t.status}</span>
          <div class="muted">${a ? esc(a.name + " — " + a.role) : "غير مسند"}</div></div>`;
        })
        .join("")}</div>`
    : "";

  const artHtml = arts.length
    ? `<div class="sec"><h2>📄 آخر الملفات</h2>${arts
        .slice(-6)
        .reverse()
        .map(
          (a) => `<div class="item"><b>${esc((a.title || a.id || "").slice(0, 70))}</b>
          <div class="muted">${since(a.createdAt)}${a.agentId ? " • " + esc((agents.find((x) => x.id === a.agentId) || {}).name || "") : ""}</div></div>`
        )
        .join("")}</div>`
    : "";

  const chatHtml =
    chat.length || act.length
      ? `<div class="sec"><h2>💬 آخر الكلام</h2>${[
          ...chat.slice(0, 4).map((c) => ({ t: (c.role === "owner" ? "🧑 إنت: " : "🎩 المدير: ") + (c.text || ""), at: c.at })),
          ...act.slice(0, 6).map((a) => ({ t: a.text || "", at: a.at })),
        ]
          .slice(0, 8)
          .map((x) => `<div class="item">${esc(String(x.t).slice(0, 140))}<div class="muted">${since(x.at)}</div></div>`)
          .join("")}</div>`
      : "";

  const runsHtml = runs.length
    ? `<div class="sec"><h2>⚙️ الجولات</h2><div class="muted">${runs.length} جولة مسجّلة • آخر جولة ${since(
        (runs[runs.length - 1] || {}).at
      )}</div></div>`
    : "";

  const ask = `
  <div class="sec" style="border-color:#24406b;background:#0c1930">
    <h2>✍️ اطلب أي حاجة</h2>
    <textarea id="ask-text" placeholder="اكتب طلبك هنا… مثال: اكتب لي مقال عن السياحة في مصر"></textarea>
    <button id="ask-send">🚀 ابعت الطلب للشركة</button>
    <div class="muted" style="margin-top:8px">
      هيتحوّل لطلب رسمي (Issue) والشركة تقراه وتنفّذه في الجولة الجاية.
    </div>
  </div>`;

  const body = document.getElementById("dash-body");
  if (!body) return;
  body.innerHTML = `
  <header>
    <div class="wrap">
      <button class="close" id="dash-x">✕ رجوع للشركة</button>
      <h1>🏢 شركة الذكاء المستقلة</h1>
      <div class="sub">${s.company && s.company.name ? esc(s.company.name) : "لوحة المتابعة"} • ${
    agents.filter((a) => a.connectionId && a.model).length
  }/${agents.length} موظف جاهز</div>
    </div>
  </header>
  ${stateHtml}
  ${stats}
  ${progress}
  ${ask}
  ${liveHtml}
  ${projectsHtml}
  ${artHtml}
  ${chatHtml}
  ${runsHtml}
  <div class="muted" style="text-align:center;margin:18px 0">
    آخر تحديث ${new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
  </div>`;

  document.getElementById("dash-x").onclick = close;
  document.getElementById("ask-send").onclick = () => {
    const v = (document.getElementById("ask-text").value || "").trim();
    if (!v) return;
    location.href = ISSUES + encodeURIComponent(v);
  };
}

/* ---------------------------- القراءة ---------------------------- */
let loading = false;
async function pull() {
  if (loading) return;
  loading = true;
  try {
    const r = await fetch(DATA + "?t=" + Date.now(), { cache: "no-store" });
    const s = await r.json();
    window.__companyState = s;
    render(s);
  } catch (e) {
    const b = document.getElementById("dash-body");
    if (b && !b.innerHTML.trim())
      b.innerHTML = `<div class="sec">⚠️ تعذر قراءة حالة الشركة (${esc(e.message)})</div>`;
  } finally {
    loading = false;
  }
}

/* ---------------------------- التشغيل ---------------------------- */
function boot() {
  style();
  // زر عائم
  if (!document.getElementById("dash-fab")) {
    const f = document.createElement("button");
    f.id = "dash-fab";
    f.textContent = "📊 إحصائيات وطلب جديد";
    f.style.cssText =
      "position:fixed;right:14px;bottom:14px;z-index:999998;background:#1d6fe8;color:#fff;" +
      "border:0;border-radius:99px;padding:12px 18px;font:700 14px system-ui;direction:rtl;" +
      "box-shadow:0 6px 24px #0009;cursor:pointer";
    f.onclick = open;
    document.body.appendChild(f);
  }
  // اللوحة مقفولة افتراضيًا — الشركة 3D هي الأساس
  setInterval(() => {
    const d = document.getElementById("dash");
    if (d && d.style.display !== "none") pull();
  }, 30_000);
}
addEventListener("DOMContentLoaded", boot);
if (document.readyState !== "loading") boot();
