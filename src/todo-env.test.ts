import { afterEach, describe, expect, it } from 'vitest';

import { todoEnvArgs } from './todo-env.js';

describe('todoEnvArgs', () => {
  const originalUrl = process.env.TODO_API_URL;
  const originalKey = process.env.TODO_API_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.TODO_API_URL;
    else process.env.TODO_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.TODO_API_KEY;
    else process.env.TODO_API_KEY = originalKey;
  });

  it('returns nothing when unset', () => {
    delete process.env.TODO_API_URL;
    delete process.env.TODO_API_KEY;
    expect(todoEnvArgs()).toEqual([]);
  });

  it('forwards TODO_API_URL when set', () => {
    process.env.TODO_API_URL = 'http://host.docker.internal:8787';
    delete process.env.TODO_API_KEY;
    expect(todoEnvArgs()).toEqual(['-e', 'TODO_API_URL=http://host.docker.internal:8787']);
  });

  it('forwards both when set', () => {
    process.env.TODO_API_URL = 'http://host.docker.internal:8787';
    process.env.TODO_API_KEY = 'secret';
    expect(todoEnvArgs()).toEqual(['-e', 'TODO_API_URL=http://host.docker.internal:8787', '-e', 'TODO_API_KEY=secret']);
  });
});
