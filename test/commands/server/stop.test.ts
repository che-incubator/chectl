import {expect, test} from '@oclif/test'

describe('stop', () => {
  test
    .stdout()
    .command(['stop'])
    .it('stop Che Server', ctx => {
      expect(ctx.stdout).to.contain('Successfully stopped')
    })
})
