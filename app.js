import { MACHINES, ORDER } from "./data/machines.js";

/* ---------- storage ---------- */
const LS = {
  mem: {},
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return k in this.mem ? this.mem[k] : d; } },
  set(k, v) { this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
let sessions = LS.get("jug.sessions", []);
let activeId = LS.get("jug.active", null);
let lastStore = LS.get("jug.store", "");
let view = "start";
let detailId = null;
let machineSel = "myj";
let startMachine = LS.get("jug.machine", "myj");
let sub = false;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cur = () => sessions.find(s => s.id === activeId && s.status === "active") || null;
const byId = id => sessions.find(s => s.id === id);
const int = v => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };

function saveAll() {
  LS.set("jug.sessions", sessions);
  LS.set("jug.active", activeId);
}
function persist(s) {
  s.updatedAt = new Date().toISOString();
  s.posterior = posterior(s);
  saveAll();
}
function toast(t) {
  const el = $("#toast"); el.textContent = t; el.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 1600);
}

/* ---------- calc ---------- */
const bigOf = s => s.counts.sBig + s.counts.cBig;
const regOf = s => s.counts.sReg + s.counts.cReg;
function countOf(s, k) {
  if (k === "big") return bigOf(s);
  if (k === "reg") return regOf(s);
  if (k === "tot") return bigOf(s) + regOf(s);
  return s.counts[k];
}
function fmtP(x) { return x < 10 ? x.toFixed(2) : x.toFixed(1); }
function ratioStr(g, k) { return g > 0 && k > 0 ? "1/" + fmtP(g / k) : "—"; }
function nearest(arr, val) {
  let bi = 0, bd = Infinity;
  arr.forEach((a, i) => { const d = Math.abs(Math.log(a) - Math.log(val)); if (d < bd) { bd = d; bi = i; } });
  return bi + 1;
}
function hasData(s) { return s.normalG > 0 || (s.prev && s.prev.G > 0); }
function posterior(s) {
  const m = MACHINES[s.machine];
  const lnL = [0, 0, 0, 0, 0, 0];
  const add = (arr, k, n) => {
    if (!arr || n <= 0) return;
    for (let i = 0; i < 6; i++) {
      const p = 1 / arr[i];
      lnL[i] += k * Math.log(p) + (n - k) * Math.log(1 - p);
    }
  };
  for (const key of m.use) {
    const arr = key === "big" ? m.big : key === "reg" ? m.reg : m[key];
    add(arr, countOf(s, key), s.normalG);
  }
  if (s.prev && s.prev.G > 0) {
    add(m.big, s.prev.big, s.prev.G);
    add(m.reg, s.prev.reg, s.prev.G);
  }
  const mx = Math.max(...lnL);
  const e = lnL.map(v => Math.exp(v - mx));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / sum);
}
function topSetting(s) {
  if (!hasData(s)) return null;
  const p = s.posterior && s.posterior.length === 6 ? s.posterior : posterior(s);
  let bi = 0; p.forEach((v, i) => { if (v > p[bi]) bi = i; });
  return { set: bi + 1, pct: p[bi] * 100 };
}
const ITEMS = [["grape", "ブドウ"], ["cherry", "チェリー"], ["sBig", "単独BIG"], ["sReg", "単独REG"], ["cBig", "重複BIG"], ["cReg", "重複REG"], ["big", "BIG合計"], ["reg", "REG合計"], ["tot", "ボーナス合算"]];
function itemLabel(m, k, lb) {
  if (k === "cBig") return m.dupBtn + "BIG";
  if (k === "cReg") return m.dupBtn + "REG";
  return lb;
}

