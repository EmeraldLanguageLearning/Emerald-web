/* Emerald Tools app bridge.
   Loaded first by every tool page. Inside the Android app (window.EmeraldAndroid exists) it:
   - provides window.speechSynthesis / SpeechSynthesisUtterance on top of Android text-to-speech,
   - makes window.print() use Android printing,
   - offers EmeraldApp.fetchText(url) for reads that browsers would block (CORS),
   - adds a Home button to each tool's header.
   In a normal browser it only defines EmeraldApp.inApp = false. */
(function () {
    var A = window.EmeraldAndroid;
    var App = window.EmeraldApp = { inApp: !!A };
    /* ---------- Google Sheets reader (app and browser) ----------
       Reads a sheet shared as "Anyone with the link: Viewer" through Google's visualization endpoint.
       In the app the text is fetched natively; in a browser it is loaded as JSONP (a script tag),
       which also works on old iPads. Resolves to { cols: [header labels], rows: [[cell text, ...], ...] }. */
    var sheetCb = 0;
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function cellText(c) {
        if (!c || c.v === null || c.v === undefined)
            return '';
        var v = c.v;
        // Sheets turns "0:45" into a time of day (0 h 45 min); the tools mean minutes:seconds.
        if (Object.prototype.toString.call(v) === '[object Array]') {
            var h = v[0] || 0, m = v[1] || 0, s = v[2] || 0;
            return s ? h + ':' + pad2(m) + ':' + pad2(s) : h + ':' + pad2(m);
        }
        if (typeof v === 'boolean')
            return v ? 'yes' : 'no';
        if (typeof v === 'string' && /^Date\(/.test(v))
            return c.f || v;
        if (typeof v === 'number')
            return c.f != null ? String(c.f) : String(v);
        return String(v);
    }
    function toTable(resp) {
        if (!resp || resp.status === 'error' || !resp.table)
            throw new Error('sheet');
        var t = resp.table;
        return {
            cols: (t.cols || []).map(function (c) { return String(c.label || ''); }),
            rows: (t.rows || []).map(function (r) { return (r.c || []).map(cellText); })
        };
    }
    App.sheet = function (id) {
        var base = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?headers=1&t=' + Date.now();
        if (App.fetchText) {
            return App.fetchText(base + '&tqx=out:json').then(function (txt) {
                var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
                return toTable(JSON.parse(txt.slice(a, b + 1)));
            });
        }
        return new Promise(function (resolve, reject) {
            var name = '__emeraldSheet' + (++sheetCb) + '_' + Date.now();
            var s = document.createElement('script');
            var timer = setTimeout(function () { done(); reject(new Error('timeout')); }, 15000);
            function done() { clearTimeout(timer); try {
                delete window[name];
            }
            catch (e) {
                window[name] = undefined;
            } if (s.parentNode)
                s.parentNode.removeChild(s); }
            window[name] = function (resp) { done(); try {
                resolve(toTable(resp));
            }
            catch (e) {
                reject(e);
            } };
            s.onerror = function () { done(); reject(new Error('network')); };
            s.src = base + '&tqx=out:json;responseHandler:' + name;
            (document.head || document.documentElement).appendChild(s);
        });
    };
    if (!A)
        return;
    document.documentElement.classList.add('in-app');
    /* ---------- network reads ---------- */
    var fetchCb = {}, fetchId = 0;
    window.__emeraldFetch = function (id, ok, body) { var cb = fetchCb[id]; delete fetchCb[id]; if (cb)
        cb(ok, body); };
    App.fetchText = function (url) {
        return new Promise(function (resolve, reject) {
            var id = 'f' + (++fetchId);
            fetchCb[id] = function (ok, body) { ok ? resolve(body) : reject(new Error(body || 'network')); };
            A.fetchText(id, url);
        });
    };
    App.open = function (url) { A.open(url); };
    /* ---------- speech ---------- */
    // Known Google TTS voice codes, so tools that pick a male/female voice can tell them apart.
    var GENDER = { gba: 'female', gbb: 'male', gbc: 'female', gbd: 'male', gbg: 'female', rjs: 'male',
        iob: 'female', iog: 'female', iol: 'male', iom: 'male', sfg: 'female', tpc: 'female', tpd: 'male', tpf: 'female' };
    var REGION = { GB: 'UK', US: 'US', AU: 'Australia', IN: 'India', IE: 'Ireland', CA: 'Canada', NG: 'Nigeria', ZA: 'South Africa' };
    var voices = [], loaded = false;
    function loadVoices() {
        try {
            var raw = JSON.parse(A.voices() || '[]');
            voices = raw.map(function (v, i) {
                var m = /x-([a-z]{3})/i.exec(v.id), g = m && GENDER[m[1].toLowerCase()];
                var reg = (v.lang.split('-')[1] || '').toUpperCase();
                var name = 'English ' + (REGION[reg] || reg) + ' ' + (m ? m[1].toUpperCase() : (i + 1)) + (g ? ' (' + g + ')' : '') + (v.local ? '' : ' · online');
                return { name: name, lang: v.lang, localService: !!v.local, default: false, voiceURI: v.id };
            });
            loaded = voices.length > 0;
        }
        catch (e) {
            voices = [];
        }
        return voices;
    }
    function Utterance(text) {
        this.text = text == null ? '' : String(text);
        this.lang = '';
        this.voice = null;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.onstart = this.onend = this.onerror = this.onboundary = this.onpause = this.onresume = this.onmark = null;
        this._l = {};
    }
    Utterance.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
    Utterance.prototype.removeEventListener = function (t, f) { var a = this._l[t] || []; var i = a.indexOf(f); if (i >= 0)
        a.splice(i, 1); };
    function fire(target, type, ev) {
        ev = ev || { type: type };
        ev.type = type;
        ev.target = target;
        try {
            if (typeof target['on' + type] === 'function')
                target['on' + type](ev);
        }
        catch (e) {
            setTimeout(function () { throw e; });
        }
        (target._l && target._l[type] || []).slice().forEach(function (f) { try {
            f(ev);
        }
        catch (e) {
            setTimeout(function () { throw e; });
        } });
    }
    var queue = [], current = null, uid = 0, pending = {};
    var synth = {
        speaking: false, pending: false, paused: false, onvoiceschanged: null, _l: {},
        getVoices: function () { if (!loaded)
            loadVoices(); return voices.slice(); },
        speak: function (u) { queue.push(u); synth.pending = queue.length > 0; if (!current)
            next(); },
        cancel: function () { queue = []; pending = {}; current = null; synth.speaking = synth.pending = false; A.stop(); },
        pause: function () { }, resume: function () { },
        addEventListener: function (t, f) { (synth._l[t] = synth._l[t] || []).push(f); },
        removeEventListener: function (t, f) { var a = synth._l[t] || []; var i = a.indexOf(f); if (i >= 0)
            a.splice(i, 1); }
    };
    function next() {
        current = queue.shift() || null;
        synth.pending = queue.length > 0;
        if (!current) {
            synth.speaking = false;
            return;
        }
        var id = 'u' + (++uid), u = current;
        pending[id] = u;
        synth.speaking = true;
        var lang = (u.voice && u.voice.lang) || u.lang || document.documentElement.lang || 'en-GB';
        if (!/^en/i.test(lang))
            lang = 'en-GB';
        A.speak(id, u.text, lang, u.voice ? u.voice.voiceURI : '', +u.rate || 1, +u.pitch || 1);
    }
    window.__emeraldTTS = function (id, type) {
        var u = pending[id];
        if (!u)
            return;
        if (type === 'start') {
            fire(u, 'start', { utterance: u, charIndex: 0, elapsedTime: 0 });
            return;
        }
        delete pending[id];
        if (current === u)
            current = null;
        fire(u, type === 'done' ? 'end' : 'error', { utterance: u, charIndex: 0, elapsedTime: 0, error: 'synthesis-failed' });
        if (!current)
            next();
    };
    window.__emeraldVoices = function () { loadVoices(); fire(synth, 'voiceschanged'); };
    try {
        Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
    }
    catch (e) {
        window.speechSynthesis = synth;
    }
    try {
        Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true, writable: true });
    }
    catch (e) {
        window.SpeechSynthesisUtterance = Utterance;
    }
    loadVoices();
    /* ---------- printing ---------- */
    window.print = function () { A.print(document.title || 'Emerald'); };
    /* ---------- Home button in each tool header ---------- */
    function lang() { try {
        return localStorage.getItem('ell-lang') === 'en' ? 'en' : 'fr';
    }
    catch (e) {
        return 'fr';
    } }
    document.addEventListener('DOMContentLoaded', function () {
        if (/(^|\/)index\.html$/.test(location.pathname) || /\/assets\/$/.test(location.pathname))
            return;
        var css = document.createElement('style');
        css.textContent = '.app-home{display:inline-flex;align-items:center;gap:6px;font:600 .85rem "Open Sans",sans-serif;color:#457865;background:#fff;border:1px solid #49B190;border-radius:4px;padding:7px 12px;text-decoration:none;cursor:pointer;margin-right:10px}' +
            '.app-home:hover{background:#e9f6f1}.app-home svg{width:16px;height:16px;flex:none}.app-right{display:flex;align-items:center;gap:0;flex:none}' +
            '@media (max-width:440px){.app-home span{display:none}.app-home{padding:7px 9px;margin-right:6px}}';
        document.head.appendChild(css);
        var header = document.querySelector('.site-in');
        if (!header)
            return;
        var a = document.createElement('a');
        a.href = 'index.html';
        a.className = 'app-home';
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg><span></span>';
        var label = a.querySelector('span');
        var setLabel = function () { var en = document.documentElement.lang === 'en' || !document.querySelector('.lang'); label.textContent = en ? 'Home' : 'Accueil'; a.setAttribute('aria-label', label.textContent); a.title = label.textContent; };
        setLabel();
        var lg = header.querySelector('.lang');
        if (lg) {
            var wrap = document.createElement('div');
            wrap.className = 'app-right';
            lg.parentNode.insertBefore(wrap, lg);
            wrap.appendChild(a);
            wrap.appendChild(lg);
            new MutationObserver(setLabel).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        }
        else
            header.appendChild(a);
        var logo = header.querySelector('.brand-logo');
        if (logo) {
            logo.style.cursor = 'pointer';
            logo.addEventListener('click', function () { location.href = 'index.html'; });
        }
    });
})();
