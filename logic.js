/* Tahará — motor de cálculo (calendario hebreo, hefsek, shivá nekiím, onot perishá).
   Todas las fechas se manejan como 'YYYY-MM-DD' (fecha gregoriana local).
   "Día hebreo" (hd) = la fecha gregoriana cuyo DÍA (de amanecer a shkiá) corresponde a esa fecha hebrea.
   Una oná de NOCHE de un día hebreo hd cae en la noche gregoriana anterior (hd-1, desde la shkiá). */
(function (G) {
  'use strict';

  // ---------- Fechas ----------
  const pad = n => String(n).padStart(2, '0');
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function add(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function diff(a, b) { return Math.round((parse(a) - parse(b)) / 864e5); } // a - b en días
  function today() { return iso(new Date()); }

  // ---------- Calendario hebreo ----------
  const MONTHS = {
    'Tishri': 'Tishrei', 'Heshvan': 'Jeshván', 'Kislev': 'Kislev', 'Tevet': 'Tevet',
    'Shevat': 'Shvat', 'Adar': 'Adar', 'Adar I': 'Adar I', 'Adar II': 'Adar II',
    'Nisan': 'Nisán', 'Iyar': 'Iyar', 'Sivan': 'Siván', 'Tamuz': 'Tamuz', 'Av': 'Av', 'Elul': 'Elul'
  };
  const MONTHS_HE = {
    'Tishri': 'תשרי', 'Heshvan': 'חשון', 'Kislev': 'כסלו', 'Tevet': 'טבת', 'Shevat': 'שבט',
    'Adar': 'אדר', 'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳', 'Nisan': 'ניסן', 'Iyar': 'אייר',
    'Sivan': 'סיון', 'Tamuz': 'תמוז', 'Av': 'אב', 'Elul': 'אלול'
  };
  let fmt;
  const cache = new Map();
  function heb(s) {
    if (cache.has(s)) return cache.get(s);
    if (!fmt) fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });
    const p = fmt.formatToParts(parse(s));
    const get = t => (p.find(x => x.type === t) || {}).value;
    const key = get('month');
    const r = { day: +get('day'), key, month: MONTHS[key] || key, monthHe: MONTHS_HE[key] || key, year: +get('year') };
    cache.set(s, r);
    return r;
  }
  function gematria(n) {
    if (n === 15) return 'ט״ו';
    if (n === 16) return 'ט״ז';
    const tens = ['', 'י', 'כ', 'ל'], ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const t = tens[Math.floor(n / 10)] + ones[n % 10];
    return t.length > 1 ? t.slice(0, -1) + '״' + t.slice(-1) : t + '׳';
  }
  function hebLabel(s) { const h = heb(s); return h.day + ' de ' + h.month + ' ' + h.year; }

  // ---------- Shkiá (puesta del sol, algoritmo tipo SunCalc) ----------
  function sunset(s, lat, lng) {
    const rad = Math.PI / 180, J0 = 0.0009, e = rad * 23.4397;
    const d = parse(s).valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
    const lw = rad * -lng, phi = rad * lat;
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const h = -0.833 * rad;
    const w = Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    if (isNaN(w)) return null;
    const a = J0 + (w + lw) / (2 * Math.PI) + n;
    const J = 2451545 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return new Date((J + 0.5 - 2440588) * 864e5);
  }

  // ---------- Ajustes por defecto (a definir con el rav) ----------
  const DEFAULTS = {
    minDays: 5,          // días mínimos hasta el hefsek (contando el día del inicio)
    morning: '07:00',    // alarma de bedika de la mañana
    beforeShkia: 15,     // minutos antes de la shkiá para la bedika de la tarde
    day31: false,        // agregar el día 31 a la oná beinonit
    orZarua: false,      // cuidar también la oná anterior (or zarúa)
    lat: -34.6037, lng: -58.3816, city: 'Buenos Aires'
  };

  // Día hebreo del inicio: si empezó de noche (después de la shkiá) ya es el día hebreo siguiente.
  const startHd = c => c.onah === 'night' ? add(c.onset, 1) : c.onset;

  // ---------- Onot perishá ----------
  function sameHebDayNextMonth(hd) {
    const h = heb(hd);
    for (let i = 25; i <= 32; i++) {
      const s = add(hd, i), x = heb(s);
      if (x.key !== h.key && x.day === h.day) return { hd: s };
    }
    return { hd: null, missing: true }; // el mes siguiente no tiene ese día (p. ej. 30)
  }
  const prevOnah = o => o.onah === 'day' ? { hd: o.hd, onah: 'night' } : { hd: add(o.hd, -1), onah: 'day' };

  // cycles ordenados por fecha ascendente
  function onot(cycles, st) {
    st = Object.assign({}, DEFAULTS, st);
    if (!cycles.length) return [];
    const c = cycles[cycles.length - 1], hd = startHd(c), out = [];
    out.push({ kind: 'beinonit', label: 'Oná beinonit (día 30)', hd: add(hd, 29), onah: c.onah });
    if (st.day31) out.push({ kind: 'beinonit31', label: 'Día 31', hd: add(hd, 30), onah: c.onah });
    const ch = sameHebDayNextMonth(hd);
    if (ch.hd) out.push({ kind: 'jodesh', label: 'Veset hajódesh', hd: ch.hd, onah: c.onah });
    else out.push({ kind: 'jodesh', label: 'Veset hajódesh', hd: null, onah: c.onah, note: 'El mes siguiente no tiene día ' + heb(hd).day + '. Consultá con el rav.' });
    if (cycles.length > 1) {
      const p = cycles[cycles.length - 2], gap = diff(hd, startHd(p));
      out.push({ kind: 'haflaga', label: 'Veset haflagá (' + (gap + 1) + ' días)', hd: add(hd, gap), onah: c.onah, interval: gap + 1 });
    } else {
      out.push({ kind: 'haflaga', label: 'Veset haflagá', hd: null, note: 'Se calcula cuando cargues el segundo período.' });
    }
    if (st.orZarua) {
      out.filter(o => o.hd && o.kind !== 'beinonit31').forEach(o => {
        const z = prevOnah(o);
        out.push({ kind: 'zarua', label: 'Or zarúa · ' + o.label, hd: z.hd, onah: z.onah });
      });
    }
    // Rango gregoriano real de cada oná
    out.forEach(o => {
      if (!o.hd) return;
      o.gDate = o.onah === 'night' ? add(o.hd, -1) : o.hd; // fecha en que empieza (noche = desde la shkiá del día anterior)
    });
    return out.sort((a, b) => (a.hd || '9') < (b.hd || '9') ? -1 : 1);
  }

  // ---------- Estado de un ciclo ----------
  function cycleInfo(c, st) {
    st = Object.assign({}, DEFAULTS, st);
    const hd = startHd(c);
    const info = { hd, earliestHefsek: add(hd, st.minDays - 1) };
    if (c.hefsek) {
      info.clean = Array.from({ length: 7 }, (_, i) => add(c.hefsek, i + 1));
      info.mikve = c.mikve || add(c.hefsek, 7); // noche al terminar el 7º día
    }
    return info;
  }

  function status(cycles, st, t) {
    t = t || today();
    if (!cycles.length) return { phase: 'empty' };
    const c = cycles[cycles.length - 1], ci = cycleInfo(c, st);
    if (!c.hefsek) {
      const n = diff(t, ci.hd) + 1;
      return { phase: 'nida', day: Math.max(n, 1), cycle: c, info: ci, canHefsek: diff(t, ci.earliestHefsek) >= 0 };
    }
    if (!c.mikveDone) {
      const k = diff(t, c.hefsek);
      if (k <= 0) return { phase: 'hefsek', cycle: c, info: ci };
      if (k < 7) return { phase: 'shiva', day: k, cycle: c, info: ci };
      if (k === 7) return { phase: 'shiva', day: 7, tonight: true, cycle: c, info: ci };
      return { phase: 'mikvePending', cycle: c, info: ci };
    }
    return { phase: 'tehora', cycle: c, info: ci };
  }

  // Marcas por día para el calendario: { 'YYYY-MM-DD': {nida, clean:n, mikve, onot:[...]} }
  function marks(cycles, st, t) {
    t = t || today();
    const m = {}, at = s => (m[s] = m[s] || { onot: [] });
    cycles.forEach((c, idx) => {
      const ci = cycleInfo(c, st), last = idx === cycles.length - 1;
      const end = c.hefsek || (last ? (diff(t, ci.earliestHefsek) > 0 ? t : ci.earliestHefsek) : add(ci.hd, 6));
      for (let s = c.onset; diff(end, s) >= 0; s = add(s, 1)) {
        at(s).nida = true;
        if (!c.hefsek && diff(s, t) > 0) at(s).projected = true;
      }
      if (c.onah === 'night') at(c.onset).startNight = true;
      at(c.onset).start = true;
      if (c.hefsek) {
        at(c.hefsek).hefsek = true;
        ci.clean.forEach((s, i) => { at(s).clean = i + 1; at(s).cycleId = c.id; });
        at(ci.mikve).mikve = true;
      } else if (last) {
        at(ci.earliestHefsek).hefsekFrom = true;
      }
    });
    onot(cycles, st).forEach(o => { if (o.gDate) at(o.gDate).onot.push(o); });
    return m;
  }

  G.TL = { iso, parse, add, diff, today, heb, hebLabel, gematria, sunset, DEFAULTS, startHd, onot, cycleInfo, status, marks };
})(typeof window !== 'undefined' ? window : globalThis);