/* ---------- text export ---------- */
function two(n) { return String(n).padStart(2, "0"); }
function sessionLine(s) {
  const m = MACHINES[s.machine], c = s.counts, g = s.normalG, d = new Date(s.startedAt);
  const parts = [`${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`];
  if (s.store) parts.push(s.store);
  if (s.dai) parts.push("台" + s.dai);
  parts.push(m.name, g + "G");
  parts.push(`BIG${bigOf(s)}(単${c.sBig}/重${c.cBig})`, `REG${regOf(s)}(単${c.sReg}/重${c.cReg})`);
  if (m.grape || c.grape > 0) parts.push(`ブドウ${c.grape}(${ratioStr(g, c.grape)})`);
  if (m.cherry || c.cherry > 0) parts.push(`チェリー${c.cherry}(${ratioStr(g, c.cherry)})`);
  const t = topSetting(s);
  return parts.join(" ") + (t ? ` → 最有力 設定${t.set}(${Math.round(t.pct)}%)` : "");
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("コピーしました"); return true; } catch (e) { }
  try {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, t.length);
    const ok = document.execCommand("copy"); ta.remove();
    toast(ok ? "コピーしました" : "コピー失敗"); return ok;
  } catch (e) { toast("コピー失敗"); return false; }
}

/* ---------- modal ---------- */
function modal(bodyHTML, btns, onMount) {
  const ov = document.createElement("div");
  ov.className = "ov mod";
  ov.innerHTML = `<div class="mbox"><div class="mb">${bodyHTML}</div><div class="mbtn"></div></div>`;
  const box = $(".mbtn", ov);
  const close = () => ov.remove();
  btns.forEach(b => {
    const el = document.createElement("button");
    el.textContent = b.t; if (b.cls) el.className = b.cls;
    el.onclick = () => { if (b.fn) { if (b.fn(ov) === false) return; } close(); };
    box.appendChild(el);
  });
  document.body.appendChild(ov);
  if (onMount) onMount(ov);
  return ov;
}
const confirmModal = (msg, ok = "削除", cls = "dng") => new Promise(res => {
  modal(esc(msg), [{ t: "キャンセル", fn: () => res(false) }, { t: ok, cls, fn: () => res(true) }]);
});

/* ---------- views ---------- */
const app = $("#app");

function tabbar(active) {
  const s = cur();
  const tabs = [["count", "カウント"], ["prob", "確率・判別"], ["machine", "機種データ"], ["records", "記録"]];
  const info = s ? `${MACHINES[s.machine].name} ${s.store || ""} ${s.dai ? "台" + s.dai : ""}` : "";
  return `<nav id="bar">` +
    tabs.map(([k, l]) => `<button data-go="${k}" class="${active === k ? "on" : ""}">${l}</button>`).join("") +
    `<span class="info">${esc(info)}</span><button data-go="start">⌂</button></nav>`;
}
function wireBar() {
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
}
function go(v) {
  if ((v === "count" || v === "prob") && !cur()) v = "start";
  view = v;
  render();
}

function render() {
  document.body.classList.remove("show");
  document.body.classList.toggle("sub", view === "count" && sub);
  if (view !== "count") sub = false, document.body.classList.remove("sub");
  ({ start: renderStart, count: renderCount, prob: renderProb, machine: renderMachine, records: renderRecords, detail: renderDetail })[view]();
}

