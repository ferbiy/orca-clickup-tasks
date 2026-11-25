import { assert, describe, test } from 'orca/testing'
import {
  FALLBACK_STATUS_COLORS,
  colorDot,
  contrastRatio,
  fallbackStatusColor,
  parseHexColor,
  statusColor,
  statusLabel
} from './status-color'

describe('parseHexColor (untrusted ClickUp input)', () => {
  test('accepts #rgb and #rrggbb, normalized to lower-case #rrggbb', () => {
    assert.equal(parseHexColor('#4194F6'), '#4194f6')
    assert.equal(parseHexColor('#abc'), '#aabbcc')
    assert.equal(parseHexColor('#D3D3D3'), '#d3d3d3')
  })
  test('refuses everything else', () => {
    for (const bad of [
      '', '#', '#12', '#1234', '#12345', '#1234567', '#12345678', '4194f6', '#gggggg', ' #4194f6', '#4194f6 ',
      'red', 'rgb(1,2,3)', '#fff;background:url(x)', '#fff}body{', 'expression(alert(1))', '#4194f6\n', '‮#fff',
      null, undefined, 0x4194f6, ['#fff'], { color: '#fff' }
    ]) {
      assert.equal(parseHexColor(bad), null, JSON.stringify(bad))
    }
  })
})

describe('fallback colours', () => {
  test('pinned: the same name gives the same colour; case and outer spaces do not matter', () => {
    assert.equal(fallbackStatusColor('in review'), fallbackStatusColor('In Review'))
    assert.equal(fallbackStatusColor('  in review '), fallbackStatusColor('in review'))
    assert.ok((FALLBACK_STATUS_COLORS as readonly string[]).includes(fallbackStatusColor('blocked')))
  })
  test('FNV-1a values are pinned (computed independently; a change here recolours everyone)', () => {
    assert.deepEqual(['to do', 'in progress', 'review', 'blocked', 'done', 'backlog', 'qa'].map(fallbackStatusColor), [
      '#c026d3', '#e5631a', '#e5631a', '#6366f1', '#c026d3', '#e5484d', '#2f9e44'
    ])
  })
  test('every palette colour is a valid hex with 3:1 contrast on Orca light and dark backgrounds', () => {
    for (const c of FALLBACK_STATUS_COLORS) {
      assert.equal(parseHexColor(c), c)
      assert.ok(contrastRatio(c, '#ffffff') >= 3, `${c} on light: ${contrastRatio(c, '#ffffff')}`)
      assert.ok(contrastRatio(c, '#0a0a0a') >= 3, `${c} on dark: ${contrastRatio(c, '#0a0a0a')}`)
    }
  })
  test('statusColor: ClickUp colour when valid, else the fallback', () => {
    assert.equal(statusColor({ name: 'x', color: '#4194F6' }), '#4194f6')
    assert.equal(statusColor({ name: 'x', color: 'javascript:1' }), fallbackStatusColor('x'))
    assert.equal(statusColor({ name: 'x', color: null }), fallbackStatusColor('x'))
    assert.equal(statusColor({ name: 'x' }), fallbackStatusColor('x'))
  })
})

describe('contrastRatio', () => {
  test('WCAG reference values', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
    assert.equal(contrastRatio('#777777', '#777777'), 1)
  })
})

describe('colorDot (the panel has no colour prop)', () => {
  test("ClickUp's default status colours", () => {
    assert.equal(colorDot('#d3d3d3'), '⚪') // to do
    assert.equal(colorDot('#4194f6'), '🔵') // in progress
    assert.equal(colorDot('#6bc950'), '🟢') // complete
    assert.equal(colorDot('#a875ff'), '🟣') // review
    assert.equal(colorDot('#ff7800'), '🟠')
    assert.equal(colorDot('#f9d900'), '🟡')
    assert.equal(colorDot('#e50000'), '🔴')
    assert.equal(colorDot('#ee5e99'), '🔴')
    assert.equal(colorDot('#1bbc9c'), '🟢') // teal reads green
    assert.equal(colorDot('#2f9e44'), '🟢')
  })
  test('greys, black, white and browns', () => {
    assert.equal(colorDot('#ffffff'), '⚪')
    assert.equal(colorDot('#87909e'), '⚪')
    assert.equal(colorDot('#000000'), '⚫')
    assert.equal(colorDot('#333333'), '⚫')
    assert.equal(colorDot('#6b3e1a'), '🟤')
  })
  test('every fallback colour maps to a circle', () => {
    for (const c of FALLBACK_STATUS_COLORS) assert.ok(colorDot(c).length > 0)
  })
  test('statusLabel puts the circle before the name', () => {
    assert.equal(statusLabel({ name: 'in progress', color: '#4194f6' }), '🔵 in progress')
    assert.equal(statusLabel({ name: 'shipped' }), `${colorDot(fallbackStatusColor('shipped'))} shipped`)
  })
})
