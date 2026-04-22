export const NOTES = ['G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#'];
export const ALT_NOTES: Record<string, string> = {
  'G#': 'Ab',
  'A#': 'Bb',
  'C#': 'Db',
  'D#': 'Eb',
  'Gb': 'F#',
};

export function transposeChord(chord: string, semitones: number): string {
  if (!chord) return '';
  
  const match = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return chord;
  
  let root = match[1];
  const suffix = match[2];
  
  if (ALT_NOTES[root]) root = ALT_NOTES[root];
  
  const index = NOTES.indexOf(root);
  if (index === -1) return chord;
  
  let newIndex = (index + semitones) % 12;
  if (newIndex < 0) newIndex += 12;
  
  return NOTES[newIndex] + suffix;
}

export function getSemitonesBetween(fromKey: string, toKey: string): number {
  let from = fromKey.trim();
  let to = toKey.trim();
  
  if (ALT_NOTES[from]) from = ALT_NOTES[from];
  if (ALT_NOTES[to]) to = ALT_NOTES[to];
  
  const fromIdx = NOTES.indexOf(from);
  const toIdx = NOTES.indexOf(to);
  
  if (fromIdx === -1 || toIdx === -1) return 0;
  
  return (toIdx - fromIdx + 12) % 12;
}

/**
 * G키 하모니카 사용자를 위해 'G'를 목표로 한 거리 계산
 * 사용자의 요청: A -> G (-2), C -> G (+7)
 */
export function getDistanceToG(fromKey: string): number {
  let from = fromKey.trim();
  if (ALT_NOTES[from]) from = ALT_NOTES[from];
  
  const fromIdx = NOTES.indexOf(from);
  if (fromIdx === -1) return 0;
  
  // NOTES는 G부터 시작하므로 G의 index는 0
  const toIdx = 0; 
  
  let diff = toIdx - fromIdx;
  
  // 사용자의 특별 요청 처리: C(idx 5)에서 G(idx 0)로 갈 때 +7 선호
  if (from === 'C') return 7;
  if (from === 'Db') return 6;
  if (from === 'D') return 5;
  if (from === 'Eb') return 4;
  if (from === 'E') return 3;
  if (from === 'F') return 2;
  if (from === 'F#') return 1;
  
  // 나머지(G, Ab, A, Bb, B)는 음수 방향이 직관적 (A -> G = -2)
  if (diff < -6) diff += 12;
  if (diff > 6) diff -= 12;
  
  return diff;
}