/* --- start --- */
function renderStart() {
  const a = cur();
  const m0 = startMachine;
  const ap = a ? topSetting(a) : null;
  app.innerHTML = `<div id="main"><div class="start">
    <h1>ジャグラーカウンター</h1>
    ${a ? `<div class="cont"><button class="pri" id="cont" style="width:100%;padding:12px;font-size:16px">続きから：${esc(MACHINES[a.machine].name)} ${esc(a.store)} ${a.dai ? "台" + esc(a.dai) : ""}（BIG${bigOf(a)} REG${regOf(a)} / ${a.normalG}G）</button></div>` : ""}
    <div class="mgrid">${ORDER.map(k => `<button data-m="${k}" class="${k === m0 ? "on" : ""}">${MACHINES[k].name}</button>`).join("")}</div>
    <div class="row"><div><label>店名</label><input id="store" value="${esc(lastStore)}" autocomplete="off"></div>
      <div><label>台番号（任意）</label><input id="dai" inputmode="numeric" autocomplete="off"></div></div>
    <label>前任者データ（任意）</label>
    <div class="row"><div><input id="pg" inputmode="numeric" placeholder="前任G数"></div>
      <div><input id="pb" inputmode="numeric" placeholder="前任BIG"></div>
      <div><input id="pr" inputmode="numeric" placeholder="前任REG"></div></div>
    <div class="btns"><button class="pri" id="go">スタート</button><button id="rec">記録から再開</button><button id="md">機種データ</button></div>
  </div></div>`;
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
    startMachine = b.dataset.m; LS.set("jug.machine", startMachine);
    document.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
  });
  if (a) $("#cont").onclick = () => go("count");
  $("#rec").onclick = () => go("records");
  $("#md").onclick = () => go("machine");
  $("#go").onclick = () => {
    const prev = { G: int($("#pg").value), big: int($("#pb").value), reg: int($("#pr").value) };
    const store = $("#store").value.trim();
    lastStore = store; LS.set("jug.store", store);
    sessions.forEach(s => { if (s.status === "active") s.status = "saved"; });
    const now = new Date().toISOString();
    const s = {
      id: uuid(), startedAt: now, updatedAt: now, machine: startMachine, store, dai: $("#dai").value.trim(),
      normalG: 0, counts: { grape: 0, cherry: 0, sBig: 0, sReg: 0, cBig: 0, cReg: 0 }, prev, memo: "",
      posterior: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6], status: "active", log: []
    };
    sessions.push(s); activeId = s.id; persist(s);
    go("count");
  };
}

