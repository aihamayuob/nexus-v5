import { Errors } from '../../core/errors.js';
import type { RegisteredTool } from '../registry.js';

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const FUNCS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
};

/** Real recursive-descent parser — NOT eval(). Any character outside the allow-list is a syntax error before parsing even starts, so there is no code path from this input to arbitrary JS execution. */
export function evaluateMathExpression(expr: string): number {
  const s = String(expr).replace(/\s+/g, '');
  if (!s) throw Errors.toolValidation('تعبير فارغ.');
  if (!/^[0-9a-zA-Z+\-*/^().,]+$/.test(s)) throw Errors.toolValidation('التعبير يحتوي رموزاً غير مدعومة.');

  let pos = 0;
  const peek = () => s[pos];
  const next = () => s[pos++];

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = parsePower();
      if (op === '/' && rhs === 0) throw Errors.toolValidation('قسمة على صفر.');
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  function parsePower(): number {
    const base = parseUnary();
    if (peek() === '^') {
      next();
      return Math.pow(base, parsePower());
    }
    return base;
  }
  function parseUnary(): number {
    if (peek() === '-') {
      next();
      return -parseUnary();
    }
    if (peek() === '+') {
      next();
      return parseUnary();
    }
    return parseAtom();
  }
  function parseAtom(): number {
    if (peek() === '(') {
      next();
      const value = parseExpression();
      if (next() !== ')') throw Errors.toolValidation('قوس غير متطابق.');
      return value;
    }
    if (/[a-zA-Z]/.test(peek() ?? '')) {
      let name = '';
      while (/[a-zA-Z]/.test(peek() ?? '')) name += next();
      if (peek() === '(') {
        next();
        const args: number[] = [parseExpression()];
        while (peek() === ',') {
          next();
          args.push(parseExpression());
        }
        if (next() !== ')') throw Errors.toolValidation('قوس غير متطابق.');
        const fn = FUNCS[name];
        if (!fn) throw Errors.toolValidation(`دالة غير مدعومة: ${name}`);
        return fn(...args);
      }
      const c = CONSTS[name];
      if (c === undefined) throw Errors.toolValidation(`رمز غير معروف: ${name}`);
      return c;
    }
    let numStr = '';
    while (/[0-9.]/.test(peek() ?? '')) numStr += next();
    if (!numStr) throw Errors.toolValidation('تعبير غير صالح.');
    return parseFloat(numStr);
  }

  const result = parseExpression();
  if (pos < s.length) throw Errors.toolValidation('رموز زائدة بنهاية التعبير.');
  if (!Number.isFinite(result)) throw Errors.toolValidation('ناتج غير محدود (infinity/NaN).');
  return result;
}

export const calculateTool: RegisteredTool = {
  def: {
    name: 'calculate',
    description: 'احسب تعبيراً رياضياً بدقة كاملة.',
    input_schema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'التعبير الرياضي، مثلاً (1500 * 0.045) / 12' } },
      required: ['expression'],
    },
  },
  timeoutMs: 2_000,
  effectClass: { kind: 'pure', reason: 'حساب على نص المدخل فقط عبر parser يدوي (ليس eval)؛ لا شبكة ولا ملفات ولا حالة مشتركة.' },
  async execute(input) {
    const result = evaluateMathExpression(String(input.expression ?? ''));
    return String(result);
  },
};
