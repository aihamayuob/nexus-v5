/* ==========================================================================
   modules/utilities.mjs — Neural Nexus AI Agents

   Phase 2 (/nexus-modularize), extraction boundary #3: "utilities".
   Behavior-preserving MOVE — every body below is byte-identical to its
   prior inline definition (diff-verified, see PHASE2-MODULARIZE.md).

   General-purpose, domain-agnostic pure helpers only: text/math/time
   utilities and one tiny DOM-element constructor (reEl). Deliberately
   excludes the settings getters (getBackendUrl, isToolsEnabled, etc.),
   UI chrome helpers (closeModal, showToast, streaming-bubble helpers),
   and domain-specific renderers (DAG/thought-tree/synthesis/veto) found
   in the same leaf-function scan — those belong to later boundaries
   ("storage"-adjacent settings, "UI", and "ops-center"/"modes"
   respectively) and mixing them in here would blur what "utilities"
   means as a category, not just add convenient extra exports. See
   PHASE2-MODULARIZE.md's boundary-3 section for the full candidate list
   and this categorization.

   All 11 confirmed (before extraction): zero dependencies on other
   top-level functions/state, zero references from any of the 168 inline
   HTML event-handler attributes, zero true top-level (execute-
   immediately) call sites, and zero references from autoInitApp() or the
   other four startup-sequence functions main.js now orchestrates.
   ========================================================================== */

