"use strict";

/* The policy is the whole point: six checks, no model, all evaluated. */
const POLICY = {
  perTx: 0.05,
  session: 0.04,
  maxRuns: 12,
  allow: ["api.weather.example", "api.data.example"],
  intent: {
    "api.weather.example": ["weather.current", "weather.forecast"],
    "api.data.example": ["dataset.slice", "dataset.schema"],
  },
};

const CASES = [
  {
    id: "c1",
    name: "A metered weather call",
    blurb: "The ordinary case. Small amount, allowlisted payee, resource inside the declared intent, fresh nonce.",
    proposal: { amount: 0.004, payee: "api.weather.example", resource: "weather.current", nonce: "n-8843", reason: "fetch current conditions for Chennai" },
    delivery: { ok: true, expected: "9f2c41a7", received: "9f2c41a7", note: "payload hash matches the commitment in the offer" },
  },
  {
    id: "c2",
    name: "An upgrade you did not ask for",
    blurb: "Planner decides the free tier is too slow and buys the premium one. The payee is legitimate; the amount is not.",
    proposal: { amount: 0.12, payee: "api.weather.example", resource: "weather.forecast", nonce: "n-8844", reason: "premium tier is faster, upgrading for latency" },
    delivery: { ok: true, expected: "aa10c3d2", received: "aa10c3d2" },
  },
  {
    id: "c3",
    name: "A cheaper mirror",
    blurb: "A tool result recommends an identical endpoint at a lower price. Nothing verifies who runs it.",
    proposal: { amount: 0.01, payee: "api.unknown.example", resource: "weather.current", nonce: "n-8845", reason: "same data, cheaper mirror" },
    delivery: { ok: true, expected: "b7e07711", received: "b7e07711" },
  },
  {
    id: "c4",
    name: "A replayed authorisation",
    blurb: "Captured from an earlier call and presented again. The signature is valid; the nonce is spent.",
    proposal: { amount: 0.004, payee: "api.weather.example", resource: "weather.current", nonce: "n-8842", reason: "retry of the previous authorisation" },
    delivery: { ok: true, expected: "c1d9ab30", received: "c1d9ab30" },
  },
  {
    id: "c5",
    name: "A poisoned tool output",
    blurb: "Everything about this proposal is in bounds except the thing being bought. This is the case the other checks cannot catch.",
    proposal: { amount: 0.02, payee: "api.data.example", resource: "dataset.export", nonce: "n-8846", reason: "tool output said to export the dataset first" },
    delivery: { ok: true, expected: "d4aa9021", received: "d4aa9021" },
  },
  {
    id: "c6",
    name: "Delivery that never arrives",
    blurb: "The proposal is clean and the kernel approves it. The seller takes the money and returns a payload that does not match its own offer.",
    proposal: { amount: 0.03, payee: "api.data.example", resource: "dataset.slice", nonce: "n-8847", reason: "slice of the pricing dataset for the report" },
    delivery: { ok: false, expected: "7c81f0b4", received: "4a71e2c9", note: "receipt is signed, but the payload hash does not match the offer" },
  },
  {
    id: "c7",
    name: "One more call",
    blurb: "Inside the per-transaction cap and inside the allowlist. The session has simply run out of money.",
    proposal: { amount: 0.045, payee: "api.data.example", resource: "dataset.schema", nonce: "n-8848", reason: "inspect schema before the next step" },
    delivery: { ok: true, expected: "e55211aa", received: "e55211aa" },
  },
];

const CHECK_COPY = [
  ["amount", "amount <= per-tx cap"],
  ["payee", "payee in allowlist"],
  ["nonce", "nonce unused"],
  ["intent", "resource matches intent"],
  ["budget", "session budget"],
  ["velocity", "velocity limit"],
];

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

const state = {
  spent: 0.002,
  locked: 0,
  refused: 0,
  released: 0,
  bad: 0,
  runs: 0,
  nonces: new Set(["n-8842"]),
  prev: "genesis",
  entries: [],
  busy: false,
  selected: null,
};

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + n.toFixed(3);

