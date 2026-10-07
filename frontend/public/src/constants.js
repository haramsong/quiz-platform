// Shared label/color palette — Host and Player must match (1:1 mapping).
export const CHOICE_COLORS = {
  red: '#e11d48',
  blue: '#2563eb',
  yellow: '#d97706',
  green: '#059669',
  purple: '#7c3aed',
  orange: '#ea580c',
  gray: '#64748b',
};

export function colorHex(name) {
  return CHOICE_COLORS[name] || CHOICE_COLORS.gray;
}
