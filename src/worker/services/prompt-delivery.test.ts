import { assert, describe, test } from 'orca/testing'
import { pastePayload } from './prompt-delivery'

describe('pastePayload', () => {
  test('wraps in a bracketed paste with CR line ends, like Orca', () => {
    assert.equal(pastePayload('a\nb\r\nc'), '\x1b[200~a\rb\rc\x1b[201~')
  })

  test('untrusted text cannot end the paste or send control keys', () => {
    const evil = 'x\x1b[201~rm -rf ~\r\x03\x04\x9b31m\x7fy\tz'
    const out = pastePayload(evil)
    const inner = out.slice('\x1b[200~'.length, -'\x1b[201~'.length)
    assert.equal(inner.includes('\x1b'), false)
    assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(inner), false)
    assert.equal(inner, 'x␛[201~rm -rf ~\r31my\tz')
  })
})
