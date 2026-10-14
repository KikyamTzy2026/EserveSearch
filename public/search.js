/* Fuzzy title matcher: weighted token coverage + phrase containment + bigram order bonus. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STOP = new Set(['of', 'the', 'a', 'an', 'to', 'for', 'and', 'in', 'on', 'by', 'with', 'as', 'at', 'or', 're', 'is', 'are']);
  const ABBR = {
    msj: 'motion summary judgment', noh: 'notice of hearing', cmc: 'case management conference',
    ado: 'affidavit amounts due owing', aoi: 'affidavit indebtedness', raf: 'reasonable attorney fees',
    cbra: 'certified business record affidavit', mtn: 'motion', def: 'defendant', pl: 'plaintiff',
    atty: 'attorney', aff: 'affidavit', depo: 'deposition', fj: 'final judgment', fc: 'foreclosure',
    bk: 'bankruptcy', bky: 'bankruptcy', gal: 'guardian ad litem', opp: 'opposition', resp: 'response',
  };

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[’']s\b/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function stem(t) {
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  }
  function tokens(s) {
    return norm(s)
      .split(' ')
      .flatMap((t) => (ABBR[t] ? norm(ABBR[t]).split(' ') : [t]))
      .filter((t) => t && !STOP.has(t))
      .map(stem);
  }
  const bigrams = (t) => {
    const s = new Set();
    for (let i = 0; i < t.length - 1; i++) s.add(t[i] + ' ' + t[i + 1]);
    return s;
  };
  const near = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

  function prepare(entries, textOf) {
    entries.forEach((e) => {
      const txt = textOf(e);
      e._n = norm(txt);
      e._t = tokens(txt);
      e._b = bigrams(e._t);
    });
    return entries;
  }

  function buildWeights(entries) {
    const df = new Map();
    entries.forEach((e) => new Set(e._t).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const N = Math.max(entries.length, 1);
    const w = (t) => Math.log(1 + N / (df.get(t) || 0.5));
    return w;
  }

  function makeQuery(text) {
    return { n: norm(text), t: tokens(text), b: null };
  }

  function score(q, e, w) {
    if (!q.t.length || !e._t.length) return 0;
    if (q.n === e._n) return 100;
    let qm = 0, qtot = 0;
    for (const t of q.t) {
      const wt = w(t);
      qtot += wt;
      if (e._t.some((x) => near(x, t))) qm += wt;
    }
    let em = 0, etot = 0;
    for (const t of e._t) {
      const wt = w(t);
      etot += wt;
      if (q.t.some((x) => near(x, t))) em += wt;
    }
    const cq = qtot ? qm / qtot : 0;
    const ce = etot ? em / etot : 0;
    let s = cq + ce ? ((2 * cq * ce) / (cq + ce)) * 92 : 0;
    const pe = ' ' + e._n + ' ', pq = ' ' + q.n + ' ';
    if ((e._n.length >= 6 && pq.includes(pe)) || (q.n.length >= 6 && pe.includes(pq))) {
      const r = Math.min(q.n.length, e._n.length) / Math.max(q.n.length, e._n.length);
      s = Math.max(s, 76 + 18 * r);
    }
    const qb = q.b || (q.b = bigrams(q.t));
    if (qb.size) {
      let h = 0;
      qb.forEach((b) => { if (e._b.has(b)) h++; });
      s += 6 * (h / qb.size);
    }
    return Math.min(99, s);
  }

  function rank(q, entries, w, limit) {
    const out = [];
    for (const e of entries) {
      const s = score(q, e, w);
      if (s >= 35) out.push({ e, s });
    }
    out.sort((a, b) => b.s - a.s || a.e.name?.length - b.e.name?.length);
    return out.slice(0, limit || 8);
  }

  return { norm, tokens, prepare, buildWeights, makeQuery, score, rank };
});
