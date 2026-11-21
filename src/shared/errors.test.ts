import { assert, test } from 'orca/testing'
import { messageOf, PluginError, toErrorShape } from './errors'

test('messageOf reads Error, host error objects and strings, never "[object Object]"', () => {
  assert.equal(messageOf(new Error('boom')), 'boom')
  assert.equal(messageOf({ code: 'timeout', message: 'Worker did not answer' }), 'Worker did not answer')
  assert.equal(messageOf('plain'), 'plain')
  assert.equal(messageOf({ nope: 1 }), 'Unknown error')
  assert.equal(toErrorShape(new PluginError('not_found', 'gone')).code, 'not_found')
})
