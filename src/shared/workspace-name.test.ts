import { assert, describe, test } from 'orca/testing'
import { buildWorkspaceName } from './workspace-name'

const t = (name: string, customId: string | null = null) => ({ id: 'abc', customId, name })

describe('buildWorkspaceName', () => {
  test('plain title', () => {
    assert.equal(buildWorkspaceName(t('Migrate billing webhooks')), 'CU-abc-migrate-billing-webhooks')
  })
  test('Vietnamese title', () => {
    assert.equal(buildWorkspaceName(t('Sửa lỗi đăng nhập')), 'CU-abc-sua-loi-dang-nhap')
    assert.equal(buildWorkspaceName(t('ĐÀ NẴNG')), 'CU-abc-da-nang')
  })
  test('accented latin', () => {
    assert.equal(buildWorkspaceName(t('Café résumé')), 'CU-abc-cafe-resume')
  })
  test('emoji and punctuation only gives just the id', () => {
    assert.equal(buildWorkspaceName(t('🔥!!! ???')), 'CU-abc')
    assert.equal(buildWorkspaceName(t('')), 'CU-abc')
  })
  test('custom id wins, case kept', () => {
    assert.equal(buildWorkspaceName(t('Fix it', 'ENG-142')), 'CU-ENG-142-fix-it')
  })
  test('collapses runs and trims dashes', () => {
    assert.equal(buildWorkspaceName(t('  --Fix:  the   bug!! ')), 'CU-abc-fix-the-bug')
  })
  test('long title cut on a word boundary', () => {
    const name = buildWorkspaceName(
      t('Implement the extremely long running background synchronisation worker')
    )
    assert.ok(name.length <= 60)
    assert.ok(!name.endsWith('-'))
    assert.equal(name, 'CU-abc-implement-the-extremely-long-running-background')
  })
  test('respects custom maxLength and exact fit', () => {
    assert.equal(buildWorkspaceName(t('one two three'), { maxLength: 14 }), 'CU-abc-one-two')
    assert.equal(buildWorkspaceName(t('one two three'), { maxLength: 13 }), 'CU-abc-one')
    assert.equal(buildWorkspaceName(t('one two three'), { maxLength: 9 }), 'CU-abc-on')
    assert.equal(buildWorkspaceName(t('one two three'), { maxLength: 6 }), 'CU-abc')
  })
  test('single huge word is hard-cut', () => {
    const name = buildWorkspaceName(t('x'.repeat(100)), { maxLength: 20 })
    assert.equal(name.length, 20)
  })
  test('result is a safe branch name', () => {
    for (const title of ['A/B c:d', 'Sửa lỗi đăng nhập', '100% done ~ ^ ? * [x]']) {
      const name = buildWorkspaceName(t(title, 'ENG-1'))
      assert.ok(/^CU-[A-Za-z0-9-]+$/.test(name), name)
      assert.ok(name.length <= 60)
    }
  })
})
