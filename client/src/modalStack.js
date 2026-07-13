export const MODAL_PARAM_KEYS = {
  'bin-details': ['binId'],
  'item-details': ['itemId'],
  'create-bin': ['qrId'],
  'add-item': ['binId'],
  'scanner': [],
  'settings': [],
  'restore-points': [],
  'quick-add': [],
  'filters': [],
  'edit-item': ['itemId'],
  'batch-manage': ['binId'],
  'settings-warning': [],
  'settings-cloud': [],
  'restore-revert': [],
  'restore-cherry': [],
  'restore-details': [],
  'restore-multi': [],
};

export function parseModalStack(searchParams) {
  const types = searchParams.getAll('modal');
  const result = [];
  const counters = {};
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    if (!MODAL_PARAM_KEYS[type]) continue;
    const params = {};
    for (const key of MODAL_PARAM_KEYS[type]) {
      const all = searchParams.getAll(key);
      const idx = counters[key] || 0;
      if (idx < all.length) {
        params[key] = all[idx];
      }
      counters[key] = (counters[key] || 0) + 1;
    }
    result.push({ type, params });
  }
  return result;
}

export function buildModalSearch(stack) {
  const params = new URLSearchParams();
  for (const { type, params: layerParams } of stack) {
    if (!MODAL_PARAM_KEYS[type]) continue;
    params.append('modal', type);
    for (const key of MODAL_PARAM_KEYS[type]) {
      if (layerParams[key] !== undefined) {
        params.append(key, layerParams[key]);
      }
    }
  }
  return params;
}

export function stackToSearchString(stack) {
  const sp = buildModalSearch(stack);
  const str = sp.toString();
  return str ? `?${str}` : '';
}
