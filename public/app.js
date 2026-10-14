/* Doc Name Finder – browser app. No framework, no build step. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const S = window.PBSearch;
  const P = window.PBParse;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const state = Object.assign(
    { q: '', scope: 'foreclosure', legacy: false, bk: false, appeal: false, date: '', file: '', sep: ' - ', sel: null },
    store.get('pb.settings', {})
  );
  state.q = ''; state.bk = false; state.appeal = false; state.sel = null;

  let DB = null;          // active dataset
  let builtin = null;     // data shipped with the site
  let wPB = null, wCL = null;
  let uploaded = false;

  /* ---------- small DOM helper ---------- */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  }

  /* ---------- static knowledge from the client's answers ---------- */
  const RULES = [
    ['Bankruptcy in the case header', 'If the case header at the top of the document says Bankruptcy, the document goes to the Bankruptcy inbox, whatever its title.'],
    ['Appeal in the header', 'Anything that has an Appeal header, or deals with an appeal, goes to General Litigation.'],
    ['Drop into the file only', 'Certificates of Service, Disclaimers, Requests for Judicial Notice, Certificates of Settlement Authority, Certificates of Compliance and similar documents are not sent to anyone. Drop a copy into the Perfect Practice file.'],
    ['Move to completed', 'Family law, guardianship and similar cases, returned mail scans, and anything that is not our case goes to the completed folder.'],
    ['Original documents', 'Orders about returning, releasing or disposing of original notes, mortgages or exhibits go to Original Docs.'],
    ['Payoff requests', 'Anything where someone requests a payoff goes to Reinstatement/Payoff.'],
    ['Court fee requests', 'When the court or clerk requests fees, send to Ciara and Urgent Filings. Recording fees go to the client contact.'],
    ['Virgin Islands', 'Anything about the Virgin Islands courts goes to Johanna Harrington, the attorney for those matters.'],
    ['Conditional titles', 'Some titles depend on the header: Trustee\'s Recommendation Concerning Claims, Notice of Amount Deemed Necessary to Cure Mortgage Arrears, Order Confirming Plan, Motion to Modify Confirmed Plan and Application for Interim Attorney Fees. Check for Bankruptcy at the top first.'],
    ['Titles that are too vague', 'Letter, Memorandum, Emergency Motion, Motion, Bond, Affidavit in Support, General Order and Notice of Service need more detail (what the motion is for, what kind of letter) before they can be routed. Flag them to your lead.'],
    ['Lit Process', 'Some documents also need a Lit Process dropped. The playbook row lists it. When the client\'s answer says one is needed, it is flagged on the result.'],
  ];

  /* ---------- team detection for conflicts ---------- */
  const PB_TEAMS = [
    ['Trial Team', /trialteam@|trial mail|attorney support|trial@|fl-attorneysupport/i],
    ['Processing', /processing@|admin ops|servealaw@|eserve/i],
    ['Sales', /sales@|sales mail/i],
    ['Hearings', /hearings@|hearings mail/i],
    ['Trial Scheduling', /trialscheduling@/i],
    ['Defaults', /defaults@|defaults\/drops/i],
    ['Judgments', /judgments@|judgments mail/i],
    ['Bankruptcy', /bkfl@|bankruptcy@|bankruptcy mail/i],
    ['Mediations', /mediation@/i],
    ['Evictions', /evictions@|evictions mail/i],
    ['AOM', /aoms@|aom mail/i],
    ['DIL', /dil@|title mail/i],
    ['Depositions', /depositions@/i],
    ['Service', /\bservice@|service mail/i],
    ['General Litigation', /genlit@|gen lit/i],
    ['Ciara / Urgent Filings', /urgentfilings@|ciara|urgent filings/i],
    ['Check Request', /checkreq@|accounting/i],
    ['Dismissals', /dismissals@/i],
  ];
  const pbTeams = (e) => {
    const txt = e.mail.concat(e.email).join(' ');
    return PB_TEAMS.filter(([, re]) => re.test(txt)).map(([n]) => n);
  };

  /* ---------- data loading ---------- */
  async function load() {
    const res = await fetch('data/playbook.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load data/playbook.json');
    builtin = await res.json();
    const up = store.get('pb.upload', null);
    uploaded = !!(up && up.foreclosure && up.foreclosure.length);
    setData(uploaded ? up : builtin);
  }

  function setData(d) {
    const mine = store.get('pb.mine', []).map((m) => Object.assign({}, m, { mine: true }));
    DB = {
      meta: d.meta || {},
      foreclosure: d.foreclosure || [],
      legacy: d.legacy || [],
      collections: d.collections || [],
      notes: d.notes || [],
      client: (d.client || []).concat(mine),
    };
    const nameOf = (e) => e.name;
    S.prepare(DB.foreclosure, nameOf); S.prepare(DB.legacy, nameOf); S.prepare(DB.collections, nameOf);
    S.prepare(DB.client, (e) => e.title);
    wPB = S.buildWeights(DB.foreclosure.concat(DB.collections));
    wCL = S.buildWeights(DB.client);
    DB.notes.forEach((g) => {
      const txt = g.title + ' ' + g.lines.join(' ');
      g._t = S.tokens(txt); g._tt = S.tokens(g.title);
    });
    $('#status').textContent =
      `Playbook ${DB.meta.main || ''} · ${DB.foreclosure.length} foreclosure · ${DB.collections.length} collections · ${DB.client.length} client answers` +
      (uploaded ? ' · your upload' : '');
    renderRules(); renderNotes(); renderRecords();
    render();
  }

  /* ---------- search ---------- */
  const pool = () => {
    const a = [];
    if (state.scope !== 'collections') { a.push(...DB.foreclosure); if (state.legacy) a.push(...DB.legacy); }
    if (state.scope !== 'foreclosure') a.push(...DB.collections);
    return a;
  };

  const conf = (s) => (s >= 90 ? { cls: 'strong', label: 'Strong match' } : s >= 80 ? { cls: 'good', label: 'Good match' } : { cls: 'review', label: 'Needs review' });

  function notesHint(q) {
    let best = null;
    for (const g of DB.notes) {
      if (!g._t.length || g.lines.length === 0) continue;
      const inTitle = q.t.filter((t) => g._tt.includes(t)).length;
      const inAll = q.t.filter((t) => g._t.includes(t)).length;
      const sc = inTitle * 2 + inAll;
      if (inTitle >= 2 && sc >= 4 && (!best || sc > best.sc)) best = { g, sc };
    }
    return best && best.g;
  }

  /* ---------- rendering ---------- */
  function copyBtn(text, label) {
    const b = el('button', { class: 'copy', type: 'button', 'aria-label': label || 'Copy' }, 'Copy');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const t = el('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
      }
      b.textContent = 'Copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1400);
    });
    return b;
  }

  function filenameBlock(e) {
    if (!e.naming) return el('p', { class: 'nonaming' }, 'The playbook lists no naming convention for this document. Ask your lead before saving it.');
    const parts = e.naming.split('/').map((s) => s.trim());
    if (parts.length < 3) return el('div', { class: 'fname' }, el('span', { class: 'lbl' }, 'Naming convention'), el('code', { text: e.naming }));
    const nameTxt = parts.slice(2).join('/');
    const date = state.date.trim(), file = state.file.trim();
    const sep = state.sep;
    const segs = [date || null, file || null, nameTxt];
    const plain = [date || '[date]', file || '[file number]', nameTxt].join(sep);
    const code = el('code', { class: 'fn' });
    const labels = ['[date]', '[file number]'];
    segs.forEach((v, i) => {
      if (i) code.append(sep === ' ' ? ' ' : sep.replace(/ /g, '\u00a0'));
      if (v) code.append(v);
      else code.append(el('mark', { text: labels[i] }));
    });
    return el('div', { class: 'fname' },
      el('span', { class: 'lbl' }, 'File name'),
      code,
      copyBtn(plain, 'Copy file name'),
      el('p', { class: 'hint' }, 'Playbook format: ' + e.naming));
  }

  const NONE = /^(none|n\/a|na|-)$/i;

  function routeBlock(e, overridden) {
    const mail = e.mail, email = e.email, lit = e.lit.filter((x) => !NONE.test(x));
    const row = (k, v) => el('div', { class: 'r' }, el('dt', { text: k }), el('dd', null, v));
    const chips = (arr, mono) => arr.length
      ? el('span', { class: 'chips' }, arr.map((x) => el('span', { class: 'chip' + (mono ? ' mono' : '') + (x.startsWith('*') ? ' note' : '') }, x, mono ? copyBtn(x, 'Copy ' + x) : null)))
      : el('span', { class: 'none' }, 'Not listed');
    return el('dl', { class: 'route' + (overridden ? ' overridden' : '') },
      row('Mail to', chips(mail)),
      row('Email to', chips(email, true)),
      row('Lit Process', lit.length ? chips(lit) : el('span', { class: 'none' }, 'None listed')),
      e.step ? row('Additional step', el('p', { class: 'step', text: e.step })) : null);
  }

  function slip(r, overridden) {
    const e = r.e, c = conf(r.s);
    return el('article', { class: 'slip ' + c.cls },
      el('div', { class: 'slip-h' },
        el('span', { class: 'sheetname', text: e.sheet }),
        el('span', { class: 'pill ' + c.cls, text: `${Math.floor(r.s)}% · ${c.label}` })),
      el('h2', { text: e.name }),
      filenameBlock(e),
      routeBlock(e, overridden));
  }

  const ACTIONS = {
    route: 'Send to',
    drop: 'Drop into the Perfect Practice file. Do not send.',
    completed: 'Move to completed',
    clarify: 'Flag or clarify before sending',
  };

  function clientCard(r) {
    const e = r.e;
    const c = conf(r.s);
    return el('article', { class: 'cl ' + e.action },
      el('div', { class: 'cl-h' },
        el('span', { class: 'sheetname' }, e.mine ? 'My record' : "Client's answer"),
        el('span', { class: 'pill ' + c.cls, text: `${Math.floor(r.s)}% match` })),
      el('p', { class: 'cl-t', text: e.title }),
      e.parsed || e.mine
        ? el('p', { class: 'cl-a' }, el('span', { class: 'act ' + e.action, text: ACTIONS[e.action] }))
        : el('p', { class: 'cl-a' }, el('span', { class: 'act clarify', text: 'Instruction, read below' })),
      e.teams && e.teams.length ? el('span', { class: 'chips' }, e.teams.map((t) => el('span', { class: 'chip', text: t }))) : null,
      e.route && (e.route.length > 24 || !(e.teams && e.teams.length) || e.action !== 'route') ? el('p', { class: 'cl-r', text: e.route }) : (!e.parsed ? el('p', { class: 'cl-r', text: e.raw }) : null),
      el('p', { class: 'flags' },
        e.lit ? el('span', { class: 'tag', text: 'Lit Process needed' }) : null,
        e.conditional ? el('span', { class: 'tag', text: 'Depends on the document. Read the full answer.' }) : null),
      e.naming ? el('p', { class: 'hint', text: 'Naming: ' + e.naming }) : null);
  }

  function conflict(pb, cl) {
    if (!pb || !cl || pb.s < 90 || cl.s < 95) return null;
    const e = cl.e, mine = pbTeams(pb.e);
    if (!mine.length) return null;
    if (e.action === 'drop' || e.action === 'completed') return `The playbook lists a recipient, but the client's answer says this one is not sent anywhere (${ACTIONS[e.action].toLowerCase()}).`;
    if (e.action === 'route' && e.teams.length) {
      const norm = (n) => (n === 'Trial Scheduling' ? 'Trial Team' : n);
      const a = new Set(mine.map(norm)), b = new Set(e.teams.map(norm));
      if (![...a].some((t) => b.has(t))) return `The playbook routes this to ${mine.join(', ')}, but the client's answer says ${e.teams.join(', ')}.`;
    }
    return null;
  }

  function banner(kind, title, body, action) {
    return el('div', { class: 'banner ' + kind, role: 'note' },
      el('div', null, el('strong', { text: title }), body ? el('span', { text: ' ' + body }) : null),
      action || null);
  }

  function render() {
    const box = $('#results');
    box.replaceChildren();
    if (!DB) return;
    if (!state.q) {
      box.append(el('div', { class: 'empty' },
        el('p', null, el('strong', { text: 'Start with the document title.' }), " The finder checks the playbook first, then the client's answered queries, then the notes sheet."),
        el('p', { class: 'muted', text: 'Matches under 80% are marked for manual review. Nothing is guessed.' })));
      return;
    }
    const q = S.makeQuery(state.q);
    const pb = S.rank(q, pool(), wPB, 9);
    const cl = S.rank(q, DB.client.filter((e) => e.title.length > 3), wCL, 4).filter((r) => r.s >= 60);
    const top = pb.find((r) => r.e === state.sel) || pb[0];

    // flags
    if (state.bk) box.append(banner('alert', 'Bankruptcy header.', 'This goes to the Bankruptcy inbox (BKFL@alaw.net) whatever the title says. Use the file name below.'));
    if (state.appeal) box.append(banner('alert', 'Appeal header.', 'This goes to General Litigation (genlit@alaw.net) whatever the title says. Use the file name below.'));
    const bkHint = /bankrupt|chapter\s*(7|11|12|13)|trustee|debtor|341|discharge/i.test(state.q) && !state.bk;
    const apHint = /appell|appeal|certiorari|prohibition|record on appeal/i.test(state.q) && !state.appeal;
    if (bkHint) box.append(banner('hint', 'Check the case header.', 'If it says Bankruptcy, this goes to the Bankruptcy inbox.', el('button', { class: 'btn small', type: 'button', onclick: () => { $('#bk').checked = true; state.bk = true; render(); } }, 'Header says Bankruptcy')));
    if (apHint) box.append(banner('hint', 'Check the header.', 'If it says Appeal, this goes to General Litigation.', el('button', { class: 'btn small', type: 'button', onclick: () => { $('#appeal').checked = true; state.appeal = true; render(); } }, 'Header says Appeal')));

    const clBest = cl[0];
    if ((!top || top.s < 80) && (!clBest || clBest.s < 80)) {
      const g = 'https://www.google.com/search?q=' + encodeURIComponent('"' + state.q + '" Florida court document type');
      box.append(banner('review', 'No confident match.', 'Do not guess. Send this one for manual review, or check what the document is first.',
        el('a', { class: 'btn small', href: g, target: '_blank', rel: 'noopener' }, 'Search the title online')));
    }

    const overridden = state.bk || state.appeal;
    const vague = clBest && clBest.s >= 95 && clBest.e.action === 'clarify';
    if (vague) box.append(banner('review', 'This title needs more detail.', clBest.e.route || 'Flag it to your lead before sending.'));

    const showSlip = top && top.s >= 60 && !(vague && top.s < 90);
    const clientFirst = clBest && clBest.s >= 90 && (!top || top.s < 80);
    const clientBlock = () => {
      if (!cl.length) return;
      box.append(el('h3', { class: 'sect', text: "Client's answers for similar titles" }));
      box.append(el('div', { class: 'cl-list' }, cl.slice(0, 3).map(clientCard)));
    };

    if (clientFirst) clientBlock();
    if (showSlip) {
      if (clientFirst) box.append(el('h3', { class: 'sect', text: 'Closest playbook row' }));
      box.append(slip(top, overridden));
    } else if (!clientFirst && !vague) {
      box.append(el('p', { class: 'muted', text: 'No playbook row is close to that title.' }));
    }

    const cf = showSlip ? conflict(top, clBest) : null;
    if (cf) box.append(banner('conflict', 'Playbook and client answer differ.', cf + " The client's answer is the more specific instruction, so follow it unless your lead says otherwise."));

    if (!clientFirst) clientBlock();

    const ng = notesHint(q);
    if (ng) {
      box.append(el('h3', { class: 'sect', text: 'From the notes sheet' }));
      box.append(el('article', { class: 'cl note' },
        el('p', { class: 'cl-t', text: ng.title }),
        el('ul', null, ng.lines.slice(0, 12).map((l) => el('li', { text: l.replace(/^[✅👉📊🗓️\s]+/u, '') })))));
    }

    const others = pb.filter((r) => r !== top && r.s >= 50).slice(0, 6);
    if (others.length) {
      box.append(el('h3', { class: 'sect', text: 'Other playbook matches' }));
      box.append(el('ul', { class: 'others' }, others.map((r) =>
        el('li', null,
          el('button', { type: 'button', class: 'other', onclick: () => { state.sel = r.e; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
            el('span', { class: 'o-n', text: r.e.name }),
            el('span', { class: 'o-m', text: r.e.sheet.replace('Foreclosure ', 'FC ') + ' · ' + Math.floor(r.s) + '%' }))))));
    }
  }

  function renderRules() {
    const box = $('#rules');
    box.replaceChildren(el('dl', { class: 'rules' }, RULES.map(([t, b]) => el('div', { class: 'rule' }, el('dt', { text: t }), el('dd', { text: b })))));
  }

  function renderNotes() {
    const box = $('#notes');
    box.replaceChildren();
    if (!DB.notes.length) { box.append(el('p', { class: 'muted', text: 'No notes in this playbook.' })); return; }
    DB.notes.forEach((g, i) => {
      box.append(el('details', { class: 'nt', open: i < 2 },
        el('summary', { text: g.title }),
        g.lines.length ? el('ul', null, g.lines.map((l) => el('li', { text: l }))) : el('p', { class: 'muted', text: 'This section was a screenshot in the original sheet.' })));
    });
  }

  /* ---------- my data ---------- */
  function renderRecords() {
    const mine = store.get('pb.mine', []);
    const box = $('#rec-list');
    box.replaceChildren();
    if (!mine.length) { box.append(el('p', { class: 'muted', text: 'No records added yet.' })); return; }
    box.append(el('ul', { class: 'mine' }, mine.map((m, i) =>
      el('li', null,
        el('span', null, el('strong', { text: m.title }), ' → ' + (m.route || '(no routing)')),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => { const a = store.get('pb.mine', []); a.splice(i, 1); store.set('pb.mine', a); setData(uploaded ? store.get('pb.upload', builtin) : builtin); } }, 'Remove')))));
  }

  function parseRecords(text) {
    const out = [];
    text.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t) return;
      if (t.includes('|')) {
        const [title, route, naming] = t.split('|').map((s) => s.trim());
        if (!title) return;
        out.push(Object.assign({ raw: t, title, route: route || '', parsed: true, naming: naming || '' }, P.classify(route || '')));
      } else {
        const e = P.parseClientLine(t);
        if (e) out.push(e);
      }
    });
    return out;
  }

  function addRecords(text) {
    const recs = parseRecords(text);
    const msg = $('#rec-msg');
    if (!recs.length) { msg.textContent = 'No records found. Write one per line, like: Title | trial team'; msg.className = 'msg bad'; return; }
    const all = store.get('pb.mine', []).concat(recs);
    if (!store.set('pb.mine', all)) { msg.textContent = 'This browser would not save the records (storage is full or blocked).'; msg.className = 'msg bad'; return; }
    msg.textContent = `Added ${recs.length} record${recs.length === 1 ? '' : 's'}. They now appear in search results.`; msg.className = 'msg ok';
    $('#rec').value = '';
    setData(uploaded ? store.get('pb.upload', builtin) : builtin);
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.XLSX) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the spreadsheet reader. Check your connection.'));
      document.head.append(s);
    });
  }

  async function handleXls(file) {
    const msg = $('#xls-msg');
    msg.className = 'msg'; msg.textContent = 'Reading ' + file.name + '…';
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheets = wb.SheetNames.map((name) => ({ name, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true }) }));
      const d = P.parseWorkbook(sheets);
      if (!d.foreclosure.length) throw new Error('No foreclosure rows found. The first sheet needs a "Doc Name" header row.');
      d.meta.source = file.name;
      if (!store.set('pb.upload', d)) throw new Error('This browser would not save the playbook (storage is full or blocked).');
      uploaded = true;
      setData(d);
      msg.className = 'msg ok';
      msg.textContent = `Loaded ${d.foreclosure.length} foreclosure, ${d.collections.length} collections and ${d.client.length} client answers from ${file.name}.`;
    } catch (err) {
      msg.className = 'msg bad'; msg.textContent = err.message;
    }
  }

  /* ---------- wiring ---------- */
  function showTab(name) {
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (name === 'finder') $('#q').focus();
  }

  function wire() {
    $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    let t;
    $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); state.sel = null; render(); }, 110); });
    $$('input[name=scope]').forEach((r) => { r.checked = r.value === state.scope; r.addEventListener('change', () => { state.scope = r.value; state.sel = null; store.set('pb.settings', { scope: state.scope, legacy: state.legacy, sep: state.sep }); render(); }); });
    $('#legacy').checked = state.legacy;
    $('#legacy').addEventListener('change', (e) => { state.legacy = e.target.checked; state.sel = null; store.set('pb.settings', { scope: state.scope, legacy: state.legacy, sep: state.sep }); render(); });
    $('#bk').addEventListener('change', (e) => { state.bk = e.target.checked; render(); });
    $('#appeal').addEventListener('change', (e) => { state.appeal = e.target.checked; render(); });
    $('#date').addEventListener('input', (e) => { state.date = e.target.value; render(); });
    $('#file').addEventListener('input', (e) => { state.file = e.target.value; render(); });
    $('#sep').value = state.sep;
    $('#sep').addEventListener('change', (e) => { state.sep = e.target.value; store.set('pb.settings', { scope: state.scope, legacy: state.legacy, sep: state.sep }); render(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); showTab('finder'); $('#q').focus(); }
    });
    $('#xls').addEventListener('change', (e) => { if (e.target.files[0]) handleXls(e.target.files[0]); e.target.value = ''; });
    $('#reset-pb').addEventListener('click', () => { store.del('pb.upload'); uploaded = false; setData(builtin); $('#xls-msg').className = 'msg ok'; $('#xls-msg').textContent = 'Back to the built-in playbook.'; });
    $('#rec-add').addEventListener('click', () => addRecords($('#rec').value));
    $('#rec-file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) addRecords(await f.text()); e.target.value = ''; });
    $('#rec-clear').addEventListener('click', () => { store.del('pb.mine'); setData(uploaded ? store.get('pb.upload', builtin) : builtin); $('#rec-msg').className = 'msg ok'; $('#rec-msg').textContent = 'All your records were removed.'; });
  }

  wire();
  load().catch((err) => {
    $('#status').textContent = 'Playbook failed to load';
    $('#results').replaceChildren(banner('review', 'The playbook data did not load.', err.message + ' If you opened index.html directly from a folder, serve it instead (for example with "npm run dev") or deploy it to Vercel.'));
  });
})();
