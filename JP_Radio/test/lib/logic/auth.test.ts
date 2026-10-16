import { createLoginAccount } from '@/logic/auth';

describe('createLoginAccount', () => {
  it('user/passが両方有効ならLoginAccountを返す', () => {
    expect(createLoginAccount('user@example.com', 'pass1234')).toEqual({
      mail: 'user@example.com',
      pass: 'pass1234',
    });
  });

  it('radikoUserが未指定ならnull', () => {
    expect(createLoginAccount(undefined, 'pass1234')).toBeNull();
  });

  it('radikoPassが未指定ならnull', () => {
    expect(createLoginAccount('user@example.com', undefined)).toBeNull();
  });

  it('radikoUserが空文字ならnull', () => {
    expect(createLoginAccount('', 'pass1234')).toBeNull();
  });

  it('radikoPassが空文字ならnull', () => {
    expect(createLoginAccount('user@example.com', '')).toBeNull();
  });

  it('両方未指定ならnull', () => {
    expect(createLoginAccount(undefined, undefined)).toBeNull();
  });
});
