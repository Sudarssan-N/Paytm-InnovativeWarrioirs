export const CHARACTERS = [
  { id: 'asha', name: 'MITRA', label: 'Professional woman', style: 'professional', gender: 'girl', color: '#087d70', skin: '#dca17b', skinLight: '#eab58e', hair: '#32231f' },
  { id: 'aarav', name: 'Aarav', label: 'Professional man', style: 'professional', gender: 'boy', color: '#4163ab', skin: '#bc805c', skinLight: '#d29a73', hair: '#251e1c' },
  { id: 'tara', name: 'Tara', label: 'Playful girl', style: 'playful', gender: 'girl', color: '#c46843', skin: '#d49b6e', skinLight: '#e6b185', hair: '#382620' },
  { id: 'kabir', name: 'Kabir', label: 'Playful boy', style: 'playful', gender: 'boy', color: '#8770ba', skin: '#cb8c60', skinLight: '#dea176', hair: '#29211e' },
];
export function getCharacter(id) { return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]; }
export function savedCharacter() {
  try { return getCharacter(localStorage.getItem('mitra_character')).id; } catch { return 'asha'; }
}
export function saveCharacter(id) {
  const choice = getCharacter(id).id;
  try { localStorage.setItem('mitra_character', choice); } catch { /* session choice still works */ }
  window.dispatchEvent(new CustomEvent('mitra-character', { detail: choice }));
}

export function armPose(gesture, elevation = 0) {
  if (gesture === 'wave') return { shoulder: -140, elbow: -25, hand: 'open' };
  if (gesture === 'thumbs-up') return { shoulder: -65, elbow: -125, hand: 'thumb' };
  if (gesture === 'listen') return { shoulder: -155, elbow: -50, hand: 'open' };
  if (gesture.startsWith('point')) return { shoulder: -85 + Math.max(-25, Math.min(25, elevation)), elbow: -12, hand: 'point' };
  return { shoulder: -14, elbow: 18, hand: 'rest' };
}
