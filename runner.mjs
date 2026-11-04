// ============================================================================
//  runner.mjs — مشغّل الشركة على GitHub Actions (بدون سيرفر إطلاقًا)
//
//  الفكرة: لا سيرفر، لا IP، لا استضافة، لا جهاز مفتوح.
//  GitHub بيصحّى هذا الملف كل 5 دقايق، ينفّذ شغل الشركة، يحفظ، وينام تاني.
//  البيانات محفوظة في الريبو نفسه على GitHub.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { CompanyEngine, freshDb } from "./core.mjs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "company.json");
const ART_DIR = path.join(DATA_DIR, "artifacts");
const BUDGET_MS = Number(process.env.RUN_BUDGET_MS || 60000); // ميزانية الوقت لكل تشغيلة
const ONCE = process.argv.includes("--once");

fs.mkdirSync(ART_DIR, { recursive: true });

// ---------------------------------------------------------------------------
//  مخزن على ملفات — نفس واجهة DurableStore
// ---------------------------------------------------------------------------
class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.db = null;
    this.dirty = false;
    this.snapshots = { collections: new Map(), runs: new Map(), artifacts: new Map() };
    this._art = new Map();
  }
  load() {
    if (this.db) return this.db;
    if (fs.existsSync(DB_FILE)) {
      try {
        this.db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      } catch {
        const bad = `${DB_FILE}.corrupt-${Date.now()}`;
        fs.renameSync(DB_FILE, bad);
        console.warn(`⚠️ ملف تالف — نُقل إلى ${path.basename(bad)}`);
        this.db = freshDb();
        this.dirty = true;
      }
    } else {
      this.db = freshDb();
      this.dirty = true;
    }
    return this.db;
  }
  save() {
    this.dirty = true;
  }
  flush() {
    if (this.dirty) this.saveNow();
  }
  saveNow() {
    if (!this.db) this.load();
    if (!this.dirty) return;
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, DB_FILE);
    this.dirty = false;
  }
  _p(id) {
    return path.join(ART_DIR, encodeURIComponent(id) + ".bin");
  }
  writeArtifact(id, _e, data) {
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data ?? ""));
    fs.writeFileSync(this._p(id), Buffer.from(bytes));
  }
  writeArtifactText(id, t) {
    this.writeArtifact(id, "md", new TextEncoder().encode(String(t ?? "")));
  }
  writeArtifactBase64(id, b) {
    this.writeArtifact(id, "bin", Buffer.from(String(b || ""), "base64"));
  }
  hasArtifact(id) {
    return fs.existsSync(this._p(id));
  }
  readArtifact(id) {
    const p = this._p(id);
    if (!fs.existsSync(p)) return null;
    return new Uint8Array(fs.readFileSync(p));
  }
  readArtifactText(id) {
    const b = this.readArtifact(id);
    return b ? new TextDecoder().decode(b) : "";
  }
  replaceDb(next, contents = []) {
    this.db = next;
    this.dirty = true;
    this.saveNow();
    for (const it of contents || []) {
      if (!it?.id) continue;
      if (it.contentBase64) this.writeArtifactBase64(it.id, it.contentBase64);
      else if (it.contentText !== undefined) this.writeArtifactText(it.id, it.contentText);
    }
    return this.db;
  }
  getOrCreateInternalSecret() {
    if (!this.db) this.load();
    const meta = (this.db.storeMeta = this.db.storeMeta || {});
    if (meta.secret) return meta.secret;
    meta.secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    this.dirty = true;
    this.saveNow();
    return meta.secret;
  }
  stats() {
    let bytes = 0;
    try {
      bytes = fs.statSync(DB_FILE).size;
    } catch {}
    return { runs: (this.db?.runs || []).length, artifacts: (this.db?.artifacts || []).length, dbBytes: bytes };
  }
}

// ---------------------------------------------------------------------------
//  تشغيل
// ---------------------------------------------------------------------------
const store = new FileStore(DATA_DIR);
const env = { ...process.env, OWNER_OPEN_MODE: "true", ALLOW_OPEN_DEV: "true" };
const engine = new CompanyEngine({
  store,
  env,
  setAlarm: () => {}, // لا مؤقتات — GitHub هو المؤقت
  getAlarm: () => null,
  deleteAlarm: () => {}
});

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------------------------------------------------------------------------
//  تطبيق company.config.json — الطريقة الوحيدة لإدخال المفاتيح بدون واجهة
// ---------------------------------------------------------------------------
const CFG_FILE = process.env.CONFIG_FILE || path.join(process.cwd(), "company.config.json");

