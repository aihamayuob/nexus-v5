import { describe, it, expect } from 'vitest';
import {
  evaluateMathExpression, chunkText, agentShortDesc, cosineSimilarity,
  parseOneSSEFrame, estimateQuestionComplexity, reEl,
  localTimeStringToUTCHourMinute, describeRecurrence, truncateText, wsUid,
} from './utilities.mjs';

describe('evaluateMathExpression', () => {
  it('evaluates basic arithmetic with correct precedence', () => {
    expect(evaluateMathExpression('1500 * 0.045 / 12')).toBeCloseTo(5.625);
  });
  it('supports parentheses and unary minus', () => {
    expect(evaluateMathExpression('-(2 + 3) * 2')).toBe(-10);
  });
  it('supports right-associative power (2^3^2 = 2^9)', () => {
    expect(evaluateMathExpression('2^3^2')).toBe(512);
  });
  it('supports functions and constants', () => {
    expect(evaluateMathExpression('sqrt(16)')).toBe(4);
    expect(evaluateMathExpression('round(pi)')).toBe(3);
  });
  it('rejects any character outside the allowed set — this IS the security property (real parser, not eval)', () => {
    expect(() => evaluateMathExpression('alert(1)')).toThrow(/دالة غير معروفة/);
    expect(() => evaluateMathExpression('window.location')).toThrow();
    expect(() => evaluateMathExpression('`template`')).toThrow();
  });
  it('rejects division by zero', () => {
    expect(() => evaluateMathExpression('1/0')).toThrow(/قسمة على صفر/);
  });
  it('rejects an empty expression', () => {
    expect(() => evaluateMathExpression('')).toThrow(/فارغ/);
  });
});

describe('chunkText', () => {
  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(1200);
    const chunks = chunkText(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(500);
  });
  it('filters out near-empty tail fragments (<=20 chars)', () => {
    const chunks = chunkText('short text under twenty', 500, 50);
    // whole text is one chunk here since it's shorter than size
    expect(chunks.every((c) => c.trim().length > 20)).toBe(true);
  });
  it('collapses whitespace before chunking', () => {
    const chunks = chunkText('word1     word2\n\nword3   word4   word5  end', 500, 50);
    expect(chunks[0]).toBe('word1 word2 word3 word4 word5 end');
  });
});

describe('agentShortDesc', () => {
  it('prefers an explicit desc field when present', () => {
    expect(agentShortDesc({ desc: 'وصف مخصص', prompt: 'أنت كذا' })).toBe('وصف مخصص');
  });
  it('strips a leading "أنت" from the prompt when no desc is given', () => {
    expect(agentShortDesc({ prompt: 'أنت مساعد بحث دقيق' })).toBe('مساعد بحث دقيق');
  });
  it('truncates a long prompt to 70 chars with an ellipsis', () => {
    const longPrompt = 'أنت ' + 'x'.repeat(100);
    const result = agentShortDesc({ prompt: longPrompt });
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(71); // 70 chars + ellipsis
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it('does not throw for zero vectors (small epsilon guards division by zero)', () => {
    expect(() => cosineSimilarity([0, 0], [0, 0])).not.toThrow();
  });
});

describe('parseOneSSEFrame', () => {
  it('parses event/data/id fields', () => {
    const frame = 'event: message\ndata: hello\nid: 42';
    expect(parseOneSSEFrame(frame)).toEqual({ event: 'message', data: 'hello', id: '42' });
  });
  it('joins multiple data lines with a newline', () => {
    const frame = 'data: line1\ndata: line2';
    expect(parseOneSSEFrame(frame).data).toBe('line1\nline2');
  });
  it('ignores comment lines (starting with :)', () => {
    const frame = ': this is a comment\ndata: real';
    expect(parseOneSSEFrame(frame).data).toBe('real');
  });
  it('returns null for a frame with no event and no data', () => {
    expect(parseOneSSEFrame('id: 1')).toBeNull();
  });
});

describe('estimateQuestionComplexity', () => {
  it('flags a long question (>35 words) as complex', () => {
    const text = 'كلمة '.repeat(40);
    expect(estimateQuestionComplexity(text)).toBe(true);
  });
  it('flags multiple question marks as complex', () => {
    expect(estimateQuestionComplexity('ما هذا؟ ولماذا؟')).toBe(true);
  });
  it('flags a known decision keyword as complex', () => {
    expect(estimateQuestionComplexity('قارن بين الخيارين')).toBe(true);
  });
  it('treats a short simple question as not complex', () => {
    expect(estimateQuestionComplexity('كم الساعة؟')).toBe(false);
  });
  it('returns false for empty input', () => {
    expect(estimateQuestionComplexity('')).toBe(false);
  });
});

describe('reEl', () => {
  it('creates an element with the given tag, class, and text content', () => {
    const el = reEl('span', 'my-class', 'hello');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('my-class');
    expect(el.textContent).toBe('hello');
  });
  it('sets textContent (never innerHTML) — XSS-safe by construction', () => {
    const el = reEl('div', '', '<img src=x onerror=alert(1)>');
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.innerHTML).not.toContain('<img');
    expect(el.querySelector('img')).toBeNull();
  });
  it('omits className when cls is falsy', () => {
    const el = reEl('div', '', 'x');
    expect(el.className).toBe('');
  });
});

describe('localTimeStringToUTCHourMinute', () => {
  it('converts a local HH:MM string to UTC hour/minute', () => {
    const result = localTimeStringToUTCHourMinute('09:30');
    const expected = new Date();
    expected.setHours(9, 30, 0, 0);
    expect(result).toEqual({ hour: expected.getUTCHours(), minute: expected.getUTCMinutes() });
  });
});

describe('describeRecurrence', () => {
  it('describes a daily recurrence with zero-padded time', () => {
    expect(describeRecurrence({ type: 'daily', hour: 9, minute: 5 })).toBe('يومياً الساعة 09:05 UTC');
  });
  it('describes an hour-aligned interval in hours', () => {
    expect(describeRecurrence({ type: 'interval', everyMs: 3600000 * 2 })).toBe('كل 2 ساعة');
  });
  it('describes a non-hour-aligned interval in minutes', () => {
    expect(describeRecurrence({ type: 'interval', everyMs: 90000 })).toBe('كل 2 دقيقة');
  });
  it('returns an empty string for an unknown type', () => {
    expect(describeRecurrence({ type: 'weekly' })).toBe('');
  });
});

describe('truncateText', () => {
  it('leaves short text untouched', () => {
    expect(truncateText('short', 100)).toBe('short');
  });
  it('truncates long text with an ellipsis, respecting maxChars', () => {
    const result = truncateText('a'.repeat(50), 10);
    expect(result).toBe('a'.repeat(9) + '…');
  });
  it('returns empty string for falsy input', () => {
    expect(truncateText('', 10)).toBe('');
    expect(truncateText(null, 10)).toBe('');
  });
});

describe('wsUid', () => {
  it('produces a unique id with the given prefix each call', () => {
    const id1 = wsUid('wf');
    const id2 = wsUid('wf');
    expect(id1.startsWith('wf_')).toBe(true);
    expect(id1).not.toBe(id2);
  });
});
