// tslint:disable:object-curly-spacing
import { expect, fancy } from 'fancy-test'

import { CheHelper } from '../../src/helpers/che'

// const sinon = require('sinon')

const namespace = 'kube-che'
const k8sURL = 'https://192.168.64.34:8443'
const cheURL = 'https://che-kube-che.192.168.64.34.nip.io'
let ch = new CheHelper()

describe('Che helper', () => {
  // fancy
    // .nock(k8sURL, api => api
    //   .get(`/api/v1/namespaces/${namespace}/pods?labelSelector=app%3Dche`)
    //   .replyWithFile(200, __dirname + '/replies/get-pods-che-running.json', { 'Content-Type': 'application/json' }))
    // .it('detects if Che server pod exist', async () => {
    //   let ch = new CheHelper()
    //   const res = await ch.cheServerPodExist(namespace)
    //   expect(res).to.equal(true)
    // })
  // fancy
  //   .stub(ch, 'cheURL', () => cheURL)
  //   .nock(cheURL, api => api
  //     .get('/api/system/state')
  //     .reply(200))
  //   .it('detects if Che server is ready', async () => {
  //     const res = await ch.isCheServerReady(namespace)
  //     expect(res).to.equal(true)
  //   })
  // fancy
  //   .stub(ch, 'cheURL', () => cheURL)
  //   .nock(cheURL, api => api
  //     .get('/api/system/state')
  //     .delayConnection(1000)
  //     .reply(200))
  //   .it('detects if Che server is NOT ready', async () => {
  //     const res = await ch.isCheServerReady(namespace, 500)
  //     expect(res).to.equal(false)
  //   })
  // fancy
  //   .stub(ch, 'cheURL', () => cheURL)
  //   .nock(cheURL, api => api
  //     .get('/api/system/state')
  //     .delayConnection(1000)
  //     .reply(200))
  //   .it('waits until Che server is ready', async () => {
  //     const res = await ch.isCheServerReady(namespace, 2000)
  //     expect(res).to.equal(true)
  //   })
  fancy
    .it('found an existing namespace', async () => {
      const res = await ch.cheNamespaceExist(namespace)
      expect(res).to.equal(false)
    })
  fancy
    .it('found an existing namespace', async () => {
      const res = await ch.cheNamespaceExist('default')
      expect(res).to.equal(true)
    })
})