// Executes a CLIENT tool locally (server tools like web_search never reach
// here — Anthropic executes those itself). Returns a string fed back to
// the model as the tool_result so it can compose its final reply.
// Real recursive-descent parser — NOT eval(). Supports + - * / ^ (),
// unary minus, sqrt/sin/cos/tan/log/ln/abs/round/floor/ceil/min/max,
// and constants pi/e. Any character outside [0-9a-zA-Z+\-*/^().,] is
// rejected before parsing even starts, so arbitrary JS syntax (property
// access, method calls, template literals, etc.) is a plain syntax
// error here, never something that could execute.
export function evaluateMathExpression(expr){
  const CONSTS = { pi: Math.PI, e: Math.E };
  const FUNCS = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    log: Math.log10, ln: Math.log, abs: Math.abs,
    round: Math.round, floor: Math.floor, ceil: Math.ceil,
    min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  };

  const s = String(expr).replace(/\s+/g, '');
  if(!s) throw new Error('تعبير فارغ');
  if(!/^[0-9a-zA-Z+\-*/^().,]+$/.test(s)) throw new Error('التعبير يحتوي رموزاً غير مدعومة');

  let pos = 0;
  function peek(){ return s[pos]; }
  function error(msg){ throw new Error(msg + ' (عند الموضع ' + pos + ' في "' + s + '")'); }

  function parseExpr(){
    let value = parseTerm();
    while(peek() === '+' || peek() === '-'){
      const op = s[pos++];
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(){
    let value = parsePower();
    while(peek() === '*' || peek() === '/'){
      const op = s[pos++];
      const rhs = parsePower();
      if(op === '/'){
        if(rhs === 0) error('قسمة على صفر');
        value = value / rhs;
      } else value = value * rhs;
    }
    return value;
  }
  function parsePower(){
    const base = parseUnary();
    if(peek() === '^'){
      pos++;
      const exp = parsePower(); // right-associative: 2^3^2 = 2^(3^2)
      return Math.pow(base, exp);
    }
    return base;
  }
  function parseUnary(){
    if(peek() === '-'){ pos++; return -parseUnary(); }
    if(peek() === '+'){ pos++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(){
    if(peek() === '('){
      pos++;
      const value = parseExpr();
      if(peek() !== ')') error('قوس إغلاق مفقود');
      pos++;
      return value;
    }
    if(/[0-9.]/.test(peek() || '')){
      const start = pos;
      while(pos < s.length && /[0-9.eE]/.test(s[pos])){
        pos++;
        if((s[pos] === '+' || s[pos] === '-') && /[eE]/.test(s[pos-1])) pos++; // scientific notation, e.g. 1e-5
      }
      const numStr = s.slice(start, pos);
      const num = Number(numStr);
      if(Number.isNaN(num)) error('رقم غير صالح: ' + numStr);
      return num;
    }
    if(/[a-zA-Z]/.test(peek() || '')){
      const start = pos;
      while(pos < s.length && /[a-zA-Z]/.test(s[pos])) pos++;
      const name = s.slice(start, pos);
      if(peek() === '('){
        pos++;
        const args = [parseExpr()];
        while(peek() === ','){ pos++; args.push(parseExpr()); }
        if(peek() !== ')') error('قوس إغلاق مفقود للدالة ' + name);
        pos++;
        if(!FUNCS[name]) error('دالة غير معروفة: ' + name);
        return FUNCS[name](...args);
      }
      if(Object.prototype.hasOwnProperty.call(CONSTS, name)) return CONSTS[name];
      error('رمز غير معروف: ' + name);
    }
    error('تعبير غير صالح عند: ' + (peek() || '(نهاية النص)'));
  }

  const result = parseExpr();
  if(pos !== s.length) error('رموز زائدة بعد نهاية التعبير الصالح: ' + s.slice(pos));
  if(!Number.isFinite(result)) error('الناتج غير محدود (لانهاية أو NaN) — تحقق من التعبير');
  return result;
}
export function chunkText(text, size=500, overlap=50){
  const chunks = [];
  let start = 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  while(start < cleaned.length){
    chunks.push(cleaned.slice(start, start + size));
    start += (size - overlap);
  }
  return chunks.filter(c => c.trim().length > 20); // skip near-empty tail fragments
}
export function agentShortDesc(agent){
  if(agent.desc) return agent.desc;
  const text = agent.prompt.replace(/^أنت\s*/, '').trim();
  return text.length > 70 ? text.slice(0, 70) + '…' : text;
}
export function cosineSimilarity(a, b){
  let dot = 0, na = 0, nb = 0;
  for(let i = 0; i < a.length; i++){ dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
export function parseOneSSEFrame(raw){
  const lines = raw.split('\n');
  let event = null, id = null;
  const dataLines = [];
  for (const line of lines){
    if (line === '' || line.startsWith(':')) continue;
    const sep = line.indexOf(':');
    const field = sep === -1 ? line : line.slice(0, sep);
    let value = sep === -1 ? '' : line.slice(sep+1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }
  if (dataLines.length === 0 && event === null) return null;
  return { event, data: dataLines.join('\n'), id };
}
export function estimateQuestionComplexity(text){
  if(!text) return false;
  const clean = text.trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const questionMarks = (clean.match(/[؟?]/g) || []).length;
  const decisionKeywords = ['قارن','مقارنة','أفضل','قرار','أقرر','أختار','استراتيجية','خطة','هل يجب','مقابل','خيار','مخاطر','جدوى','تحليل شامل','إيجابيات وسلبيات'];
  const hasDecisionKeyword = decisionKeywords.some(k => clean.includes(k));
  return wordCount > 35 || questionMarks > 1 || hasDecisionKeyword;
}
export function reEl(tag, cls, text){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  if(text != null) el.textContent = text;
  return el;
}
export function localTimeStringToUTCHourMinute(timeStr){
  // "09:30" from <input type="time"> is the user's local wall-clock time;
  // the backend's daily recurrence stores UTC hour/minute (see
  // scheduler/store.ts computeNextRun), so it's converted once here
  // rather than asking the user to do timezone math themselves.
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
export function describeRecurrence(r){
  if(r.type === 'daily') return `يومياً الساعة ${String(r.hour).padStart(2,'0')}:${String(r.minute).padStart(2,'0')} UTC`;
  if(r.type === 'interval') return `كل ${r.everyMs % 3600000 === 0 ? (r.everyMs/3600000)+' ساعة' : Math.round(r.everyMs/60000)+' دقيقة'}`;
  if(r.type === 'once') return `مرة واحدة: ${new Date(r.at).toLocaleString('ar')}`;
  return '';
}
export function truncateText(str, maxChars){
  if(!str) return '';
  return str.length > maxChars ? str.slice(0, maxChars-1) + '…' : str;
}
export function wsUid(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