/* --- count --- */
const PADS = [
  ["grape", "ブドウ", "big2"], ["cherry", "チェリー", "big2"], ["sBig", "単独BIG", ""],
  ["sReg", "単独REG", ""], ["cBig", "", ""], ["cReg", "", ""]
];
function renderCount() {
  const s = cur(); if (!s) return go("start");
  const m = MACHINES[s.machine];
  const pad = ([k, l, c]) => {
    if (k === "cBig") l = m.dupBtn + "BIG";
    if (k === "cReg") l = m.dupBtn + "REG";
    return `<div class="cb ${k} ${c}" data-k="${k}" role="button"><span class="lb">${l}</span><span class="num" data-n="${k}"></span></div>`;
  };
  app.innerHTML = tabbar("count") + `<div id="count"><div id="pads">
      <div class="prow r1">${PADS.slice(0, 3).map(pad).join("")}</div>
      <div class="prow r2">${PADS.slice(3).map(pad).join("")}</div></div>
    <div id="side"><button id="shw">表示</button><button id="sub">減算 OFF</button><button id="undo">1つ戻す</button>
      <div id="memo"></div></div></div><div id="subtag">減算中</div>`;
  wireBar();
  updateCount(); updateMemo();
  document.querySelectorAll(".cb").forEach(b => {
    b.addEventListener("click", () => tap(b.dataset.k, b));
    b.addEventListener("contextmenu", e => e.preventDefault());
  });
  const shw = $("#shw");
  const on = e => { e.preventDefault(); document.body.classList.add("show"); };
  const off = () => document.body.classList.remove("show");
  shw.addEventListener("pointerdown", on);
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => shw.addEventListener(ev, off));
  shw.addEventListener("contextmenu", e => e.preventDefault());
  const sb = $("#sub");
  sb.onclick = () => {
    sub = !sub;
    sb.classList.toggle("on", sub); sb.textContent = sub ? "減算 ON" : "減算 OFF";
    document.body.classList.toggle("sub", sub);
  };
  if (sub) { sb.classList.add("on"); sb.textContent = "減算 ON"; document.body.classList.add("sub"); }
  $("#undo").onclick = undo;
  $("#memo").onclick = openMemo;
}
function updateCount() {
  const s = cur(); if (!s) return;
  document.querySelectorAll("[data-n]").forEach(el => el.dataset.v = s.counts[el.dataset.n]);
}
function fx(el, d) {
  if (!el) return;
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 150);
  const f = document.createElement("span"); f.className = "fx"; f.textContent = d > 0 ? "+1" : "−1";
  el.appendChild(f); setTimeout(() => f.remove(), 750);
}
function tap(k, el) {
  const s = cur(); if (!s) return;
  const d = sub ? -1 : 1;
  if (d < 0 && s.counts[k] <= 0) return;
  s.counts[k] += d;
  s.log.push({ k, d }); if (s.log.length > 500) s.log.shift();
  persist(s); updateCount(); fx(el, d);
}
function undo() {
  const s = cur(); if (!s || !s.log.length) return toast("戻す操作がありません");
  const { k, d } = s.log.pop();
  s.counts[k] = Math.max(0, s.counts[k] - d);
  persist(s); updateCount(); fx($(`.cb[data-k="${k}"]`), -d);
}
function updateMemo() {
  const s = cur(), el = $("#memo"); if (!s || !el) return;
  el.textContent = s.memo || "メモ（タップで入力）";
  el.classList.toggle("empty", !s.memo);
}
function openMemo() {
  const s = cur(); if (!s) return;
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="top"><span>メモ（自動保存）</span><button id="mc">閉じる</button></div><textarea id="mt" placeholder="メモ"></textarea>`;
  document.body.appendChild(ov);
  const t = $("#mt", ov); t.value = s.memo || "";
  t.oninput = () => { s.memo = t.value; persist(s); };
  $("#mc", ov).onclick = () => { ov.remove(); updateMemo(); };
  t.focus();
}

/* --- prob --- */
function probTable(s) {
  const m = MACHINES[s.machine], g = s.normalG;
  const rows = ITEMS.map(([k, lb]) => {
    const n = countOf(s, k);
    const arr = m[k];
    const eq = arr && g > 0 && n > 0 ? "設定" + nearest(arr, g / n) + "相当" : "—";
    const label = itemLabel(m, k, lb);
    const unp = !arr ? ' <small style="color:#666">(未公表)</small>' : "";
    return `<tr><td>${label}${unp}</td><td>${n}</td><td>${ratioStr(g, n)}</td><td>${eq}</td></tr>`;
  }).join("");
  return `<table><tr><th>項目</th><th>回数</th><th>確率</th><th>設定相当</th></tr>${rows}</table>`;
}
function postBars(s) {
  const p = posterior(s);
  const mx = Math.max(...p);
  const show = hasData(s);
  const bars = p.map((v, i) => `<div class="pb ${show && v === mx ? "top" : ""}"><span class="nm">設定${i + 1}</span><span class="bar"><i style="width:${(v * 100).toFixed(1)}%"></i></span><span class="pc">${(v * 100).toFixed(1)}%</span></div>`).join("");
  const warn = s.normalG < 1500 ? `<div class="note warn">※1500G未満のため参考程度</div>` : "";
  return bars + warn;
}
function renderProb() {
  const s = cur(); if (!s) return go("start");
  app.innerHTML = tabbar("prob") + `<div id="main"><div class="pad">
    <div class="row" style="align-items:flex-end">
      <div><label>通常時の回転数（ボーナス中除く）</label><input id="ng" inputmode="numeric" value="${s.normalG || ""}"></div>
      <div><label>前任G数</label><input id="pg" inputmode="numeric" value="${s.prev.G || ""}"></div>
      <div><label>前任BIG</label><input id="pb" inputmode="numeric" value="${s.prev.big || ""}"></div>
      <div><label>前任REG</label><input id="pr" inputmode="numeric" value="${s.prev.reg || ""}"></div>
      <div style="flex:none"><button class="pri" id="ok" style="padding:9px 18px">決定</button></div>
    </div>
    <div class="cols"><div><h2>項目別の確率</h2>${probTable(s)}</div><div><h2>設定推測</h2>${postBars(s)}</div></div>
  </div></div>`;
  wireBar();
  $("#ok").onclick = () => {
    s.normalG = int($("#ng").value);
    s.prev = { G: int($("#pg").value), big: int($("#pb").value), reg: int($("#pr").value) };
    persist(s); renderProb(); toast("決定しました");
  };
}

/* --- machine --- */
function renderMachine() {
  const m = MACHINES[machineSel];
  const cell = (arr, i, f) => arr && arr[i] != null ? f(arr[i]) : "—";
  const cols = [["big", "BIG"], ["reg", "REG"], ["tot", "合算"], ["grape", "ブドウ"], ["cherry", "チェリー"], ["sBig", "単独BIG"], ["sReg", "単独REG"], ["cBig", "重複BIG"], ["cReg", "重複REG"]];
  const head = `<tr><th>設定</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}<th>機械割</th></tr>`;
  const body = [0, 1, 2, 3, 4, 5].map(i => `<tr><td>設定${i + 1}</td>${cols.map(([k]) => {
    const v = m[k]; return v ? `<td>${v[i].toFixed(k === "grape" ? 2 : 2)}</td>` : `<td class="nd">未公表</td>`;
  }).join("")}<td>${m.payout[i] != null ? m.payout[i].toFixed(1) + "%" : '<span class="nd">要確認</span>'}</td></tr>`).join("");
  app.innerHTML = tabbar("machine") + `<div id="main"><div class="pad">
    <div class="mchips">${ORDER.map(k => `<button data-ms="${k}" class="${k === machineSel ? "on" : ""}">${MACHINES[k].name}</button>`).join("")}</div>
    <div class="note">数値は分母（1/x の x）。「未公表」は解析値なし。</div>
    <div class="tbl-wrap"><table>${head}${body}</table></div>
    ${m.notes.map(n => `<div class="note">・${esc(n)}</div>`).join("")}
    <div class="note">・参考値（実戦値）は「参考」と明記したもののみ。</div>
    <div class="note">・単独/重複の見分け方：左リール枠上〜上段にBARを目安にチェリーを狙う。7狙いだと重複が判別できない。</div>
  </div></div>`;
  wireBar();
  document.querySelectorAll("[data-ms]").forEach(b => b.onclick = () => { machineSel = b.dataset.ms; renderMachine(); });
}

/* --- records --- */
function renderRecords() {
  const list = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const items = list.map(s => {
    const d = new Date(s.startedAt), t = topSetting(s);
    return `<button class="rec" data-id="${s.id}">${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}
      <b>${esc(s.store) || "（店名なし）"}</b> ${s.dai ? "台" + esc(s.dai) : ""}${s.status === "active" ? '<span class="badge">実戦中</span>' : ""}<br>
      <small>${MACHINES[s.machine].name} / ${s.normalG}G / BIG${bigOf(s)} REG${regOf(s)} / ${t ? `最有力 設定${t.set}(${Math.round(t.pct)}%)` : "最有力 —"}</small></button>`;
  }).join("");
  app.innerHTML = tabbar("records") + `<div id="main"><div class="pad">
    <div class="btns" style="margin:0 0 8px"><button id="bk">バックアップ書き出し</button><button id="im">読み込み</button></div>
    ${items || '<div class="note">記録がありません</div>'}</div></div>`;
  wireBar();
  document.querySelectorAll(".rec").forEach(b => b.onclick = () => { detailId = b.dataset.id; view = "detail"; render(); });
  $("#bk").onclick = exportBackup;
  $("#im").onclick = importBackup;
}
function renderDetail() {
  const s = byId(detailId); if (!s) return go("records");
  const m = MACHINES[s.machine], d = new Date(s.startedAt);
  const line = sessionLine(s);
  app.innerHTML = tabbar("records") + `<div id="main"><div class="pad">
    <div class="btns" style="margin:0 0 8px"><button id="back">← 一覧</button><button class="pri" id="resume">この記録から再開</button><button id="cp">テキストでコピー</button><button class="dng" id="del">削除</button></div>
    <div class="note">${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())} ／ ${esc(s.store) || "（店名なし）"} ${s.dai ? "台" + esc(s.dai) : ""} ／ ${m.name} ／ 通常時${s.normalG}G${s.prev.G ? ` ／ 前任 ${s.prev.G}G BIG${s.prev.big} REG${s.prev.reg}` : ""}</div>
    <div class="text-line">${esc(line)}</div>
    <div class="cols"><div><h2>項目別の確率</h2>${probTable(s)}</div><div><h2>設定推測</h2>${postBars(s)}</div></div>
    <h2>メモ</h2><div class="text-line" style="white-space:pre-wrap">${esc(s.memo) || "—"}</div>
  </div></div>`;
  wireBar();
  $("#back").onclick = () => go("records");
  $("#cp").onclick = () => copyText(line);
  $("#resume").onclick = () => {
    sessions.forEach(x => { if (x.status === "active" && x.id !== s.id) x.status = "saved"; });
    s.status = "active"; if (!s.log) s.log = []; activeId = s.id; persist(s); go("count");
  };
  $("#del").onclick = async () => {
    if (!(await confirmModal("この記録を削除しますか？（元に戻せません）"))) return;
    sessions = sessions.filter(x => x.id !== s.id);
    if (activeId === s.id) activeId = null;
    saveAll(); go("records");
  };
}

/* --- backup --- */
function exportBackup() {
  const json = JSON.stringify({ app: "jug-counter", v: 1, exportedAt: new Date().toISOString(), sessions }, null, 0);
  modal(`バックアップ（全${sessions.length}件）<textarea readonly id="bt"></textarea>`, [
    { t: "テキストでコピー", cls: "pri", fn: () => { copyText(json); return false; } },
    ...(navigator.canShare ? [{
      t: "ファイル共有", fn: () => {
        try {
          const f = new File([json], "jug-backup.json", { type: "application/json" });
          if (navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(() => { });
          else toast("この端末ではファイル共有不可");
        } catch (e) { toast("共有できません"); }
        return false;
      }
    }] : []),
    { t: "閉じる" }
  ], ov => { $("#bt", ov).value = json; });
}
function importBackup() {
  modal(`バックアップのJSONを貼り付け（同じIDの記録は上書き）<textarea id="it"></textarea>`, [
    { t: "キャンセル" },
    {
      t: "読み込み", cls: "pri", fn: ov => {
        try {
          const data = JSON.parse($("#it", ov).value);
          const arr = Array.isArray(data) ? data : data.sessions;
          if (!Array.isArray(arr)) throw 0;
          let n = 0;
          arr.forEach(x => {
            if (!x || !x.id || !MACHINES[x.machine] || !x.counts) return;
            x.prev = x.prev || { G: 0, big: 0, reg: 0 }; x.log = x.log || []; x.memo = x.memo || "";
            x.normalG = x.normalG || 0; x.startedAt = x.startedAt || new Date().toISOString();
            x.status = x.status === "active" ? "saved" : (x.status || "saved");
            const i = sessions.findIndex(y => y.id === x.id);
            if (i >= 0) sessions[i] = x; else sessions.push(x);
            n++;
          });
          saveAll(); toast(`${n}件読み込みました`); render();
        } catch (e) { toast("読み込めませんでした"); return false; }
      }
    }
  ]);
}

/* ---------- boot ---------- */
document.addEventListener("dblclick", e => e.preventDefault());
document.addEventListener("gesturestart", e => e.preventDefault());
if (!cur()) activeId = activeId && byId(activeId) ? null : activeId;
render();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
}
