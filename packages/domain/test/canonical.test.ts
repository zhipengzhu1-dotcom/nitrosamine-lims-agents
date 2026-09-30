import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalText, type Canon } from '../src/canonical.ts';

describe('canonicalText', () => {
  it('has no number in its type, and refuses one a cast smuggled in', () => {
    // @ts-expect-error a number never reaches signed content; quantities are decimal strings
    expect(() => canonicalText({ weight: 100.12 })).toThrow(/not canonical/);
    // @ts-expect-error nor inside an array
    expect(() => canonicalText(['1', 2])).toThrow(/not canonical/);
    // @ts-expect-error nor a bigint
    expect(() => canonicalText({ count: 3n })).toThrow(/not canonical/);
    // @ts-expect-error nor an absent field spelled undefined
    expect(() => canonicalText({ note: undefined })).toThrow(/not canonical/);
    const ok: Canon = { weight: '100.12', count: '3', ok: true, none: null, list: ['a'] };
    expect(canonicalText(ok)).toBe('{"count":"3","list":["a"],"none":null,"ok":true,"weight":"100.12"}');
  });

  it('sorts keys by UTF-16 code units at every depth, whatever the insertion order (RFC 8785 §3.2.3)', () => {
    const input: Canon = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    expect(canonicalText(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",' +
      '"€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
    expect(canonicalText({ b: { z: '1', a: '2' }, a: [{ y: '1', x: '2' }] }))
      .toBe('{"a":[{"x":"2","y":"1"}],"b":{"a":"2","z":"1"}}');
  });

  it('escapes strings as RFC 8785 §3.2.2.2 does', () => {
    const input: Canon = {
      string: '€$\u000F\nA\'B"\\\\"/', // the RFC's input, decoded
      literals: [null, true, false],
    };
    expect(canonicalText(input)).toBe('{"literals":[null,true,false],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });

  it.each([
    ['\b\f\n\r\t', '"\\b\\f\\n\\r\\t"'],
    ['\u0000\u001f', '"\\u0000\\u001f"'],
    ['\u007f', '"\u007f"'],
    ['/', '"/"'],
  ])('escapes control characters in %j with the short forms, else lowercase \\u00xx', (s, expected) => {
    expect(canonicalText(s)).toBe(expected);
  });

  it('refuses a string that is not well-formed UTF-16, since its bytes are not defined', () => {
    expect(() => canonicalText({ bad: '\ud800' })).toThrow(/not well-formed/);
  });

  it('keeps array order and emits no whitespace', () => {
    expect(canonicalText([' b', 'a', ['c', true]])).toBe('[" b","a",["c",true]]');
  });
});

describe('canonicalBytes', () => {
  it('is the UTF-8 encoding of the canonical text', () => {
    expect(Array.from(canonicalBytes({ e: '€' }))).toEqual([0x7b, 0x22, 0x65, 0x22, 0x3a, 0x22, 0xe2, 0x82, 0xac, 0x22, 0x7d]);
  });
});