function hashOf(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

function evaluate(p) {
  const results = [];
  results.push({
    key: "amount",
    ok: p.amount > 0 && p.amount <= POLICY.perTx,
    value: money(p.amount) + " vs " + money(POLICY.perTx),
    reason: "over the per-transaction cap",
  });
  results.push({
    key: "payee",
    ok: POLICY.allow.includes(p.payee),
    value: p.payee,
    reason: "payee is not on the allowlist",
  });
  results.push({
    key: "nonce",
    ok: !state.nonces.has(p.nonce),
    value: p.nonce,
    reason: "nonce already spent",
  });
  const allowed = POLICY.intent[p.payee] || [];
  results.push({
    key: "intent",
    ok: allowed.includes(p.resource),
    value: p.resource,
    reason: "resource is outside the declared intent for this payee",
  });
  results.push({
    key: "budget",
    ok: state.spent + state.locked + p.amount <= POLICY.session + 1e-9,
    value: money(state.spent + state.locked) + " / " + money(POLICY.session),
    reason: "session budget exhausted",
  });
  results.push({
    key: "velocity",
    ok: state.runs < POLICY.maxRuns,
    value: state.runs + " of " + POLICY.maxRuns + " runs",
    reason: "velocity limit reached",
  });
  return results;
}

const ICON_PASS = '<svg class="check__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';
const ICON_FAIL = '<svg class="check__icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

function renderCaseList() {
  const list = $("case-list");
  list.innerHTML = "";
  CASES.forEach((c, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "case";
    btn.dataset.case = c.id;
    btn.innerHTML =
      '<span class="case__index">' + String(i + 1).padStart(2, "0") + "</span>" +
      '<span class="case__name">' + c.name + "</span>" +
      '<span class="case__dot" data-verdict=""></span>';
    btn.addEventListener("click", () => selectCase(c.id));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderProposal(c) {
  const p = c.proposal;
  $("proposal-fields").innerHTML = [
    ["amount", money(p.amount), ""],
    ["payee", p.payee, ""],
    ["resource", p.resource, ""],
    ["nonce", p.nonce, ""],
    ["reason", p.reason, "field--intent"],
  ]
    .map(
      ([k, v, cls]) =>
        '<div class="field ' + cls + '"><dt>' + k + "</dt><dd>" + escapeHtml(v) + "</dd></div>"
    )
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function renderChecks(results) {
  const list = $("checks");
  list.innerHTML = "";
  CHECK_COPY.forEach(([key, label], i) => {
    const r = results[i];
    const li = document.createElement("li");
    li.className = "check";
    li.dataset.check = key;
    li.innerHTML =
      "<span></span>" +
      '<span class="check__name">' + label + "</span>" +
      '<span class="check__value">' + escapeHtml(r.value) + "</span>" +
      '<span class="check__mark"></span>';
    list.appendChild(li);
  });
}

async function resolveChecks(results) {
  const nodes = Array.from(document.querySelectorAll(".check"));
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const r = results[i];
    await wait(i === 0 ? 90 : 130);
    node.classList.add("is-in");
    const mark = node.querySelector(".check__mark");
    mark.innerHTML = r.ok ? ICON_PASS : ICON_FAIL;
    node.classList.add(r.ok ? "is-pass" : "is-fail");
  }
}

function stampVerdict(kind, label, reason) {
  const v = $("verdict");
  v.classList.remove("is-stamped");
  v.dataset.state = kind;
  $("verdict-label").textContent = label;
  $("verdict-reason").textContent = reason || "";
  void v.offsetWidth;
  v.classList.add("is-stamped");
}

function setRail(stage, mode) {
  document.querySelectorAll(".rail li").forEach((li) => li.classList.remove("is-active", "is-done", "is-fail"));
  const order = ["authorise", "lock", "deliver", "verify", "release"];
  const at = order.indexOf(stage);
  document.querySelectorAll(".rail li").forEach((li, i) => {
    if (i < at) li.classList.add("is-done");
    if (i === at) li.classList.add(mode === "fail" ? "is-fail" : "is-active");
  });
}

function clearRail() {
  document.querySelectorAll(".rail li").forEach((li) => li.classList.remove("is-active", "is-done", "is-fail"));
}

function updateLedger() {
  $("stat-spent").textContent = money(state.spent);
  $("stat-refused").textContent = String(state.refused);
  $("stat-locked").textContent = money(state.locked);
  $("stat-bad").textContent = String(state.bad);
  const row = $("stat-bad").closest(".ledger__row");
  row.classList.toggle("is-bad", state.bad > 0);
}

function addLog(c, decision, amount) {
  state.runs += 1;
  const entry = { n: state.entries.length + 1, case: c.name, decision, amount: money(amount), prev: state.prev };
  const h = hashOf(entry);
  entry.hash = h;
  state.prev = h;
  state.entries.push(entry);
  renderLog(entry);
}

function renderLog(entry) {
  const body = $("log-body");
  const empty = body.querySelector(".log__empty");
  if (empty) empty.remove();
  const tr = document.createElement("tr");
  tr.className = "is-new";
  tr.innerHTML =
    "<td>" + String(entry.n).padStart(2, "0") + "</td>" +
    "<td>" + escapeHtml(entry.case) + "</td>" +
    '<td data-verdict="' + entry.decision.toLowerCase() + '">' + entry.decision + "</td>" +
    "<td>" + entry.amount + "</td>" +
    "<td>" + entry.prev.slice(0, 8) + "</td>" +
    "<td>" + entry.hash + "</td>";
  body.prepend(tr);
  while (body.children.length > 12) body.lastElementChild.remove();
}

function markCase(id, verdict) {
  const btn = document.querySelector('.case[data-case="' + id + '"]');
  if (btn) btn.querySelector(".case__dot").dataset.verdict = verdict;
}

async function runCase(c) {
  state.selected = c.id;
  document.querySelectorAll(".case").forEach((b) => b.setAttribute("aria-current", String(b.dataset.case === c.id)));
  $("case-name").textContent = c.name;
  $("case-blurb").textContent = c.blurb;
  renderProposal(c);
  const results = evaluate(c.proposal);
  renderChecks(results);
  stampVerdict("idle", "Evaluating", "");
  $("verdict").dataset.state = "idle";
  $("verdict-label").textContent = "Evaluating";
  clearRail();
  $("escrow-note").textContent = "Nothing locked yet.";

  await resolveChecks(results);

  const firstFail = results.find((r) => !r.ok);
  if (firstFail) {
    state.refused += 1;
    stampVerdict("refuse", "Refused", "Kernel stopped it: " + firstFail.reason + ".");
    $("escrow-note").textContent = "No authorisation was produced, so nothing was locked and nothing moved.";
    addLog(c, "Refused", 0);
    markCase(c.id, "refuse");
    updateLedger();
    return;
  }

  const amount = c.proposal.amount;
  state.locked += amount;
  stampVerdict("approve", "Approved", "Authorisation signed against the mandate. Funds are locked, not spent.");
  $("escrow-note").textContent = "Escrow holds " + money(amount) + " against the offer hash. Nothing is released until delivery is checked.";
  addLog(c, "Authorised", amount);
  markCase(c.id, "approve");
  updateLedger();

  setRail("authorise", "active");
  await wait(220);
  setRail("lock", "active");
  await wait(260);
  setRail("deliver", "active");
  await wait(260);
  setRail("verify", "active");
  await wait(300);

  if (c.delivery.ok) {
    state.locked -= amount;
    state.spent += amount;
    state.released += 1;
    setRail("release", "active");
    stampVerdict("approve", "Released", "Payload hash " + c.delivery.received + " matches the offer. " + money(amount) + " settled.");
    $("escrow-note").textContent = "Settled. The seller holds " + money(amount) + "; the buyer holds a receipt that can be replayed against the audit trail.";
    addLog(c, "Released", amount);
    markCase(c.id, "approve");
  } else {
    state.locked -= amount;
    setRail("verify", "fail");
    stampVerdict("refund", "Refunded", "Payload hash " + c.delivery.received + " does not match " + c.delivery.expected + ". Escrow returned the funds.");
    $("escrow-note").textContent = "The seller was paid nothing. This is the case a receipt alone would have recorded as a success.";
    addLog(c, "Refunded", 0);
    markCase(c.id, "refund");
  }
  updateLedger();
}

async function runAll() {
  if (state.busy) return;
  reset(true);
  state.busy = true;
  const btns = document.querySelectorAll("button");
  btns.forEach((b) => (b.disabled = true));
  for (const c of CASES) {
    await runCase(c);
    await wait(650);
  }
  state.busy = false;
  btns.forEach((b) => (b.disabled = false));
  $("case-name").textContent = "Seven cases, one policy";
  $("case-blurb").textContent =
    "No refusal spent money. No approval released money without a matching payload. The planner never touched a key.";
}

function selectCase(id) {
  if (state.busy) return;
  const c = CASES.find((x) => x.id === id);
  if (c) runCase(c);
}

function renderIdle() {
  $("proposal-fields").innerHTML = [
    ["amount", "—", ""],
    ["payee", "—", ""],
    ["resource", "—", ""],
    ["nonce", "—", ""],
    ["reason", "nothing proposed yet", "field--intent"],
  ]
    .map(([k, v, cls]) => '<div class="field ' + cls + '"><dt>' + k + "</dt><dd>" + escapeHtml(v) + "</dd></div>")
    .join("");
  $("checks").innerHTML = CHECK_COPY.map(
    ([key, label]) =>
      '<li class="check" data-check="' + key + '"><span></span><span class="check__name">' +
      label + '</span><span class="check__value">—</span><span class="check__mark"></span></li>'
  ).join("");
  stampVerdict("idle", "Awaiting a case", "");
  clearRail();
}

function reset(clearLedger = true) {
  state.spent = 0.002;
  state.locked = 0;
  state.refused = 0;
  state.released = 0;
  state.bad = 0;
  state.runs = 0;
  state.nonces = new Set(["n-8842"]);
  state.prev = "genesis";
  state.entries = [];
  state.selected = null;
  if (clearLedger) {
    $("log-body").innerHTML = '<tr class="log__empty"><td colspan="6">No decisions yet.</td></tr>';
    document.querySelectorAll(".case").forEach((b) => {
      b.querySelector(".case__dot").dataset.verdict = "";
      b.setAttribute("aria-current", "false");
    });
    $("case-name").textContent = "Select a case";
    $("case-blurb").textContent = "Seven proposals, one policy. Pick a case to run it.";
    renderIdle();
    $("escrow-note").textContent = "Nothing locked. The rail only moves after the kernel approves.";
  }
  updateLedger();
}

function seed() {
  const entry = { n: 1, case: "Session opened with one settled call", decision: "Released", amount: money(0.002), prev: "genesis" };
  entry.hash = hashOf(entry);
  state.prev = entry.hash;
  state.entries.push(entry);
  renderLog(entry);
}

document.addEventListener("DOMContentLoaded", () => {
  renderCaseList();
  renderIdle();
  seed();
  updateLedger();
  $("run-all").addEventListener("click", runAll);
  $("reset").addEventListener("click", () => reset(true));
});
