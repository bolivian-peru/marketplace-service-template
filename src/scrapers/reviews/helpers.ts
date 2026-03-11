/**
 * Google Reviews — Helper Functions
 */

// ─── HELPER FUNCTIONS ───────────────────────────────

/**
 * Parse relative date string to ISO date
 */
export function parseDateString(dateStr: string | null): string {
  if (!dateStr) return '';

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;

  const now = new Date();

  // Parse relative dates like "2 weeks ago", "3 months ago"
  const relMatch = dateStr.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
  if (relMatch) {
    const amount = parseInt(relMatch[1]);
    const unit = relMatch[2].toLowerCase();

    switch (unit) {
      case 'second': now.setSeconds(now.getSeconds() - amount); break;
      case 'minute': now.setMinutes(now.getMinutes() - amount); break;
      case 'hour': now.setHours(now.getHours() - amount); break;
      case 'day': now.setDate(now.getDate() - amount); break;
      case 'week': now.setDate(now.getDate() - amount * 7); break;
      case 'month': now.setMonth(now.getMonth() - amount); break;
      case 'year': now.setFullYear(now.getFullYear() - amount); break;
    }

    return now.toISOString().split('T')[0];
  }

  // "a week ago", "a month ago"
  const singleMatch = dateStr.match(/an?\s*(hour|day|week|month|year)\s*ago/i);
  if (singleMatch) {
    const unit = singleMatch[1].toLowerCase();
    switch (unit) {
      case 'hour': now.setHours(now.getHours() - 1); break;
      case 'day': now.setDate(now.getDate() - 1); break;
      case 'week': now.setDate(now.getDate() - 7); break;
      case 'month': now.setMonth(now.getMonth() - 1); break;
      case 'year': now.setFullYear(now.getFullYear() - 1); break;
    }
    return now.toISOString().split('T')[0];
  }

  return dateStr;
}
