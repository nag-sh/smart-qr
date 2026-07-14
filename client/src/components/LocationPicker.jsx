import React from 'react';

export default function LocationPicker({
  icon = null,
  inputCls = 'w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100',
  labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2',
  inputId,
  placeholder = '',
  disabled = false,
  dropdownItemCls = 'w-full px-4 py-2.5 text-left text-xs hover:bg-purple-600/25 hover:text-white transition-colors block',
  value,
  onChange,
  onFocus,
  allLocations,
  showDropdown,
  setShowDropdown,
  label = 'Location',
  savedLocationsLabel = 'Saved Locations:',
  matchType = 'contains'
}) {
  const filterLocations = () => {
    const query = value.toLowerCase().trim();
    if (!query) return allLocations;
    return allLocations.filter((loc) => {
      const lower = loc.toLowerCase();
      if (matchType === 'startsWith') return lower.startsWith(query);
      return lower.includes(query);
    });
  };

  const filtered = filterLocations();
  const showInlineChips = allLocations.length > 0 && allLocations.length <= 5;
  const showDropdownList = showDropdown && allLocations.length > 5;

  return (
    <div>
      <label htmlFor={inputId} className={labelCls}>
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            setShowDropdown(true);
            if (onFocus) onFocus();
          }}
          className={inputCls}
          disabled={disabled}
        />

        {showDropdownList && (
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowDropdown(false)}
          />
        )}

        {showDropdownList && (
          <div className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl z-40 max-h-48 overflow-y-auto">
            {filtered.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => {
                  onChange(loc);
                  setShowDropdown(false);
                }}
                className={dropdownItemCls}
              >
                {loc}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-2.5 text-xs text-slate-500 italic">
                No matching locations. Keep typing to add new.
              </div>
            )}
          </div>
        )}
      </div>

      {showInlineChips && (
        <div className="mt-2.5 space-y-1.5">
          <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {savedLocationsLabel}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {allLocations.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => onChange(loc)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                  value.toLowerCase() === loc.toLowerCase()
                    ? 'bg-purple-550/20 border-purple-500/40 text-purple-300'
                    : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
