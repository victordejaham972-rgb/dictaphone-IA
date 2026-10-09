// Lecture minimale d'une police TrueType (.ttf) : largeurs des caractères et mesures nécessaires pour l'intégrer dans un PDF.
// Aucune dépendance, aucun envoi : le fichier de police est hébergé avec l'application.
export function parseTtf(buf) {
  const dv = new DataView(buf);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const n = dv.getUint16(4), T = {};
  for (let i = 0; i < n; i++) { const o = 12 + 16 * i; T[tag(o)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }; }
  for (const need of ['head', 'hhea', 'hmtx', 'cmap', 'maxp']) if (!T[need]) throw new Error('police incomplète : ' + need);
  const head = T.head.off, hhea = T.hhea.off;
  const upm = dv.getUint16(head + 18);
  const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
  const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6), nHM = dv.getUint16(hhea + 34);
  const advance = (gid) => dv.getUint16(T.hmtx.off + 4 * Math.min(gid, nHM - 1));
  let capHeight = Math.round(ascent * 0.7);
  if (T['OS/2'] && dv.getUint16(T['OS/2'].off) >= 2 && T['OS/2'].len >= 90) capHeight = dv.getInt16(T['OS/2'].off + 88) || capHeight;
  const italicAngle = T.post ? dv.getInt32(T.post.off + 4) / 65536 : 0;

  // table des caractères (cmap) : format 4, Unicode
  const cm = T.cmap.off, nSub = dv.getUint16(cm + 2);
  let sub = -1;
  for (let i = 0; i < nSub; i++) { const o = cm + 4 + 8 * i, p = dv.getUint16(o), e = dv.getUint16(o + 2); if ((p === 3 && e === 1) || (p === 0 && sub < 0)) { const so = cm + dv.getUint32(o + 4); if (dv.getUint16(so) === 4) sub = so; } }
  if (sub < 0) throw new Error('police sans table Unicode lisible');
  const segX2 = dv.getUint16(sub + 6), segs = segX2 / 2;
  const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  const glyphFor = (cp) => {
    for (let s = 0; s < segs; s++) {
      if (cp > dv.getUint16(endO + 2 * s)) continue;
      if (cp < dv.getUint16(startO + 2 * s)) return 0;
      const ro = dv.getUint16(rangeO + 2 * s), delta = dv.getInt16(deltaO + 2 * s);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = dv.getUint16(rangeO + 2 * s + ro + 2 * (cp - dv.getUint16(startO + 2 * s)));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  return { upm, bbox, ascent, descent, capHeight, italicAngle, advance, glyphFor, has: (cp) => glyphFor(cp) > 0 };
}
