// import {expect, test} from '@oclif/test'
// // import {ChildProcess} from 'child_process'
// import execa = require('execa')
// import {fancy} from 'fancy-test'

// const EventEmitter = require('events')

// let spawnEvent = new EventEmitter()
// spawnEvent.stdout = new EventEmitter()

// describe('start', () => {
//   test
//     .stdout()
//     .command(['start'])
//     .it('runs hello', ctx => {
//       expect(ctx.stdout).to.contain('hello world')
//     })

//   test
//     .stdout()
//     .command(['start', '--name', 'jeff'])
//     .it('runs hello --name jeff', ctx => {
//       expect(ctx.stdout).to.contain('hello jeff')
//     })

//   fancy
//     .stub(execa, 'exec', () => new EventEmitter())
//     .it('finds out that minikube is not running', (ctx: any) => {
//       expect(up.isMinikubeRunning(ctx)).to.equal(false)
//     })
// })