async function applyConfig(engine, db) {
  if (!fs.existsSync(CFG_FILE)) return db;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
  } catch (e) {
    log(`⚠️ company.config.json غير صالح: ${String(e.message).slice(0, 120)}`);
    return db;
  }

  // 1) حالة الحلقة
  if (cfg.loop && typeof cfg.loop.enabled === "boolean") {
    db.loop.enabled = cfg.loop.enabled;
  }

  // 2) المزود — يُضاف مرة واحدة فقط
  const pr = cfg.provider || {};
  const key = String(process.env.PROVIDER_API_KEY || pr.apiKey || "").trim();
  if (process.env.PROVIDER_API_KEY) log("🔑 المفتاح مقروء من GitHub Secrets (لا يُحفظ في الريبو)");
  if (key && !/PUT_YOUR|YOUR_KEY|CHANGE_ME/i.test(key)) {
    const exists = (db.connections || []).some((c) => c.type === pr.type && c.masked && c.masked.endsWith(key.slice(-4)));
    if (!exists) {
      try {
        const req = new Request("http://local/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: pr.type || "groq",
            name: pr.name || "Groq",
            apiKey: key,
            model: pr.model || "",
            autoFetch: true
          })
        });
        const res = await engine.handleFetch(req);
        const body = await res.json();
        if (res.ok) {
          log(`🔌 أُضيف المزود: ${body.name} — اختبار: ${body.liveTest?.ok ? "✅ نجح" : "❌ " + (body.liveTest?.error || "فشل")}`);
          db = engine.store.load();
        } else {
          log(`⚠️ فشل إضافة المزود: ${body.error || res.status}`);
        }
      } catch (e) {
        log(`⚠️ خطأ في المزود: ${String(e.message).slice(0, 160)}`);
      }
    }
  }

  // 3) تهيئة كل الموظفين على المزود الجاهز
  const ready = (db.connections || []).find((c) => c.enabled !== false && c.type === (pr.type || "groq") && (c.models || []).length);
  if (ready && key && !/PUT_YOUR|YOUR_KEY|CHANGE_ME/i.test(key)) {
    // وزّع على عدة موديلات — كل موديل له حد مستقل على المزود
    const GOOD = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "allam-2-7b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
    const usable = (ready.models || []).filter((m) => !/whisper|tts|guard|embed|orpheus/i.test(m));
    let pool = GOOD.filter((m) => usable.includes(m));
    if (!pool.length) pool = usable.length ? usable : [pr.model].filter(Boolean);
    if (pool.length) {
      const ceo = db.agents.find((a) => a.isCeo);
      if (ceo) { ceo.connectionId = ready.id; ceo.model = pool[0]; }
      let i = 0;
      for (const a of db.agents) {
        if (a.isCeo) continue;
        a.connectionId = ready.id;
        a.model = pool[i++ % pool.length];
      }
      const counts = {};
      for (const a of db.agents) counts[a.model] = (counts[a.model] || 0) + 1;
      log(`👥 وزّعت الموظفين على ${pool.length} نموذج: ${JSON.stringify(counts)}`);
    }
  }

  // 4) أهداف جديدة → مشاريع
  for (const g of cfg.goals || []) {
    const goal = String(g || "").trim();
    if (!goal || goal.startsWith("_")) continue;
    const dup = (db.projects || []).some((p) => p.goal === goal);
    if (dup) continue;
    try {
      const res = await engine.handleFetch(new Request("http://local/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal })
      }));
      if (res.ok) log(`🎯 هدف جديد: ${goal.slice(0, 70)}`);
      else log(`⚠️ الهدف لم يُضف (${res.status}): ${String((await res.text()).slice(0, 140))}`);
    } catch (e) {
      log(`⚠️ فشل إضافة الهدف: ${String(e.message).slice(0, 120)}`);
    }
  }

  // 5) الإعدادات
  const st = cfg.settings || {};
  if (typeof st.concurrency === "number") db.settings.concurrency = st.concurrency;
  // Groq: حد التوكنز صغير لكل طلب — قلّل الحجم الفردي
  db.settings.maxTokensPerCall = Math.min(Number(db.settings.maxTokensPerCall || 1600), 1600);
  if (typeof st.maxSteps === "number") db.settings.maxSteps = st.maxSteps;
  if (typeof st.autonomy === "boolean") {
    db.settings.autonomy = db.settings.autonomy || {};
    db.settings.autonomy.enabled = st.autonomy;
  }

  engine.mark();
  engine.persist();
  return engine.store.load();
}

