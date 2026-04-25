import { AppController } from './app.controller';

describe('AppController', () => {
  it('returns health status', () => {
    expect(new AppController().health()).toEqual({ status: 'ok' });
  });
});
