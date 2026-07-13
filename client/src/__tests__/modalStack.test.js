import { describe, it, expect } from 'vitest';
import {
  parseModalStack,
  buildModalSearch,
  stackToSearchString,
  MODAL_PARAM_KEYS,
} from '../modalStack.js';

describe('parseModalStack', () => {
  it('returns empty array for empty params', () => {
    expect(parseModalStack(new URLSearchParams(''))).toEqual([]);
  });

  it('parses single modal with no params', () => {
    expect(parseModalStack(new URLSearchParams('modal=scanner'))).toEqual([
      { type: 'scanner', params: {} },
    ]);
  });

  it('parses single modal with a param', () => {
    expect(
      parseModalStack(new URLSearchParams('modal=bin-details&binId=123')),
    ).toEqual([{ type: 'bin-details', params: { binId: '123' } }]);
  });

  it('parses two-layer modal stack', () => {
    expect(
      parseModalStack(
        new URLSearchParams('modal=bin-details&binId=1&modal=item-details&itemId=2'),
      ),
    ).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: '2' } },
    ]);
  });

  it('parses three-layer stack with correct index association', () => {
    expect(
      parseModalStack(
        new URLSearchParams(
          'modal=bin-details&binId=1&modal=add-item&binId=1&modal=item-details&itemId=2',
        ),
      ),
    ).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'add-item', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: '2' } },
    ]);
  });

  it('filters unknown modal types', () => {
    expect(
      parseModalStack(new URLSearchParams('modal=unknown&modal=scanner')),
    ).toEqual([{ type: 'scanner', params: {} }]);
  });
});

describe('buildModalSearch', () => {
  it('round-trips a single-layer stack', () => {
    const stack = [{ type: 'bin-details', params: { binId: 'x' } }];
    const sp = buildModalSearch(stack);
    expect(parseModalStack(sp)).toEqual(stack);
  });

  it('round-trips a two-layer stack', () => {
    const stack = [
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: '2' } },
    ];
    const sp = buildModalSearch(stack);
    expect(parseModalStack(sp)).toEqual(stack);
  });
});

describe('stackToSearchString', () => {
  it('returns ?modal=scanner for a scanner modal', () => {
    expect(stackToSearchString([{ type: 'scanner', params: {} }])).toBe(
      '?modal=scanner',
    );
  });

  it('returns empty string for empty stack', () => {
    expect(stackToSearchString([])).toBe('');
  });
});
