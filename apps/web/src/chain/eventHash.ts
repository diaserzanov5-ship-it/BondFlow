export type HashableCorporateAction = {
  id: string
  bond: string
  kind: string
  date: string
  amount: string
  unit: string
  source: string
}

/** Hash a stable, ordered JSON representation of the event's public fields. */
export async function hashCorporateAction(action: HashableCorporateAction): Promise<Uint8Array> {
  const canonicalRecord = {
    amount: action.amount.trim(),
    bond: action.bond.trim().toUpperCase(),
    date: action.date.trim(),
    id: action.id.trim(),
    kind: action.kind.trim(),
    source: action.source.trim(),
    unit: action.unit.trim().toUpperCase(),
  }
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalRecord))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return new Uint8Array(digest)
}

export function hashToHex(hash: Uint8Array): string {
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
