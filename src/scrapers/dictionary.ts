export interface DictionaryEntry {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
}

export async function getDefinition(word: string): Promise<DictionaryEntry> {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Definition fetch failed');
    const data = await res.json();
    const entry = data[0];
    const meaning = entry.meanings?.[0]?.definitions?.[0] || {};
    return {
      word: entry.word || word,
      phonetic: entry.phonetic || 'N/A',
      definition: meaning.definition || 'No definition found',
      example: meaning.example || ''
    };
  } catch (e) {
    console.error("Dictionary Error:", e);
    return {} as DictionaryEntry;
  }
}