async function main() {
  let db = store.load();
  const started = Date.now();

  log("═══════════════════════════════════════════════════════");
  log(`🏢 تشغيلة شركة — GitHub Actions (بدون سيرفر)`);
  log(`👥 الوكلاء: ${db.agents.length} • المشاريع: ${(db.projects || []).length} • المهام: ${(db.tasks || []).length}`);
  log(`🔁 الحلقة: ${db.loop?.enabled ? "مفعّلة" : "موقوفة"} • ميزانية: ${Math.round(BUDGET_MS / 1000)}ث`);
  log("═══════════════════════════════════════════════════════");

  if (!db.loop) db.loop = {};
  await applyConfig(engine, db);
  db = engine.store.load();
  if (!db.loop.enabled) {
    log("⏸ الحلقة موقوفة — لتفعيلها: عدّل data/company.json → loop.enabled = true");
    log("   أو شغّل: LOOP_ENABLE=1 node runner.mjs");
    store.flush();
    return;
  }

  let steps = 0;
  let lastOp = null;
  let waits = 0;
  const MAX_WAITS = Number(process.env.MAX_WAITS || 4);
  while (Date.now() - started < BUDGET_MS) {
    let result;
    try {
      result = await engine.handleAlarm();
    } catch (e) {
      log(`⚠️ خطأ: ${String(e?.message || e).slice(0, 300)}`);
      break;
    }
    steps++;
    lastOp = result?.operation || "unknown";
    const worked = result?.worked ? "✅ عمل" : "⏳ انتظار";
    log(`  ${steps}. ${worked} — ${lastOp}`);
    if (ONCE) break;
    if (!result?.worked) {
      waits++;
      if (waits >= MAX_WAITS) {
        log(`  (انتظار ${waits} مرات متتالية — إنهاء مبكر لتوفير الوقت)`);
        break;
      }
    } else {
      waits = 0;
    }
    if (!result?.worked && !result?.nextAt) {
      // لا شغل متاح الآن — نخرج بدل ما نحرق وقت
      if (!engine.hasPendingWork?.()) {
        log("  (لا شغل معلّق — إنهاء مبكر)");
        break;
      }
    }
    // لو المزود طلب انتظارًا (429)، استنى فعليًا بدل التكرار السريع
    const waitUntil = Math.min(
      ...(store.db.tasks || []).filter((t) => t.nextRetryAt && t.nextRetryAt > Date.now()).map((t) => t.nextRetryAt),
      Infinity
    );
    let pause = 500;
    if (Number.isFinite(waitUntil)) {
      pause = Math.min(70000, Math.max(500, waitUntil - Date.now()));
      if (pause > 2000) log(`  ⏳ انتظار ${Math.round(pause / 1000)}ث (حد المزود)`);
    }
    if (Date.now() - started + pause > BUDGET_MS) break;
    await new Promise((r) => setTimeout(r, pause));
  }

  store.flush();
  const after = store.load();
  publishPublic(after);
  log("───────────────────────────────────────────────────────");
  log(`📊 الخطوات: ${steps} • آخر عملية: ${lastOp}`);
  log(`📋 مهام: ${(after.tasks || []).length} (منجزة: ${(after.tasks || []).filter((t) => t.status === "approved").length})`);
  log(`📁 ملفات: ${(after.artifacts || []).length} • نشاط: ${(after.activity || []).length}`);
  log(`💾 حُفظ في data/company.json (${store.stats().dbBytes || 0} بايت)`);
}

// انشر نسخة عامة للصفحة (بدون أي مفاتيح)
function publishPublic(db) {
  try {
    const copy = JSON.parse(JSON.stringify(db || {}));
    for (const c of copy.connections || []) { delete c.apiKey; delete c.key; delete c.secret; }
    delete copy.storeMeta;
    fs.writeFileSync(path.join(process.cwd(), "company.json"), JSON.stringify(copy));
    log("🌐 حُدّثت نسخة الموقع العامة (بدون مفاتيح)");
  } catch (e) { log("تعذر نشر النسخة العامة: " + (e.message || e)); }
}

main().catch((e) => {
  console.error("فشل التشغيل:", e);
  process.exit(1);
});
