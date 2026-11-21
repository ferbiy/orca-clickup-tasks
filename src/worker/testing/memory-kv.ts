// In-memory KeyValueStore for tests. Values are deep-copied through JSON so tests see what real storage would.
import type { JsonValue } from 'orca'
import type { KeyValueStore } from '../ports'

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, JsonValue>()

  async get(key: string): Promise<JsonValue | null> {
    const v = this.map.get(key)
    return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as JsonValue)
  }

  async set(key: string, value: JsonValue): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(value)) as JsonValue)
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  /** Every stored key and value, for assertions. */
  snapshot(): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {}
    for (const [k, v] of this.map) out[k] = JSON.parse(JSON.stringify(v)) as JsonValue
    return out
  }
}
