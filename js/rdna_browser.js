/* =====================================================================
 * rDNA genome browser — K562, NOR1–NOR18
 *
 * Tracks per panel (from top to bottom):
 *   ruler · GFF units (gene) · barcode · type/subtype · expression
 *   · rRNA structure · promoter/enhancer · repeats
 *   · GC content · sequence · methylation · SV line plot
 *
 * Data comes from data/rdna_data.js (single self-contained bundle).
 * Everything runs locally from file:// — no server required.
 * ===================================================================== */
(function () {
  'use strict';

  var D = window.RDNA;
  if (!D) {
    document.getElementById('panels').innerHTML =
      '<div class="error"><b>找不到数据文件 data/rdna_data.js</b><br>' +
      '请确认它与 index.html 一起保存为 <code>data/rdna_data.js</code>，然后重新打开本页面。</div>';
    return;
  }

  /* --------------------------------------------------------------- config */
  var META = D.meta;
  var TYPE_COLORS = META.typeColors;          // {1:'#5bb8ac',...}  (R_for_4A.r)
  var SHAPES = META.subtypeShapes;            // {1:'circle',...}   (R_for_4A.r pch)
  var FTYPES = META.featureTypes;             // ['rRNA','ETS',...]
  var EXPR_MAX = META.exprMax || 1;

  var COL = {
    rRNA: '#2c7bb6',
    ETS: '#8ec4e8',
    ITS: '#f5a623',
    promoter: '#3fa34d',
    enhancer: '#8e63b8',
    Repeat: '#b9bdc3',
    geneFill: '#d9e6f4',
    geneStroke: '#8fa5bf',
    fragFill: '#eceef0',
    fragStroke: '#b4b9c0',
    svSeg: '#111111',
    svLink: '#e31a1c',
    exprGray: '#cfd2d6',
    meFill: 'rgba(74,127,181,0.5)',
    meLine: '#2f6ca8'
  };

  var BASE_CHARS = 'ACGT';
  var BASE_COLORS = ['#2f9e44', '#1c6fd0', '#d9822b', '#d63b3b'];   // A C G T
  var RAMP_EXPR = [[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];

  var MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
  var SANS = 'ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif';

  /* Track definitions.  group is used by the show/hide switches. */
  var TRACKS = [
    { id: 'ruler', label: 'Position', h: 24, group: 'axis' },
    { id: 'gene', label: 'GFF unit (gene)', h: 22, group: 'unit' },
    { id: 'barcode', label: 'Barcode', h: 15, group: 'unit' },
    { id: 'type', label: 'Type / subtype', h: 17, group: 'unit' },
    { id: 'expr', label: 'Expression', h: 17, group: 'unit' },
    { id: 'rrna', label: 'rRNA structure', h: 12, group: 'gff' },
    { id: 'reg', label: 'Promoter / enh.', h: 12, group: 'gff' },
    { id: 'repeat', label: 'Repeat', h: 12, group: 'gff', laneH: 6, maxLanes: 4 },
    { id: 'gc', label: 'GC (100 bp)', h: 18, group: 'fasta' },
    { id: 'seq', label: 'Sequence', h: 19, group: 'fasta' },
    { id: 'me', label: 'Methylation', h: 56, group: 'me' },
    { id: 'sv', label: 'SV (ref index)', h: 88, group: 'sv' }
  ];

  var hiddenGroups = {};    // {group: true} -> track group hidden

  /* -------------------------------------------------------------- helpers */
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function trim(v, digits) {
    return String(Number(v.toFixed(digits)));
  }

  function fmtPos(bp) {
    if (bp >= 1e6) return trim(bp / 1e6, 2) + ' Mb';
    if (bp >= 1e3) return trim(bp / 1e3, 2) + ' kb';
    return Math.round(bp) + ' bp';
  }

  function b64bytes(s) {
    var bin = atob(s), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function baseCode(bytes, i) {
    if (i < 0) return 0;
    return (bytes[i >> 2] >> (6 - ((i & 3) << 1))) & 3;
  }

  /* step size (bp) so that one tick is at least minPx pixels wide */
  function niceStep(unitsPerPx, minPx) {
    var raw = Math.max(unitsPerPx * minPx, 1e-9);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = [1, 2, 5, 10];
    for (var i = 0; i < m.length; i++) if (m[i] * pow >= raw) return m[i] * pow;
    return 10 * pow;
  }

  function axisLabel(bp, step) {
    if (step >= 1e6) return trim(bp / 1e6, 2) + ' Mb';
    if (step >= 1e3) return trim(bp / 1e3, 2) + ' kb';
    return Math.round(bp) + ' bp';
  }

  function rampRGB(stops, t) {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var n = stops.length - 1;
    var f = t * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
    var a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * k) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }

  function rampCss(stops) {
    var parts = [];
    for (var i = 0; i < stops.length; i++) {
      var c = stops[i];
      parts.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' +
        (i / (stops.length - 1) * 100) + '%');
    }
    return 'linear-gradient(90deg,' + parts.join(',') + ')';
  }

  /* darken a hex colour, so thin strokes in light type colours stay visible */
  function shade(hex, f) {
    if (typeof hex !== 'string' || hex.charAt(0) !== '#') return '#3c4552';
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + Math.round(((n >> 16) & 255) * f) + ',' +
      Math.round(((n >> 8) & 255) * f) + ',' +
      Math.round((n & 255) * f) + ')';
  }

  /* subtype glyphs, mirroring pch 16/17/18/8/15/3 of R_for_4A.r */
  function drawShape(ctx, shape, cx, cy, r, fill, stroke) {
    ctx.beginPath();
    var i, a, rr, x, y;
    if (shape === 'circle') {
      ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    } else if (shape === 'triangle') {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.95, cy + r * 0.72);
      ctx.lineTo(cx - r * 0.95, cy + r * 0.72);
      ctx.closePath();
    } else if (shape === 'diamond') {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.86, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.86, cy);
      ctx.closePath();
    } else if (shape === 'star') {
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5;
        rr = (i % 2 === 0) ? r * 1.1 : r * 0.46;
        x = cx + Math.cos(a) * rr;
        y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === 'square') {
      ctx.rect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56);
    } else { /* cross: stroke only — pch 3 is a plus sign */
      ctx.moveTo(cx, cy - r * 0.9);
      ctx.lineTo(cx, cy + r * 0.9);
      ctx.moveTo(cx - r * 0.9, cy);
      ctx.lineTo(cx + r * 0.9, cy);
      ctx.lineWidth = Math.max(1.1, Math.min(1.9, r * 0.55));
      /* keep the type colour of the glyph, just darker so it reads on white */
      ctx.strokeStyle = fill ? shade(fill, 0.62) : (stroke || '#333');
      ctx.stroke();
      return;
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.9; ctx.stroke(); }
  }

  /* keep short text readable on top of coloured tracks */
  function haloText(ctx, text, x, y, fill) {
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, x, y);
    if (fill) ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }


  /* =================================================================
   * Panel: one NOR record with its own view window
   * ================================================================= */
  var PANELS = [];

  function createPanel(nor) {
    var sec = document.createElement('section');
    sec.className = 'panel';
    sec.id = 'panel-' + nor.id;
    sec.innerHTML =
      '<div class="phead">' +
      '  <span class="pnor">' + nor.id + '</span>' +
      '  <span class="pmeta"></span>' +
      '  <span class="preadout"></span>' +
      '  <span class="ptools">' +
      '    <button type="button" class="ptool" data-act="array" title="zoom to the rDNA array">Array</button>' +
      '    <button type="button" class="ptool" data-act="zin" title="zoom in (Ctrl + wheel)">+</button>' +
      '    <button type="button" class="ptool" data-act="zout" title="zoom out (Ctrl + wheel)">&minus;</button>' +
      '    <button type="button" class="ptool" data-act="fit" title="whole NOR (double-click the track too)">Fit</button>' +
      '    <button type="button" class="ptool" data-act="png" title="export PNG">PNG</button>' +
      '  </span>' +
      '</div>' +
      '<div class="pbody">' +
      '  <div class="gutter"></div>' +
      '  <div class="pstage"><canvas></canvas><div class="tip"></div></div>' +
      '</div>';

    var p = {
      nor: nor,
      id: nor.id,
      el: sec,
      win: [0, nor.len],
      stage: sec.querySelector('.pstage'),
      canvas: sec.querySelector('canvas'),
      gutter: sec.querySelector('.gutter'),
      tip: sec.querySelector('.tip'),
      readout: sec.querySelector('.preadout'),
      metaEl: sec.querySelector('.pmeta'),
      hits: [],
      rows: [],
      height: 0,
      W: 600,
      drawn: false,
      gutterKey: '',
      meVals: b64bytes(nor.me),
      gcVals: b64bytes(nor.gc),
      seqBytes: null,
      gffByType: {},
      exprMax: EXPR_MAX,
      laneOf: null,
      lanes: 1,
      drag: null
    };

    for (var i = 0; i < nor.gff.length; i++) {
      var f = nor.gff[i];
      var t = FTYPES[f[2]];
      if (!p.gffByType[t]) p.gffByType[t] = [];
      p.gffByType[t].push(f);
    }

    var units = nor.units, nUnit = 0, nFrag = 0, ui;
    for (ui = 0; ui < units.length; ui++) {
      if (units[ui].frag) nFrag++; else nUnit++;
    }
    p.metaEl.textContent =
      fmtInt(nor.len) + ' bp · ' + nUnit + ' units' +
      (nFrag ? ' + ' + nFrag + ' flanking frag.' : '') + ' · array ' +
      fmtInt(nor.unitRange[0]) + '–' + fmtInt(nor.unitRange[1]) +
      ' (' + fmtPos(nor.unitRange[1] - nor.unitRange[0]) + ')';

    bindPanelEvents(p);
    PANELS.push(p);
    updateHead(p);
    return { p: p, el: sec };
  }

  /* ------------------------------------------------------------ layout */
  function isVisible(def) {
    if (def.group === 'axis') return true;
    return !hiddenGroups[def.group];
  }

  function computeLayout(p, W) {
    var bpp = (p.win[1] - p.win[0]) / W;
    var rows = [], y = 0, i, def, h;
    var pack = null;

    for (i = 0; i < TRACKS.length; i++) {
      def = TRACKS[i];
      if (!isVisible(def)) continue;
      h = def.h;
      if (def.id === 'repeat') {
        pack = packLanes(p, W);
        h = Math.max(1, pack.lanes) * def.laneH + 4;
      }
      rows.push({ def: def, y: y, h: h });
      y += h;
    }
    p.laneOf = pack ? pack.laneOf : null;
    p.lanes = pack ? pack.lanes : 1;
    p.rows = rows;
    p.height = y;
    return rows;
  }

  /* greedy lane packing for the Repeat track */
  function packLanes(p, W) {
    var feats = p.gffByType.Repeat || [];
    var win = p.win, span = win[1] - win[0];
    var laneOf = new Int32Array(feats.length);
    var laneEnd = [];
    var maxLanes = 4, used = 0, i, L;

    for (i = 0; i < feats.length; i++) {
      laneOf[i] = -1;
      var f = feats[i];
      if (f[1] <= win[0] || f[0] >= win[1]) continue;
      var x0 = (f[0] - win[0]) / span * W;
      var x1 = (f[1] - win[0]) / span * W;
      if (x1 - x0 < 1.6) x1 = x0 + 1.6;

      var lane = -1;
      for (L = 0; L < laneEnd.length; L++) {
        if (laneEnd[L] <= x0 + 0.25) { lane = L; break; }
      }
      if (lane < 0) {
        if (laneEnd.length < maxLanes) {
          lane = laneEnd.length;
          laneEnd.push(x1);
        } else {
          var best = 0;
          for (L = 1; L < laneEnd.length; L++) if (laneEnd[L] < laneEnd[best]) best = L;
          lane = best;
          laneEnd[best] = Math.max(laneEnd[best], x1);
        }
      } else {
        laneEnd[lane] = x1;
      }
      laneOf[i] = lane;
      if (lane + 1 > used) used = lane + 1;
    }
    return { laneOf: laneOf, lanes: Math.max(1, used) };
  }


  /* =================================================================
   * Track painters
   * ================================================================= */
  function px(p, W, bp) {
    return (bp - p.win[0]) / (p.win[1] - p.win[0]) * W;
  }

  function pushHit(p, track, x0, x1, row, html) {
    p.hits.push({ t: track, x0: x0, x1: x1, y0: row.y, y1: row.y + row.h, html: html });
  }

  /* pixel geometry of a unit / feature, clamped to the canvas so that very
     wide features still render (and label) correctly when zoomed in */
  function rectOf(p, W, start, end) {
    var x0 = px(p, W, start);
    var x1 = px(p, W, end);
    return {
      x0: x0,
      x1: x1,
      a: Math.max(x0, 0),
      b: Math.min(x1, W),
      w: x1 - x0,
      visible: (x1 > 0 && x0 < W)
    };
  }

  function centre(a, b) {
    return (a + b) / 2;
  }

  /* ---------------------------------------------------------- ruler */
  function drawRuler(p, row, ctx, W) {
    var y = row.y, h = row.h, win = p.win, bpp = (win[1] - win[0]) / W;
    ctx.fillStyle = '#f4f6f9';
    ctx.fillRect(0, y, W, h);
    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + h - 0.5);
    ctx.lineTo(W, y + h - 0.5);
    ctx.stroke();

    var step = niceStep(bpp, 92);
    var minor = step / 5;
    var bp;

    if (minor / bpp >= 6) {
      ctx.strokeStyle = '#b6bdc7';
      ctx.beginPath();
      for (bp = Math.ceil(win[0] / minor) * minor; bp <= win[1]; bp += minor) {
        var xm = Math.round(px(p, W, bp)) + 0.5;
        ctx.moveTo(xm, y + h - 4);
        ctx.lineTo(xm, y + h - 1);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#66707d';
    ctx.fillStyle = '#2f3640';
    ctx.font = '10px ' + SANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (bp = Math.ceil(win[0] / step) * step; bp <= win[1]; bp += step) {
      var x = Math.round(px(p, W, bp)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + h - 9);
      ctx.lineTo(x, y + h - 1);
      ctx.stroke();
      ctx.fillText(axisLabel(bp, step), x, y + 2);
    }
  }

  /* --------------------------------------------------- GFF gene units */
  function drawGene(p, row, ctx, W) {
    var units = p.nor.units;
    var barTop = row.y + 3, barH = row.h - 7;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var g = rectOf(p, W, u.start, u.end);
      if (!g.visible) continue;
      var w = g.w;

      ctx.fillStyle = u.frag ? COL.fragFill : (i % 2 ? '#e4edf8' : COL.geneFill);
      ctx.fillRect(g.a, barTop, Math.max(0.8, g.b - g.a - 0.8), barH);
      ctx.strokeStyle = u.frag ? COL.fragStroke : COL.geneStroke;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(g.a + 0.4, barTop + 0.4, Math.max(0.8, g.b - g.a - 1.2), barH - 0.8);

      var label = null;
      if (w > 34) {
        ctx.font = '9.5px ' + SANS;
        if (ctx.measureText(u.name).width + 8 <= w) label = u.name;
      }
      if (!label && w > 12) {
        ctx.font = '9px ' + SANS;
        label = u.frag ? (i === 0 ? 'L' : 'R') : String(u.name).split('_')[1];
        if (ctx.measureText(label).width + 4 > w) label = null;
      }
      if (label) {
        ctx.fillStyle = u.frag ? '#7b838d' : '#20313f';
        ctx.fillText(label, centre(g.a, g.b), barTop + barH / 2 + 0.5);
      }

      pushHit(p, 'gene', g.a, g.b, row,
        '<b>' + u.name + '</b>\n' + fmtInt(u.start) + '–' + fmtInt(u.end) +
        '  (' + fmtPos(u.len) + ')' +
        '\nbarcode ' + (u.barcode === 'NA' ? 'NA' : u.barcode) + '  (count ' + u.bc + ')' +
        '\ntype ' + (u.type === null ? 'NA' : u.type + '_' + u.subtype) +
        '   expression ' + (u.expr === null ? 'NA' : u.expr.toFixed(2)));
    }
  }

  /* ------------------------------------------------------- barcode track */
  function barcodeTip(u) {
    return '<b>' + u.name + '</b>\nbarcode  ' + (u.barcode === 'NA' ? 'NA' : u.barcode) +
      '\nbarcode_count  ' + u.bc;
  }

  function drawBarcode(p, row, ctx, W) {
    var units = p.nor.units, y = row.y, h = row.h;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var r0 = rectOf(p, W, u.start, u.end);
      if (!r0.visible) continue;
      var w = r0.w;

      if (i % 2) {
        ctx.fillStyle = '#f7f9fc';
        ctx.fillRect(r0.a, y, Math.max(1, r0.b - r0.a), h);
      }
      ctx.strokeStyle = '#eceff3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(r0.a) + 0.5, y + 1);
      ctx.lineTo(Math.round(r0.a) + 0.5, y + h - 1);
      ctx.stroke();

      var txt = (u.barcode && u.barcode !== 'NA') ? u.barcode : 'NA';
      var fs = Math.min(9, (w - 4) / (txt.length * 0.62));
      if (fs >= 5 && w >= 9) {
        ctx.font = '600 ' + fs.toFixed(1) + 'px ' + MONO;
        ctx.fillStyle = (u.barcode === 'NA') ? '#b3b8bf' : '#2f3c4b';
        ctx.fillText(txt, centre(r0.a, r0.b), y + h / 2 + 0.5);
      }
      pushHit(p, 'barcode', r0.a, r0.b, row, barcodeTip(u));
    }
  }


  /* ---------------------------------------------------------- type track */
  function drawType(p, row, ctx, W) {
    var units = p.nor.units, y = row.y, h = row.h;
    var cy = y + h / 2;
    var r = Math.min(5, h / 2 - 2);

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var r0 = rectOf(p, W, u.start, u.end);
      if (!r0.visible) continue;
      var w = r0.w;
      if (i % 2) {
        ctx.fillStyle = '#f7f9fc';
        ctx.fillRect(r0.a, y, Math.max(1, r0.b - r0.a), h);
      }
      if (u.type === null) continue;

      /* keep the marker on screen even when the unit is wider than the view */
      var cx = Math.max(4, Math.min(W - 4, centre(r0.a, r0.b)));
      var fill = TYPE_COLORS[String(u.type)] || '#cccccc';
      var shape = SHAPES[String(u.subtype)] || 'circle';
      drawShape(ctx, shape, cx, cy, r, fill, '#4a4f56');
      pushHit(p, 'type', r0.a, r0.b, row,
        '<b>' + u.name + '</b>\ntype  ' + u.type + '   subtype  ' + u.subtype);
    }
  }

  /* ---------------------------------------------------- expression track */
  function drawExpr(p, row, ctx, W) {
    var units = p.nor.units, y = row.y, h = row.h;
    var barH = Math.min(11, h - 4);
    var barTop = y + (h - barH) / 2;

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var r0 = rectOf(p, W, u.start, u.end);
      if (!r0.visible) continue;
      var w = r0.w;

      if (i % 2) {
        ctx.fillStyle = '#f7f9fc';
        ctx.fillRect(r0.a, y, Math.max(1, r0.b - r0.a), h);
      }

      var coloured = (u.bc === 1 && u.expr !== null);
      ctx.fillStyle = coloured ? rampRGB(RAMP_EXPR, u.expr / p.exprMax) : COL.exprGray;
      ctx.fillRect(r0.a + 0.3, barTop, Math.max(0.7, r0.b - r0.a - 0.6), barH);
      if (w > 4) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r0.a + 0.3, barTop + 0.5, Math.max(0.7, r0.b - r0.a - 0.6), barH - 1);
      }

      pushHit(p, 'expr', r0.a, r0.b, row,
        '<b>' + u.name + '</b>\nbarcode_count  ' + u.bc +
        (u.bc === 1 ? '   (coloured)' : '   (grey: barcode_count \u2260 1)') +
        '\nexpression  ' + (u.expr === null ? 'NA' : u.expr.toFixed(2)));
    }
  }


  /* ------------------------------------------- generic GFF feature track */
  function drawFeatures(p, row, ctx, W, types) {
    var y = row.y, h = row.h;
    var barH = Math.max(4, h - 5);
    var barTop = y + (h - barH) / 2;

    for (var t = 0; t < types.length; t++) {
      var typeName = types[t];
      var feats = p.gffByType[typeName] || [];
      var colour = COL[typeName] || '#999999';
      var laneOffset = (row.def.id === 'repeat') ? p.laneOf : null;

      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        if (f[1] <= p.win[0] || f[0] >= p.win[1]) continue;
        var x0 = px(p, W, f[0]);
        var x1 = px(p, W, f[1]);
        var w = Math.max(1.2, x1 - x0);
        var fy = barTop, fh = barH;

        if (laneOffset) {
          var lane = laneOffset[i];
          if (lane < 0) continue;
          fh = row.def.laneH - 1;
          fy = y + 2 + lane * row.def.laneH;
        }
        ctx.fillStyle = colour;
        ctx.fillRect(x0, fy, w, fh);

        if (!laneOffset && w > 42) {
          var shortName = String(f[3]).replace(/\s+\d+(\.\d+)?$/, '');
          ctx.font = '9px ' + SANS;
          if (ctx.measureText(shortName).width + 6 <= w) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = (typeName === 'ETS') ? '#20313f' : '#ffffff';
            ctx.fillText(shortName, x0 + w / 2, fy + fh / 2 + 0.5);
          }
        }

        pushHit(p, row.def.id, x0, x0 + w, row,
          '<b>' + f[3] + '</b>\n' + typeName + '\n' +
          fmtInt(f[0] + 1) + '–' + fmtInt(f[1]) + '  (' + fmtPos(f[1] - f[0]) + ')' +
          (f[4] ? '\nparent  ' + f[4] : ''));
      }
    }
  }

  /* ------------------------------------------------------------- GC track */
  function drawGC(p, row, ctx, W) {
    var y = row.y, h = row.h;
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, y, W, h);

    var top = y + 3, bottom = y + h - 3;
    var bpp = (p.win[1] - p.win[0]) / W;
    var prof = gcProfile(p, W, bpp);
    var x, v;

    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (x = 0; x < W; x++) {
      v = prof[x];
      ctx.lineTo(x + 0.5, bottom - v * (bottom - top));
    }
    ctx.lineTo(W, bottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(74,127,181,0.5)';
    ctx.fill();

    ctx.beginPath();
    for (x = 0; x < W; x++) {
      v = prof[x];
      if (x === 0) ctx.moveTo(x + 0.5, bottom - v * (bottom - top));
      else ctx.lineTo(x + 0.5, bottom - v * (bottom - top));
    }
    ctx.strokeStyle = '#2f6ca8';
    ctx.lineWidth = 1;
    ctx.stroke();

    var y50 = bottom - 0.5 * (bottom - top);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#aab1bb';
    ctx.beginPath();
    ctx.moveTo(0, y50 + 0.5);
    ctx.lineTo(W, y50 + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '8px ' + MONO;
    ctx.fillStyle = '#8b95a1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('50%', 3, y50 + 1);
  }

  /* GC profile (0..1), one value per pixel column */
  function gcProfile(p, W, bpp) {
    var out = new Float32Array(W);
    var x, s, e, i, gc, tot, b;

    if (bpp < 4) {                        // exact base composition
      var bytes = getSeq(p);
      for (x = 0; x < W; x++) {
        s = Math.floor(p.win[0] + x * bpp);
        e = Math.max(s + 1, Math.floor(p.win[0] + (x + 1) * bpp));
        gc = 0; tot = 0;
        for (i = s; i < e; i++) {
          b = baseCode(bytes, i);
          if (b === 1 || b === 2) gc++;
          tot++;
        }
        out[x] = tot ? gc / tot : 0;
      }
      return out;
    }

    var vals = p.gcVals;
    var B = p.nor.gcbin;
    for (x = 0; x < W; x++) {
      s = p.win[0] + x * bpp;
      e = s + bpp;
      var b0 = Math.floor(s / B);
      var b1 = Math.min(vals.length, Math.max(b0 + 1, Math.ceil(e / B)));
      var sum = 0, n = 0;
      for (b = b0; b < b1; b++) { sum += vals[b]; n++; }
      out[x] = n ? (sum / n) / 100 : 0;
    }
    return out;
  }

  function getSeq(p) {
    if (!p.seqBytes) p.seqBytes = b64bytes(p.nor.seq);
    return p.seqBytes;
  }


  /* ------------------------------------------------------ sequence track */
  function drawSeq(p, row, ctx, W) {
    var y = row.y, h = row.h;
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, y, W, h);

    var bpp = (p.win[1] - p.win[0]) / W;
    var pxPerBase = 1 / bpp;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (pxPerBase < 6.5) {
      ctx.font = '9.5px ' + SANS;
      ctx.fillStyle = '#a7aeb8';
      ctx.textAlign = 'left';
      ctx.fillText('Ctrl + wheel to zoom in for bases', 6, y + h / 2 + 0.5);
      return;
    }

    var bytes = getSeq(p);
    var fs = Math.min(13, pxPerBase * 0.8, h - 5);
    ctx.font = fs.toFixed(1) + 'px ' + MONO;
    var start = Math.max(0, Math.floor(p.win[0]));
    var end = Math.min(p.nor.len, Math.ceil(p.win[1]));
    for (var i = start; i < end; i++) {
      var x = px(p, W, i + 0.5);
      if (x < -8 || x > W + 8) continue;
      var c = baseCode(bytes, i);
      ctx.fillStyle = BASE_COLORS[c];
      ctx.fillText(BASE_CHARS.charAt(c), x, y + h / 2 + 0.5);
    }
  }

  /* --------------------------------------------------- methylation track */
  /* Peak plot in the style of an IGV bedGraph track: filled signal growing
     up from the baseline, with an auto-scaled 0 .. N % y axis. */
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var m = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < m.length; i++) if (m[i] * pow >= v - 1e-9) return m[i] * pow;
    return 10 * pow;
  }

  function drawMe(p, row, ctx, W) {
    var y = row.y, h = row.h, win = p.win;
    ctx.fillStyle = '#fdfdfe';
    ctx.fillRect(0, y, W, h);

    var top = y + 5, bot = y + h - 5;
    var span = Math.max(1, bot - top);

    var B = p.nor.mebin, vals = p.meVals;
    var bpp = (win[1] - win[0]) / W;
    var b0 = Math.max(0, Math.floor(win[0] / B));
    var b1 = Math.min(vals.length, Math.ceil(win[1] / B));
    var i, x, j;

    /* pixel spans of the annotated NOR region — the rDNA units *and* their
       flanking fragments; only the sequence outside the annotation is blank */
    var segs = [];
    for (i = 0; i < p.nor.units.length; i++) {
      var u = p.nor.units[i];
      if (u.end <= win[0] || u.start >= win[1]) continue;
      segs.push([Math.max(0, px(p, W, Math.max(u.start, win[0]))),
        Math.min(W, px(p, W, Math.min(u.end, win[1])))]);
    }

    function inNor(x) {
      for (var k = 0; k < segs.length; k++) {
        if (x >= segs[k][0] && x <= segs[k][1]) return true;
      }
      return false;
    }

    /* value of every pixel column = highest bin touching it, so sharp peaks
       stay visible when the bins get narrower than a pixel */
    var prof = new Float32Array(W), peak = 0;
    for (x = 0; x < W; x++) {
      if (!inNor(x)) continue;
      var s = win[0] + x * bpp, e = s + bpp;
      var i0 = Math.max(b0, Math.floor(s / B));
      var i1 = Math.min(b1, Math.max(i0 + 1, Math.ceil(e / B)));
      var v = 0;
      for (i = i0; i < i1; i++) if (vals[i] > v) v = vals[i];
      prof[x] = v;
      if (v > peak) peak = v;
    }

    /* y axis: 0 .. ymax, auto-scaled over the visible window (IGV style) */
    var ymax = Math.min(100, Math.max(10, niceCeil(peak)));
    function yOf(val) {
      var t = val / ymax;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return bot - t * span;
    }

    /* grid line at half of the axis */
    var gy = Math.round(yOf(ymax / 2)) + 0.5;
    ctx.strokeStyle = '#eef1f5';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    ctx.setLineDash([]);

    /* ---- signal -------------------------------------------------- */
    var binPx = B / bpp;
    ctx.fillStyle = COL.meFill;

    if (binPx >= 3) {
      /* bins wider than a few pixels: one filled bar each, like IGV,
         clipped to the NOR units */
      for (i = b0; i < b1; i++) {
        if (vals[i] <= 0) continue;
        var xa = px(p, W, i * B), xb = px(p, W, (i + 1) * B);
        var yv = Math.min(bot - 0.7, yOf(vals[i]));
        for (j = 0; j < segs.length; j++) {
          var ca = Math.max(xa, segs[j][0]), cb = Math.min(xb, segs[j][1]);
          if (cb - ca < 0.4) continue;
          ctx.fillRect(ca + 0.3, yv, Math.max(0.8, cb - ca - 0.6), bot - yv);
        }
      }
    } else {
      /* dense window: one continuous filled peak profile + outline */
      ctx.beginPath();
      ctx.moveTo(0, bot);
      for (x = 0; x < W; x++) ctx.lineTo(x + 0.5, yOf(prof[x]));
      ctx.lineTo(W, bot);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      for (x = 0; x < W; x++) {
        if (x === 0) ctx.moveTo(0.5, yOf(prof[0]));
        else ctx.lineTo(x + 0.5, yOf(prof[x]));
      }
      ctx.strokeStyle = COL.meLine;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* ---- baseline + axis labels ---------------------------------- */
    ctx.strokeStyle = '#cfd5dd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(bot) + 0.5);
    ctx.lineTo(W, Math.round(bot) + 0.5);
    ctx.stroke();

    ctx.font = '8.5px ' + MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    /* small white pill so the scale stays readable on top of the signal */
    function tag(txt, ty) {
      var tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(253,253,254,0.9)';
      ctx.fillRect(2, ty - 5.5, tw + 4, 11);
      ctx.fillStyle = '#8b95a1';
      ctx.fillText(txt, 3, ty);
    }

    tag(trim(ymax, 1) + '%', top + 5);
    tag(trim(ymax / 2, 1) + '%', yOf(ymax / 2));
    tag('0', bot - 6);
  }

  /* ------------------------------------------------ SV line plot (ref idx) */
  function drawSV(p, row, ctx, W) {
    var y = row.y, h = row.h, sv = p.nor.sv, win = p.win;
    ctx.fillStyle = '#fdfdfe';
    ctx.fillRect(0, y, W, h);

    var padT = 6, padB = 6;
    var top = y + padT, bot = y + h - padB;
    var y0 = sv.ymin, y1 = sv.ymax, yr = (y1 - y0) || 1;

    function yOf(v) {
      return bot - (v - y0) / yr * (bot - top);
    }

    /* reference-index grid */
    var ystep = niceStep(yr / Math.max(1, bot - top), 26);
    ctx.font = '8.5px ' + MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var v = Math.ceil(y0 / ystep) * ystep; v <= y1; v += ystep) {
      var yy = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = '#eceff3';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
      haloText(ctx, Math.round(v / 1000) + 'k', 3, yy, '#8b95a1');
    }

    /* left axis */
    ctx.strokeStyle = '#cfd5dd';
    ctx.beginPath();
    ctx.moveTo(0.5, top);
    ctx.lineTo(0.5, bot);
    ctx.stroke();

    var q0 = sv.q0, q1 = sv.q1, r0 = sv.r0, r1 = sv.r1, n = q0.length, i;

    /* red jumps between consecutive alignment segments */
    ctx.strokeStyle = COL.svLink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 1; i < n; i++) {
      if (q1[i - 1] < win[0] || q0[i] > win[1]) continue;
      ctx.moveTo(px(p, W, q1[i - 1]), yOf(r1[i - 1]));
      ctx.lineTo(px(p, W, q0[i]), yOf(r0[i]));
    }
    ctx.stroke();

    /* black alignment segments */
    ctx.strokeStyle = COL.svSeg;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      if (q1[i] < win[0] || q0[i] > win[1]) continue;
      ctx.moveTo(px(p, W, q0[i]), yOf(r0[i]));
      ctx.lineTo(px(p, W, q1[i]), yOf(r1[i]));
    }
    ctx.stroke();

    p.svYOf = yOf;
  }


  /* =================================================================
   * Rendering
   * ================================================================= */
  function paintTrack(p, row, ctx, W) {
    switch (row.def.id) {
      case 'ruler': return drawRuler(p, row, ctx, W);
      case 'gene': return drawGene(p, row, ctx, W);
      case 'barcode': return drawBarcode(p, row, ctx, W);
      case 'type': return drawType(p, row, ctx, W);
      case 'expr': return drawExpr(p, row, ctx, W);
      case 'rrna': return drawFeatures(p, row, ctx, W, ['rRNA', 'ETS', 'ITS']);
      case 'reg': return drawFeatures(p, row, ctx, W, ['promoter', 'enhancer']);
      case 'repeat': return drawFeatures(p, row, ctx, W, ['Repeat']);
      case 'gc': return drawGC(p, row, ctx, W);
      case 'seq': return drawSeq(p, row, ctx, W);
      case 'me': return drawMe(p, row, ctx, W);
      case 'sv': return drawSV(p, row, ctx, W);
    }
  }

  function render(p) {
    if (!p.el.parentNode) return;
    var W = Math.floor(p.stage.clientWidth);
    if (W < 60) return;
    p.W = W;

    var rows = computeLayout(p, W);
    var dpr = window.devicePixelRatio || 1;
    var cv = p.canvas;
    var pw = Math.round(W * dpr), ph = Math.round(p.height * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    cv.style.width = W + 'px';
    cv.style.height = p.height + 'px';

    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, p.height);
    p.hits = [];

    for (var i = 0; i < rows.length; i++) paintTrack(p, rows[i], ctx, W);

    syncGutter(p);
    p.drawn = true;
  }

  function syncGutter(p) {
    var key = '';
    for (var i = 0; i < p.rows.length; i++) key += p.rows[i].def.id + ':' + p.rows[i].h + '|';
    if (key === p.gutterKey) return;
    p.gutterKey = key;

    var html = '';
    for (var j = 0; j < p.rows.length; j++) {
      var r = p.rows[j];
      html += '<div class="glabel grp-' + r.def.group + '" style="height:' + r.h + 'px">' +
        r.def.label + '</div>';
    }
    p.gutter.innerHTML = html;
  }

  function updateHead(p) {
    var span = p.win[1] - p.win[0];
    p.readout.textContent = fmtInt(p.win[0]) + '–' + fmtInt(p.win[1]) +
      '  (' + fmtPos(span) + ')';
  }

  /* ------------------------------------------------------ view window */
  function setWin(p, s, e) {
    var len = p.nor.len;
    var minSpan = 25;
    var span = e - s;

    if (!(span > 0) || !isFinite(span)) span = len;
    if (span < minSpan) {
      var c = (s + e) / 2;
      s = c - minSpan / 2;
      e = c + minSpan / 2;
    }
    if (s < 0) { e -= s; s = 0; }
    if (e > len) { s -= (e - len); e = len; if (s < 0) s = 0; }

    p.win[0] = s;
    p.win[1] = e;
    render(p);
    updateHead(p);
  }

  function zoomAt(p, frac, factor) {
    var span = p.win[1] - p.win[0];
    var anchor = p.win[0] + frac * span;
    var ns = span * factor;
    setWin(p, anchor - frac * ns, anchor + (1 - frac) * ns);
  }

  function zoomToUnit(p, unitName) {
    var units = p.nor.units;
    for (var i = 0; i < units.length; i++) {
      if (units[i].name === unitName) {
        var pad = (units[i].end - units[i].start) * 0.06;
        setWin(p, units[i].start - pad, units[i].end + pad);
        return true;
      }
    }
    return false;
  }


  /* =================================================================
   * Hover / tooltips
   * ================================================================= */
  function rowAt(p, y) {
    for (var i = 0; i < p.rows.length; i++) {
      var r = p.rows[i];
      if (y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  function bpAt(p, x) {
    return p.win[0] + (x / Math.max(1, p.W)) * (p.win[1] - p.win[0]);
  }

  function hitAt(p, id, x, y) {
    var best = null;
    for (var i = 0; i < p.hits.length; i++) {
      var h = p.hits[i];
      if (h.t !== id) continue;
      if (y < h.y0 || y > h.y1) continue;
      if (x < h.x0 - 1 || x > h.x1 + 1) continue;
      if (!best || (h.x1 - h.x0) < (best.x1 - best.x0)) best = h;
    }
    return best;
  }

  function binValue(vals, bin, bp) {
    var i = Math.floor(bp / bin);
    if (i < 0 || i >= vals.length) return null;
    return vals[i];
  }

  /* true when bp falls inside the annotated NOR region (rDNA units and their
     flanking fragments); the sequence outside the annotation is not rDNA, so
     no methylation is drawn or reported there */
  function inNorUnit(nor, bp) {
    var units = nor.units || [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (bp >= u.start && bp < u.end) return true;
    }
    return false;
  }

  function svInfo(p, x) {
    var sv = p.nor.sv, n = sv.q0.length;
    if (!n) return 'no SV data';
    var bp = bpAt(p, x);
    var best = 0, bestd = Infinity, i, d;

    for (i = 0; i < n; i++) {
      if (bp >= sv.q0[i] && bp <= sv.q1[i]) { best = i; bestd = 0; break; }
      d = Math.min(Math.abs(bp - sv.q0[i]), Math.abs(bp - sv.q1[i]));
      if (d < bestd) { bestd = d; best = i; }
    }
    return '<b>segment ' + (best + 1) + ' / ' + n + '</b>' +
      '\nquery  ' + fmtInt(sv.q0[best]) + '–' + fmtInt(sv.q1[best]) +
      '\nref    ' + fmtInt(sv.r0[best]) + '–' + fmtInt(sv.r1[best]) +
      '\nrows   ' + sv.rc[best];
  }

  function tipHtml(p, row, x, y) {
    var id = row.def.id;
    var bp = bpAt(p, x);
    var hit = hitAt(p, id, x, y);
    if (hit) return hit.html;

    if (id === 'ruler') {
      return '<b>' + p.nor.id + '</b>\nposition  ' + fmtInt(bp) + ' bp';
    }
    if (id === 'seq') {
      var i = Math.floor(bp);
      if (i < 0 || i >= p.nor.len) return '<b>' + p.nor.id + '</b>\noutside the sequence';
      return '<b>' + p.nor.id + ':' + fmtInt(i + 1) + '</b>\nbase  ' +
        BASE_CHARS.charAt(baseCode(getSeq(p), i));
    }
    if (id === 'gc') {
      var g = binValue(p.gcVals, p.nor.gcbin, bp);
      return '<b>' + p.nor.id + ':' + fmtInt(bp) + '</b>\nGC  ' +
        (g === null ? 'NA' : g.toFixed(1) + ' %') + '  (' + p.nor.gcbin + ' bp bin)';
    }
    if (id === 'me') {
      if (!inNorUnit(p.nor, bp)) {
        return '<b>' + p.nor.id + ':' + fmtInt(bp) +
          '</b>\nnot in the rDNA annotation\nmethylation  not shown';
      }
      var m = binValue(p.meVals, p.nor.mebin, bp);
      return '<b>' + p.nor.id + ':' + fmtInt(bp) + '</b>\nmethylation  ' +
        (m === null ? 'NA' : m.toFixed(1) + ' %') + '  (' + p.nor.mebin + ' bp bin)';
    }
    if (id === 'sv') return svInfo(p, x);
    return '<b>' + p.nor.id + '</b>\nposition  ' + fmtInt(bp) + ' bp';
  }

  function hideTip(p) {
    if (p.tip.style.display !== 'none') p.tip.style.display = 'none';
  }

  function hover(p, ev) {
    if (!p.drawn) return;
    var rect = p.canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;

    if (x < 0 || y < 0 || x > p.W || y > p.height) { hideTip(p); return; }
    var row = rowAt(p, y);
    if (!row) { hideTip(p); return; }

    p.tip.innerHTML = tipHtml(p, row, x, y).replace(/\n/g, '<br>');
    p.tip.style.display = 'block';

    var tw = p.tip.offsetWidth, th = p.tip.offsetHeight;
    var left = x + 14, top = y + 16;
    if (left + tw > p.W - 4) left = x - tw - 14;
    if (left < 2) left = 2;
    if (top + th > p.height - 2) top = y - th - 12;
    if (top < 2) top = 2;
    p.tip.style.left = left + 'px';
    p.tip.style.top = top + 'px';
  }


  /* =================================================================
   * PNG export
   * ================================================================= */
  function exportPNG(p) {
    if (!p.drawn) render(p);
    var dpr = window.devicePixelRatio || 1;
    var W = p.W;
    var headH = 34, footH = 16;
    var totalH = p.height + headH + footH;

    var out = document.createElement('canvas');
    out.width = Math.round(W * dpr);
    out.height = Math.round(totalH * dpr);
    var ctx = out.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, totalH);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1f2a37';
    ctx.font = '600 13px ' + SANS;
    ctx.fillText(p.nor.id + '   ' + fmtInt(p.win[0]) + '–' + fmtInt(p.win[1]) + ' bp  (' +
      fmtPos(p.win[1] - p.win[0]) + ')', 8, 7);

    ctx.font = '10.5px ' + SANS;
    ctx.fillStyle = '#6b7480';
    ctx.fillText('K562 rDNA browser  ·  NOR length ' + fmtInt(p.nor.len) + ' bp  ·  ' +
      p.nor.units.length + ' units  ·  ' + new Date().toLocaleString(), 8, 22);

    ctx.drawImage(p.canvas, 0, headH, W, p.height);

    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headH + p.height + 0.5);
    ctx.lineTo(W, headH + p.height + 0.5);
    ctx.stroke();

    var link = document.createElement('a');
    link.download = p.nor.id + '_' + Math.round(p.win[0]) + '-' + Math.round(p.win[1]) + '.png';
    link.href = out.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* =================================================================
   * Panel interactions
   * ================================================================= */
  function bindPanelEvents(p) {
    p.el.querySelector('.ptools').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.ptool') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'fit') setWin(p, 0, p.nor.len);
      else if (act === 'array') setWin(p, p.nor.unitRange[0], p.nor.unitRange[1]);
      else if (act === 'zin') zoomAt(p, 0.5, 1 / 1.7);
      else if (act === 'zout') zoomAt(p, 0.5, 1.7);
      else if (act === 'png') exportPNG(p);
    });

    /* Ctrl/Cmd + wheel zooms around the cursor, plain wheel scrolls the page */
    p.stage.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      var rect = p.canvas.getBoundingClientRect();
      var f = (ev.clientX - rect.left) / Math.max(1, rect.width);
      f = f < 0 ? 0 : (f > 1 ? 1 : f);
      /* deltaY is ~100 per notch; bigger deltas zoom faster */
      var step = Math.pow(1.0022, ev.deltaY || 100);
      if (step < 0.05) step = 0.05;
      if (step > 20) step = 20;
      zoomAt(p, f, step);
      hideTip(p);
    }, { passive: false });

    p.stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || !p.drawn) return;
      p.drag = { x: ev.clientX, s: p.win[0], e: p.win[1] };
      p.stage.classList.add('dragging');
      hideTip(p);
      if (p.stage.setPointerCapture) {
        try { p.stage.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      }
    });

    p.stage.addEventListener('pointermove', function (ev) {
      if (p.drag) {
        var dx = ev.clientX - p.drag.x;
        var span = p.drag.e - p.drag.s;
        var shift = -dx / Math.max(1, p.W) * span;
        setWin(p, p.drag.s + shift, p.drag.e + shift);
        return;
      }
      hover(p, ev);
    });

    function endDrag() {
      p.drag = null;
      p.stage.classList.remove('dragging');
    }
    p.stage.addEventListener('pointerup', endDrag);
    p.stage.addEventListener('pointercancel', endDrag);
    p.stage.addEventListener('pointerleave', function () { hideTip(p); });

    p.stage.addEventListener('dblclick', function () {
      setWin(p, 0, p.nor.len);
    });

    /* clicking a unit in the gene track zooms to that unit */
    p.stage.addEventListener('click', function (ev) {
      if (!p.drawn) return;
      var rect = p.canvas.getBoundingClientRect();
      var y = ev.clientY - rect.top, x = ev.clientX - rect.left;
      var row = rowAt(p, y);
      if (!row || row.def.id !== 'gene') return;
      var hit = hitAt(p, 'gene', x, y);
      if (!hit) return;
      var m = hit.html.match(/^<b>([^<]+)<\/b>/);
      if (m) zoomToUnit(p, m[1]);
    });
  }


  /* =================================================================
   * Legend
   * ================================================================= */
  function shapeSvg(shape, colour) {
    var c = 7, r = 5.4, d = '', i, a, pts;
    var head = '<svg width="14" height="14" viewBox="0 0 14 14">';
    var stroke = ' fill="' + colour + '" stroke="#4a4f56" stroke-width="0.9"';

    if (shape === 'circle') {
      return head + '<circle cx="7" cy="7" r="' + (r * 0.86).toFixed(2) + '"' + stroke + '/></svg>';
    }
    if (shape === 'triangle') {
      d = 'M7,' + (c - r) + 'L' + (c + r * 0.95).toFixed(2) + ',' +
        (c + r * 0.72).toFixed(2) + 'L' + (c - r * 0.95).toFixed(2) + ',' +
        (c + r * 0.72).toFixed(2) + 'Z';
    } else if (shape === 'diamond') {
      d = 'M7,' + (c - r) + 'L' + (c + r * 0.86).toFixed(2) + ',7L7,' + (c + r) +
        'L' + (c - r * 0.86).toFixed(2) + ',7Z';
    } else if (shape === 'square') {
      var q = (r * 0.78).toFixed(2);
      d = 'M' + (7 - q) + ',' + (7 - q) + 'h' + (2 * q) + 'v' + (2 * q) + 'h' + (-2 * q) + 'Z';
    } else if (shape === 'star') {
      pts = [];
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5;
        var rr = i % 2 ? r * 0.45 : r;
        pts.push(((7 + rr * Math.cos(a)).toFixed(2)) + ',' + ((7 + rr * Math.sin(a)).toFixed(2)));
      }
      d = 'M' + pts.join('L') + 'Z';
    } else {                              // cross: pch 3 = plus sign
      var k = Number((r * 0.9).toFixed(2));
      return head + '<path d="M7,' + (7 - k).toFixed(2) + 'L7,' + (7 + k).toFixed(2) +
        'M' + (7 - k).toFixed(2) + ',7L' + (7 + k).toFixed(2) + ',7' +
        '" stroke="' + shade(colour, 0.62) + '" stroke-width="1.9" stroke-linecap="butt" fill="none"/></svg>';
    }
    return head + '<path d="' + d + '"' + stroke + '/></svg>';
  }

  /* miniature peak plot used in the legend for the methylation track */
  function meProfileSvg() {
    var vals = [6, 2, 8, 10, 4, 11, 7, 1, 6, 9, 3, 5];
    var n = vals.length, w = 34, hh = 14, bot = 13;
    var area = 'M1.5,' + bot, line = '', i, x;
    for (i = 0; i < n; i++) {
      x = (1.5 + i * (w - 3) / (n - 1)).toFixed(1);
      area += 'L' + x + ',' + (bot - vals[i]);
      line += (i ? 'L' : 'M') + x + ',' + (bot - vals[i]);
    }
    area += 'L' + (w - 1.5) + ',' + bot + 'Z';
    return '<svg width="' + w + '" height="' + hh + '" viewBox="0 0 ' + w + ' ' + hh + '">' +
      '<rect x="0" y="0" width="' + w + '" height="' + hh + '" fill="#fdfdfe"/>' +
      '<path d="' + area + '" fill="' + COL.meFill + '"/>' +
      '<path d="' + line + '" fill="none" stroke="' + COL.meLine + '" stroke-width="1"/>' +
      '<path d="M0,' + (bot + 0.5) + 'L' + w + ',' + (bot + 0.5) + '" stroke="#cfd5dd" stroke-width="1"/>' +
      '</svg>';
  }

  function lgroup(title, itemsHtml) {
    return '<div class="lgrp"><div class="lgroup-title">' + title + '</div>' +
      '<div class="litems">' + itemsHtml + '</div></div>';
  }

  function swatchItem(colour, label) {
    return '<span class="litem"><span class="swatch" style="background:' + colour +
      '"></span>' + label + '</span>';
  }

  function buildLegend() {
    var html = '<h2>Legend</h2>';

    /* type = colour, subtype = shape (R_for_4A.r) */
    var items = '';
    (META.typeOrder || [1, 2, 3, 4, 5]).forEach(function (t) {
      items += swatchItem(TYPE_COLORS[String(t)] || '#ccc', 'type ' + t);
    });
    html += lgroup('Unit type — colour', items);

    items = '';
    (META.subtypeOrder || [1, 2, 3, 4, 5, 6]).forEach(function (s) {
      items += '<span class="litem">' + shapeSvg(SHAPES[String(s)] || 'circle', '#8f98a3') +
        'subtype ' + s + '</span>';
    });
    html += lgroup('Unit subtype — shape', items);

    /* expression ramp + grey rule */
    html += lgroup('Expression (by barcode)',
      '<span class="ramp-wrap">0<span class="ramp" style="background:' +
      rampCss(RAMP_EXPR) + '"></span>' + trim(EXPR_MAX, 2) + '</span>' +
      swatchItem(COL.exprGray, 'barcode_count &ne; 1 (not coloured)'));

    html += lgroup('Methylation (peak plot)',
      '<span class="litem">' + meProfileSvg() +
      '0-100 % · 50 bp bins · NOR only</span>');

    /* GFF features + gene units */
    html += lgroup('GFF annotation',
      swatchItem(COL.geneFill, 'gene unit') +
      swatchItem(COL.rRNA, 'rRNA') +
      swatchItem(COL.ETS, 'ETS') +
      swatchItem(COL.ITS, 'ITS') +
      swatchItem(COL.promoter, 'promoter') +
      swatchItem(COL.enhancer, 'enhancer') +
      swatchItem(COL.Repeat, 'Repeat'));

    /* FASTA derived tracks */
    html += lgroup('FASTA',
      swatchItem('rgba(74,127,181,0.65)', 'GC content (100 bp)') +
      swatchItem(BASE_COLORS[0], 'A') + swatchItem(BASE_COLORS[1], 'C') +
      swatchItem(BASE_COLORS[2], 'G') + swatchItem(BASE_COLORS[3], 'T'));

    /* SV */
    html += lgroup('SV structure (simplify_variation_structure)',
      swatchItem(COL.svSeg, 'alignment segment') +
      swatchItem(COL.svLink, 'jump to next segment'));

    document.getElementById('legend').innerHTML = html;
  }


  /* =================================================================
   * Global wiring
   * ================================================================= */
  function renderDrawn() {
    for (var i = 0; i < PANELS.length; i++) {
      if (PANELS[i].drawn) render(PANELS[i]);
    }
  }

  function init() {
    buildLegend();

    var host = document.getElementById('panels');
    var sel = document.getElementById('norSelect');
    var i, made, opt;

    for (i = 0; i < D.nors.length; i++) {
      made = createPanel(D.nors[i]);
      host.appendChild(made.el);
      opt = document.createElement('option');
      opt.value = made.p.id;
      opt.textContent = made.p.id;
      sel.appendChild(opt);
    }

    /* jump to a NOR */
    sel.addEventListener('change', function () {
      var target = document.getElementById('panel-' + sel.value);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('btnFitAll').addEventListener('click', function () {
      for (var k = 0; k < PANELS.length; k++) {
        PANELS[k].win[0] = 0;
        PANELS[k].win[1] = PANELS[k].nor.len;
        render(PANELS[k]);
        updateHead(PANELS[k]);
      }
    });

    var legend = document.getElementById('legend');
    var btnLegend = document.getElementById('btnLegend');
    btnLegend.textContent = legend.hidden ? 'Legend ▾' : 'Legend ▴';
    btnLegend.addEventListener('click', function () {
      legend.hidden = !legend.hidden;
      btnLegend.textContent = legend.hidden ? 'Legend ▾' : 'Legend ▴';
    });

    /* track group switches */
    var boxes = document.querySelectorAll('.toggles input[data-group]');
    for (i = 0; i < boxes.length; i++) {
      (function (box) {
        box.addEventListener('change', function () {
          var g = box.getAttribute('data-group');
          if (box.checked) delete hiddenGroups[g];
          else hiddenGroups[g] = true;
          renderDrawn();
        });
      })(boxes[i]);
    }

    /* lazy drawing: a panel is painted the first time it comes near the viewport */
    var paintVisible = function () {
      var vh = window.innerHeight || 900;
      for (var n = 0; n < PANELS.length; n++) {
        var box = PANELS[n].el.getBoundingClientRect();
        if (box.top < vh + 900 && box.bottom > -900) render(PANELS[n]);
      }
    };

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (!entries[e].isIntersecting) continue;
          var target = entries[e].target;
          for (var q = 0; q < PANELS.length; q++) {
            if (PANELS[q].el === target) { render(PANELS[q]); break; }
          }
        }
      }, { rootMargin: '900px 0px' });

      for (i = 0; i < PANELS.length; i++) io.observe(PANELS[i].el);
    } else {
      for (i = 0; i < PANELS.length; i++) render(PANELS[i]);
    }

    /* first paint, so the page is never blank while the observer catches up */
    paintVisible();

    /* keep the canvases in sync with the window width */
    var timer = null;
    window.addEventListener('resize', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(renderDrawn, 140);
    });

    if (PANELS.length) sel.value = PANELS[0].id;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

