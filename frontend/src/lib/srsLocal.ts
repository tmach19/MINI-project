import type { MarkedVocabRecord, TestAttemptRecord } from '../types';

const GUEST_MARKED_KEY = 'cs_guest_marked_vocab_v1';
const GUEST_ATTEMPTS_KEY = 'cs_guest_test_attempts_v1';

export function loadGuestMarkedMap(): Record<string, MarkedVocabRecord> {
  try {
    const raw = localStorage.getItem(GUEST_MARKED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveGuestMarkedMap(map: Record<string, MarkedVocabRecord>): void {
  localStorage.setItem(GUEST_MARKED_KEY, JSON.stringify(map));
}

export function loadGuestAttempts(): TestAttemptRecord[] {
  try {
    const raw = localStorage.getItem(GUEST_ATTEMPTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveGuestAttempts(list: TestAttemptRecord[]): void {
  localStorage.setItem(GUEST_ATTEMPTS_KEY, JSON.stringify(list.slice(0, 30)));
}
