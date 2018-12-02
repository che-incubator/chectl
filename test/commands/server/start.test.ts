import {expect, test} from '@oclif/test'

describe('start', () => {
  test
    .stdout()
    .command(['start'])
    .it('starts Che Server', ctx => {
      expect(ctx.stdout).to.contain('Successfully started')
    })
})
