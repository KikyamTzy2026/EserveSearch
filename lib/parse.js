/* Shared parser: runs in the browser (uploads) and in Node (npm run data:build). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clean = (v) =>
    String(v == null ? '' : v)
      .replace(/\u200b/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();

  /* ---------- Playbook sheets (foreclosure + collections) ---------- */
  function parsePlaybookSheet(rows, sheet) {
    if (!rows || !rows.length) return [];
    let hi = rows.findIndex((r) => r.some((c) => /^doc name$/i.test(clean(c))));
    if (hi < 0) hi = 0;
    const head = rows[hi].map(clean);
    const idx = (re) => head.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);
    const nameI = idx(/^doc name/i)[0] ?? 0;
    const mailI = idx(/^mail recipient/i);
    const emailI = idx(/^electronic mail/i);
    const litI = idx(/^lit process/i);
    const namingI = idx(/naming/i)[0];
    const stepI = idx(/additional/i)[0];
    const out = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = clean(r[nameI]);
      if (!name) continue;
      const pick = (ix) => ix.map((j) => clean(r[j])).filter(Boolean);
      out.push({
        sheet,
        row: i + 1,
        name,
        mail: pick(mailI),
        email: pick(emailI),
        lit: pick(litI),
        naming: namingI >= 0 ? clean(r[namingI]) : '',
        step: stepI >= 0 ? clean(r[stepI]) : '',
      });
    }
    return out;
  }

  /* ---------- Client answers ---------- */
  const STRONG =
    /^\s*(trial team|trial scheduling|trial\b|processing|sales|nos\b|hearings?|dismissals?|original doc|orig\b|orig\.|gen(?:eral)?\.?\s?lit|gl\b|bankruptcy|dil\b|defaults?|judgments?|mediations?|evictions?|aoms?\b|complaints?|service@|depositions?|reinstatement|ciara|johanna|silver|check request|move to|drop|completed)/i;
  const WEAK =
    /^\s*(what|which|clarify|is this|is it|double|if |forward|send|flag|check|you |this |it |these|each|also|please|not our|dropped|the |kind of|i |a |for |there|they|sent|when|yes|anything|just|move)/i;

  function candidates(text) {
    const out = [];
    const re = /\s*[-–—→]+\s*/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index === 0) continue;
      out.push({ at: m.index, len: m[0].length, suffix: text.slice(m.index + m[0].length) });
    }
    return out;
  }

  const TEAM_PATTERNS = [
    ['Trial Team', /\btrial team\b|\btrial\b(?!\s*scheduling)/i],
    ['Trial Scheduling', /trial scheduling/i],
    ['Processing', /processing/i],
    ['Sales', /\bsales\b/i],
    ['NOS', /\bnos\b/i],
    ['Hearings', /hearings?/i],
    ['Dismissals', /dismissals?/i],
    ['Original Docs', /original doc|orig\. docs|\borig\b|original documents/i],
    ['General Litigation', /gen(?:eral)?\.? ?lit|\bgl\b/i],
    ['Bankruptcy', /bankruptcy/i],
    ['DIL', /\bdil\b/i],
    ['Defaults', /\bdefaults?\b/i],
    ['Judgments', /\bjudgments?\b/i],
    ['Mediations', /mediations?/i],
    ['Evictions', /evictions?/i],
    ['AOM', /\baoms?\b/i],
    ['Complaints', /complaints/i],
    ['Service', /service@/i],
    ['Depositions', /depositions?/i],
    ['Reinstatement/Payoff', /reinstatement|payoff/i],
    ['Ciara / Urgent Filings', /ciara|urgent filing/i],
    ['Check Request', /check request/i],
    ['Johanna Harrington', /johanna/i],
  ];

  function classify(route) {
    const r = route.toLowerCase();
    let action = 'route';
    if (/(move|moved|ove)\s*(it |this )?(to )?(the )?(completed|file)|completed folder|not our case|we do not (deal|handle)|move completed/.test(r)) action = 'completed';
    else if (/drop(ped)? (it )?(in)?to the file|drop into the file|does(n.?t| not) need to be (sent|processed)|do not need to send|need to be sent anywhere|nothing (else )?(needs|more)|will not process|not need to be sent/.test(r)) action = 'drop';
    else if (/clarify|what (is|type|kind)|which (order|one)|forward (this )?to me|send (it |this )?to me|flag this|not sure|confirm|review/.test(r)) action = 'clarify';
    const teams = TEAM_PATTERNS.filter(([, re]) => re.test(route)).map(([n]) => n);
    return {
      action,
      teams: action === 'route' || action === 'clarify' ? teams : [],
      lit: /lit process/i.test(route),
      conditional: /\bif\b|double check|unless|depend/i.test(route),
    };
  }

  function parseClientLine(textRaw) {
    const text = clean(textRaw).replace(/^[-•·\s]+/, '').trim();
    if (!text) return null;
    const cands = candidates(text);
    let pick = null;
    const strong = cands.filter((c) => STRONG.test(c.suffix));
    if (strong.length) pick = strong[strong.length - 1];
    else {
      const weak = cands.filter((c) => WEAK.test(c.suffix));
      if (weak.length) pick = weak[0];
    }
    if (!pick) {
      const loose = cands.filter((c) => TEAM_PATTERNS.some(([, re]) => re.test(c.suffix.slice(0, 60))));
      if (loose.length) pick = loose[0];
    }
    if (!pick || pick.at < 4) {
      return { raw: text, title: text, route: '', parsed: false, ...classify(text), note: true };
    }
    const title = text.slice(0, pick.at).trim();
    const route = text.slice(pick.at + pick.len).trim();
    return { raw: text, title, route, parsed: true, ...classify(route) };
  }

  function parseClientSheet(rows) {
    const out = [];
    const seen = new Set();
    (rows || []).forEach((r, i) => {
      const text = (r || []).map(clean).filter(Boolean).join(' ');
      if (!text) return;
      const e = parseClientLine(text);
      if (!e || e.raw.length < 3) return;
      const key = e.raw.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      e.row = i + 1;
      out.push(e);
    });
    return out;
  }

  /* ---------- Notes sheet ---------- */
  const HEAD = /^(FILIING PARTY|COURT|PLAINTIFF|DEFENDANT|FOR PUBLICATIONS.*|Proof Of Publication|Notice Of Action Publication|Affiavit of Publictaion|Order Resetting.*)$/i;
  function parseNotesSheet(rows) {
    const lines = [];
    (rows || []).forEach((r) => (r || []).forEach((c) => { const t = clean(c); if (t) lines.push(t); }));
    const groups = [];
    let cur = null;
    for (const l of lines) {
      const isHead = (/^-\s*\S/.test(l) && l.length < 90) || HEAD.test(l);
      if (isHead) {
        cur = { title: l.replace(/^-\s*/, ''), lines: [] };
        groups.push(cur);
      } else if (cur) cur.lines.push(l);
      else { cur = { title: 'Notes', lines: [l] }; groups.push(cur); }
    }
    return groups;
  }

  /* ---------- Whole workbook ---------- */
  function parseWorkbook(sheets) {
    const data = { foreclosure: [], legacy: [], collections: [], client: [], notes: [], meta: {} };
    const dated = sheets.find((s) => /^\d+\.\d+\.\d+$/.test(s.name.trim()));
    const main = dated || sheets[0];
    for (const s of sheets) {
      const n = s.name.toLowerCase();
      if (s === main) { data.foreclosure = parsePlaybookSheet(s.rows, 'Foreclosure ' + s.name); data.meta.main = s.name; }
      else if (/^foreclosure/.test(n)) { data.legacy = parsePlaybookSheet(s.rows, 'Foreclosure (older) ' + s.name); data.meta.legacy = s.name; }
      else if (/collection/.test(n)) data.collections = parsePlaybookSheet(s.rows, 'Collections');
      else if (/answer|quer/.test(n)) data.client = parseClientSheet(s.rows);
      else if (/note/.test(n)) data.notes = parseNotesSheet(s.rows);
    }
    return data;
  }

  return { clean, parsePlaybookSheet, parseClientLine, parseClientSheet, parseNotesSheet, parseWorkbook, classify };
});
