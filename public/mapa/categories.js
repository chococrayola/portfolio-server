// Category definitions for the Puerto Rico nature & photography map.
// Each category has a Spanish label, an emoji symbol, and a color.
// The legend, the map markers, and the popups all read from here so the
// symbols stay in sync everywhere.

export const CATEGORIES = {
  playa:     { label: 'Playas',             emoji: '🏖️', color: '#e9c46a' },
  rio:       { label: 'Ríos / Riachuelos',  emoji: '🏞️', color: '#2a9d8f' },
  charca:    { label: 'Charcas / Cascadas', emoji: '💦', color: '#48cae4' },
  lago:      { label: 'Lagos / Lagunas',    emoji: '🌊', color: '#0077b6' },
  sendero:   { label: 'Senderos',           emoji: '🥾', color: '#9c6644' },
  turistico: { label: 'Lugares turísticos', emoji: '📸', color: '#e76f51' },
};

// Fallback used if a place references an unknown category.
export const FALLBACK_CATEGORY = { label: 'Otro', emoji: '📍', color: '#9fb0c0' };

export function getCategory(key) {
  return CATEGORIES[key] || FALLBACK_CATEGORY;
}
