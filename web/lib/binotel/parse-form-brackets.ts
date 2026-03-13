// Парсер form-urlencoded з bracket-нотацією (callDetails[generalCallID], callDetails[pbxNumberData][number])
// Binotel надсилає вебхуки в такому форматі

/**
 * Конвертує плоский об'єкт { "callDetails[generalCallID]": "x", "callDetails[pbxNumberData][number]": "y" }
 * у вкладений { callDetails: { generalCallID: "x", pbxNumberData: { number: "y" } } }
 */
export function parseFormToNested(
  flat: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined || value === null) continue;

    const bracketMatch = key.match(/^([^[]+)(.*)$/);
    if (!bracketMatch) continue;

    const baseKey = bracketMatch[1];
    const bracketPart = bracketMatch[2];

    if (!bracketPart) {
      result[baseKey] = value;
      continue;
    }

    // callDetails[generalCallID] → path = ["callDetails", "generalCallID"]
    // callDetails[pbxNumberData][number] → path = ["callDetails", "pbxNumberData", "number"]
    const path = key.split(/[\[\]]/).filter(Boolean);
    if (path.length === 0) continue;

    let current: Record<string, unknown> = result;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i];
      const nextP = path[i + 1];
      const isArrayIndex = /^\d+$/.test(nextP);
      const nextVal = current[p];
      if (nextVal === undefined || nextVal === null) {
        current[p] = isArrayIndex ? [] : {};
      }
      current = current[p] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
  }

  return result;
}
