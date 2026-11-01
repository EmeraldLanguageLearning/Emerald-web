/* Emerald Tools (web): helps older iPads (Safari 10.3 to 14) show the tools correctly.
   Adds a few missing JavaScript methods and replaces CSS that old Safari ignores:
   spacing between items (flex "gap"), headings sized with clamp(), grid gaps. */
(function(){
  var AP = Array.prototype;
  function def(o, k, v){ if(!o[k]) try{ Object.defineProperty(o, k, { value: v, configurable: true, writable: true }); }catch(e){ o[k] = v; } }
  def(AP, 'flat', function(d){ d = d === undefined ? 1 : d; return AP.reduce.call(this, function(a, v){ return a.concat(Array.isArray(v) && d > 0 ? AP.flat.call(v, d - 1) : [v]); }, []); });
  def(AP, 'flatMap', function(f, t){ return AP.concat.apply([], AP.map.call(this, f, t)); });
  def(Object, 'fromEntries', function(it){ var o = {}; AP.forEach.call(Array.from(it), function(p){ o[p[0]] = p[1]; }); return o; });
  if(typeof Promise !== 'undefined') def(Promise.prototype, 'finally', function(f){
    return this.then(function(v){ return Promise.resolve(f()).then(function(){ return v; }); },
                     function(e){ return Promise.resolve(f()).then(function(){ throw e; }); });
  });
  if(window.NodeList) def(NodeList.prototype, 'forEach', AP.forEach);

  function supports(p, v){ try{ return window.CSS && CSS.supports(p, v); }catch(e){ return false; } }
  function flexGapWorks(){
    var d = document.createElement('div');
    d.style.display = 'flex'; d.style.flexDirection = 'column'; d.style.rowGap = '1px';
    d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));
    document.body.appendChild(d); var ok = d.scrollHeight === 1; document.body.removeChild(d); return ok;
  }
  function children(sel){ return sel.split(',').map(function(s){ return s.trim() + ' > *'; }).join(','); }
  function gapParts(v){ var p = v.trim().split(/\s+/); return { row: p[0], col: p[1] || p[0] }; }
  function half(v){ return /^0(px)?$/.test(v) ? '0' : 'calc(' + v + ' / 2)'; }

  function run(){
    var force = window.__emeraldForceLegacy === true;   // testing only
    var noFlexGap = force || !flexGapWorks(), noGridGap = force || !supports('gap', '1px'), noClamp = force || !supports('width', 'clamp(1px, 1px, 1px)');
    if(!noFlexGap && !noGridGap && !noClamp) return;
    var out = [];
    var styles = document.querySelectorAll('style');
    for(var i = 0; i < styles.length; i++){
      var css = styles[i].textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      var re = /([^{}@;]+)\{([^{}]*)\}/g, m;
      while((m = re.exec(css))){
        var sel = m[1].trim(), body = m[2];
        if(!sel || /^(from|to|\d+%)/.test(sel)) continue;
        var g = /(?:^|;)\s*gap\s*:\s*([^;!]+)/.exec(body), rg = /row-gap\s*:\s*([^;!]+)/.exec(body), cg = /column-gap\s*:\s*([^;!]+)/.exec(body);
        if(g || rg || cg){
          var gp = g ? gapParts(g[1]) : { row: rg ? rg[1].trim() : '0', col: cg ? cg[1].trim() : '0' };
          if(/display\s*:\s*(inline-)?grid/.test(body)){ if(noGridGap) out.push(sel + '{grid-gap:' + gp.row + ' ' + gp.col + '}'); }
          else if(noFlexGap) out.push(children(sel) + '{margin:' + half(gp.row) + ' ' + half(gp.col) + '}');
        }
        if(noClamp){
          var c = /font-size\s*:\s*clamp\(([^;]+)\)/.exec(body);
          if(c){ var parts = c[1].split(','); out.push(sel + '{font-size:' + parts[parts.length - 1].trim() + '}'); }
        }
      }
    }
    if(out.length){ var st = document.createElement('style'); st.textContent = out.join('\n'); document.head.appendChild(st); }
    if(noFlexGap) fixInline(document);
    if(noFlexGap && window.MutationObserver){
      var t = null;
      new MutationObserver(function(){ clearTimeout(t); t = setTimeout(function(){ fixInline(document); }, 30); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }
  // gap written in style="" attributes of elements the tools create
  function fixInline(root){
    var els = root.querySelectorAll('[style*="gap"]');
    for(var i = 0; i < els.length; i++){
      var m = /(?:^|;)\s*gap\s*:\s*([^;]+)/.exec(els[i].getAttribute('style') || ''); if(!m) continue;
      var gp = gapParts(m[1]), kids = els[i].children;
      for(var k = 0; k < kids.length; k++) kids[k].style.margin = half(gp.row) + ' ' + half(gp.col);
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
