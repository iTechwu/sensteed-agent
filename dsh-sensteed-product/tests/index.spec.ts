import { describe, expect, it } from 'vitest'
import { apply, PRODUCT_PACKAGE_NAME } from '../src/index.ts'

describe('product package root', () => {
  it('exposes a mountable host plugin alongside the client declaration', () => {
    expect(PRODUCT_PACKAGE_NAME).toBe('@dofe/dsh-sensteed-product')
    expect(apply).toBeTypeOf('function')
  })
})
