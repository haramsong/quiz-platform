import { describe, test, expect } from 'vitest';
import { publicBase, rewriteToPublic, buildLinks } from './links.js';

const loc = (href) => new URL(href); // URL has hostname/protocol/origin

describe('publicBase', () => {
  test('CloudFront domain → null (use backend link)', () => {
    expect(publicBase(loc('https://d123abc.cloudfront.net/'))).toBeNull();
  });

  test('quiz-master.<rest> → quiz.<rest>', () => {
    expect(publicBase(loc('https://quiz-master.example.com/'))).toBe('https://quiz.example.com');
    expect(publicBase(loc('https://quiz-master.foo.co.kr/path'))).toBe('https://quiz.foo.co.kr');
  });

  test('preserves protocol', () => {
    expect(publicBase(loc('http://quiz-master.example.com/'))).toBe('http://quiz.example.com');
  });

  test('other custom domain → current origin', () => {
    expect(publicBase(loc('https://console.example.com/'))).toBe('https://console.example.com');
  });

  test('null location → null', () => {
    expect(publicBase(null)).toBeNull();
  });
});

describe('rewriteToPublic', () => {
  test('CloudFront → url unchanged', () => {
    const url = 'https://d123abc.cloudfront.net/play?code=ABCD';
    expect(rewriteToPublic(url, loc('https://d123abc.cloudfront.net/'))).toBe(url);
  });

  test('custom quiz-master → origin swapped, path+query kept', () => {
    const url = 'https://d123abc.cloudfront.net/play?code=ABCD';
    expect(rewriteToPublic(url, loc('https://quiz-master.example.com/')))
      .toBe('https://quiz.example.com/play?code=ABCD');
  });

  test('non-absolute url left untouched', () => {
    expect(rewriteToPublic('/play?code=X', loc('https://quiz-master.example.com/')))
      .toBe('/play?code=X');
  });
});

describe('buildLinks', () => {
  test('CloudFront → returns backend-provided URLs', () => {
    const backend = { participantUrl: 'https://cdn.cloudfront.net/play?code=ABCD', hostUrl: 'https://cdn.cloudfront.net/host?code=ABCD' };
    const r = buildLinks('ABCD', backend, loc('https://cdn.cloudfront.net/'));
    expect(r).toEqual(backend);
  });

  test('custom domain → builds from code on the quiz. base', () => {
    const r = buildLinks('ABCD', {}, loc('https://quiz-master.example.com/'));
    expect(r.participantUrl).toBe('https://quiz.example.com/play?code=ABCD');
    expect(r.hostUrl).toBe('https://quiz.example.com/host?code=ABCD');
  });

  test('encodes the code', () => {
    const r = buildLinks('A B', {}, loc('https://quiz-master.example.com/'));
    expect(r.participantUrl).toBe('https://quiz.example.com/play?code=A%20B');
  });

  test('CloudFront with missing backend urls → empty strings', () => {
    const r = buildLinks('ABCD', {}, loc('https://cdn.cloudfront.net/'));
    expect(r).toEqual({ participantUrl: '', hostUrl: '' });
  });
});
