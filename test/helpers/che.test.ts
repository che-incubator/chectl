// tslint:disable:object-curly-spacing
import { Core_v1Api, KubeConfig } from '@kubernetes/client-node';
import { expect, fancy } from 'fancy-test'

import { CheHelper } from '../../src/helpers/che'

const sinon = require('sinon')
const namespace = 'kube-che'
const k8sURL = 'https://192.168.64.34:8443'
const cheURL = 'https://che-kube-che.192.168.64.34.nip.io'
let ch = new CheHelper()
let kc = ch.kc
let k8sApi = new Core_v1Api()

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
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .get('/api/system/state')
      .reply(200))
    .it('detects if Che server is ready', async () => {
      const res = await ch.isCheServerReady(namespace)
      expect(res).to.equal(true)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .get('/api/system/state')
      .delayConnection(1000)
      .reply(200))
    .it('detects if Che server is NOT ready', async () => {
      const res = await ch.isCheServerReady(namespace, 500)
      expect(res).to.equal(false)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => { throw (new Error('Error from server (NotFound): ingresses.extensions "che-ingress" not found')) })
    .it('detects if Che is NOT ready when the namespace exist but the ingress doesn t', async () => {
      const res = await ch.isCheServerReady(namespace)
      expect(res).to.equal(false)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .get('/api/system/state')
      .delayConnection(1000)
      .reply(200))
    .it('waits until Che server is ready', async () => {
      const res = await ch.isCheServerReady(namespace, 2000)
      expect(res).to.equal(true)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .get('/api/system/state')
      .reply(404)
      .get('/api/system/state')
      .reply(503)
      .get('/api/system/state')
      .reply(200))
    .it('continues requesting until Che server is ready', async () => {
      const res = await ch.isCheServerReady(namespace, 2000)
      expect(res).to.equal(true)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .get('/api/system/state')
      .reply(404)
      .get('/api/system/state')
      .reply(404)
      .get('/api/system/state')
      .reply(503))
    .it('continues requesting but fails if Che server is NOT ready after timeout', async () => {
      const res = await ch.isCheServerReady(namespace, 2000)
      expect(res).to.equal(false)
    })
  fancy
    .stub(kc, 'makeApiClient', () => k8sApi)
    .stub(k8sApi, 'readNamespace', sinon.stub().throws(new Error()))
    .it('founds out that a namespace doesn\'t exist', async () => {
      const res = await ch.cheNamespaceExist(namespace)
      expect(res).to.equal(false)
    })
  fancy
    .stub(kc, 'makeApiClient', () => k8sApi)
    .stub(k8sApi, 'readNamespace', () => ({ response: '', body: { metadata: { name: `${namespace}` } } }))
    .it('founds out that a namespace does exist', async () => {
      const res = await ch.cheNamespaceExist(namespace)
      expect(res).to.equal(true)
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .post('/api/devfile')
      .replyWithFile(201, __dirname + '/replies/create-workspace-from-valid-devfile.json', { 'Content-Type': 'application/json' }))
    .it('succeds creating a workspace from a valid devfile', async () => {
      const res = await ch.createWorkspaceFromDevfile(namespace, __dirname + '/requests/devfile.valid')
      expect(res).to.equal('https://che-kube-che.192.168.64.39.nip.io/dashboard/#/ide/che/chectl')
    })
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .post('/api/devfile')
      .replyWithFile(400, __dirname + '/replies/create-workspace-from-invalid-devfile.json', {
        'Content-Type': 'application/json'
      }))
    .do(() => ch.createWorkspaceFromDevfile(namespace, __dirname + '/requests/devfile.invalid'))
    .catch(/E_BAD_DEVFILE_FORMAT/)
    .it('fails creating a workspace from an invalid devfile')
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .do(() => ch.createWorkspaceFromDevfile(namespace, __dirname + '/requests/devfile.inexistent'))
    .catch(/E_NOT_FOUND_DEVFILE/)
    .it('fails creating a workspace from a non-existing devfile')
  fancy
    .stub(ch, 'cheNamespaceExist', () => true)
    .stub(ch, 'cheURL', () => cheURL)
    .nock(cheURL, api => api
      .post('/api/workspace')
      .replyWithFile(201, __dirname + '/replies/create-workspace-from-valid-devfile.json', { 'Content-Type': 'application/json' }))
    .it('succeds creating a workspace from a valid workspaceconfig', async () => {
      const res = await ch.createWorkspaceFromWorkspaceConfig(namespace, __dirname + '/requests/workspaceconfig.valid')
      expect(res).to.equal('https://che-kube-che.192.168.64.39.nip.io/dashboard/#/ide/che/chectl')
    })
  fancy
    .it('builds the Dashboard URL of a workspace given the IDE link', async () => {
      let ideURL = 'https://che-kube-che.192.168.64.40.nip.io/che/name-with-dashes'
      let dashboardURL = 'https://che-kube-che.192.168.64.40.nip.io/dashboard/#/ide/che/name-with-dashes'
      let res = await ch.buildDashboardURL(ideURL)
      expect(res).to.equal(dashboardURL)
    })
})
