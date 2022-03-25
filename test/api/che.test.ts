/**
 * Copyright (c) 2019-2021 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { CoreV1Api } from '@kubernetes/client-node'
import { expect, fancy } from 'fancy-test'

import { CheHelper } from '../../src/api/che'
import { ChectlContext } from '../../src/api/context'

const namespace = 'che'
let ch = new CheHelper({})
let kube = ch.kube
let oc = ch.oc
let k8sApi = new CoreV1Api()

const certificateString = `-----BEGIN CERTIFICATE-----
MIIDZTCCAk2gAwIBAgIUDTGt55WQhHYiI+dSA1Y5vl8wEfQwDQYJKoZIhvcNAQEL
BQAwQjELMAkGA1UEBhMCWFgxFTATBgNVBAcMDERlZmF1bHQgQ2l0eTEcMBoGA1UE
CgwTRGVmYXVsdCBDb21wYW55IEx0ZDAeFw0yMTAyMTAxMTI5MDFaFw0yMjAyMTAx
MTI5MDFaMEIxCzAJBgNVBAYTAlhYMRUwEwYDVQQHDAxEZWZhdWx0IENpdHkxHDAa
BgNVBAoME0RlZmF1bHQgQ29tcGFueSBMdGQwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQDqgW9Rsv1CkBpQkwkkWhd/dMRtzHvRZDqNE5gjbRLxHw8U5YKt
owpRpW1a6Vqh+KTvbX2t61A+1xraKSKCAoVxiZqX8qfnMQV9oG3suDm/rLYPxIGc
mL8dl99w2HxjDzYp1ud92RCNISSEw8Rm3IH9FfOnXg0fyJk0/yWXBVUZwe1a5EcG
VqMHH6oklPZkOKxqIWIlQD9kCpoH5MC8WIp79I/XfM4C9UunJFx4bjyJvVzbkECu
o7P0u384L6FeMusd4U58iQbTqaMdo+EmG5OJjdRPQ/3yGd1FvO4ol0F0dgLjiyXZ
rzCPFQA8p43c9xHRmOTUetLqtSpg+rTKGk7pAgMBAAGjUzBRMB0GA1UdDgQWBBSt
Tc9gHtzqp/Fl2oRhV9m4WcJJDzAfBgNVHSMEGDAWgBStTc9gHtzqp/Fl2oRhV9m4
WcJJDzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQDOcML+LW/3
PKU2Af22mcFxrHsd47U6IVn08jXWo9DOmcZbyys2QI2LsdRkCUhXChzotwOKjk5x
5tmgVpgOBmmd88+ibSgwjIweERdrKqGNmTA6k5SCRqdT9yOjB4hv7FtUuIisNu4v
jdKKCsPGYyaSOKCGQhud/CztH2+6Rvz5ihbKnHCz81z+u2BRQHaXj2MnPIcEExG+
LO4GIJUAMSwYMygganLyS62zUVF1hfaMaUTvFUeYmx+B7A6LM8KKB9zhw7a9ABvw
9qy8xNNMzyZ8ExLP3VZe6H8o2j7ozlzQIMWAX70R8vq4OK1ChsdtEpBt4Ix25hYX
j6beGql44CGU
-----END CERTIFICATE-----`

const certBase64Encode = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURaVENDQWsyZ0F3SUJBZ0lVRFRHdDU1V1FoSFlpSStkU0ExWTV2bDh3RWZRd0RRWUpLb1pJaHZjTkFRRUwKQlFBd1FqRUxNQWtHQTFVRUJoTUNXRmd4RlRBVEJnTlZCQWNNREVSbFptRjFiSFFnUTJsMGVURWNNQm9HQTFVRQpDZ3dUUkdWbVlYVnNkQ0JEYjIxd1lXNTVJRXgwWkRBZUZ3MHlNVEF5TVRBeE1USTVNREZhRncweU1qQXlNVEF4Ck1USTVNREZhTUVJeEN6QUpCZ05WQkFZVEFsaFlNUlV3RXdZRFZRUUhEQXhFWldaaGRXeDBJRU5wZEhreEhEQWEKQmdOVkJBb01FMFJsWm1GMWJIUWdRMjl0Y0dGdWVTQk1kR1F3Z2dFaU1BMEdDU3FHU0liM0RRRUJBUVVBQTRJQgpEd0F3Z2dFS0FvSUJBUURxZ1c5UnN2MUNrQnBRa3dra1doZC9kTVJ0ekh2UlpEcU5FNWdqYlJMeEh3OFU1WUt0Cm93cFJwVzFhNlZxaCtLVHZiWDJ0NjFBKzF4cmFLU0tDQW9WeGlacVg4cWZuTVFWOW9HM3N1RG0vckxZUHhJR2MKbUw4ZGw5OXcySHhqRHpZcDF1ZDkyUkNOSVNTRXc4Um0zSUg5RmZPblhnMGZ5SmswL3lXWEJWVVp3ZTFhNUVjRwpWcU1ISDZva2xQWmtPS3hxSVdJbFFEOWtDcG9INU1DOFdJcDc5SS9YZk00QzlVdW5KRng0Ymp5SnZWemJrRUN1Cm83UDB1Mzg0TDZGZU11c2Q0VTU4aVFiVHFhTWRvK0VtRzVPSmpkUlBRLzN5R2QxRnZPNG9sMEYwZGdMaml5WFoKcnpDUEZRQThwNDNjOXhIUm1PVFVldExxdFNwZytyVEtHazdwQWdNQkFBR2pVekJSTUIwR0ExVWREZ1FXQkJTdApUYzlnSHR6cXAvRmwyb1JoVjltNFdjSkpEekFmQmdOVkhTTUVHREFXZ0JTdFRjOWdIdHpxcC9GbDJvUmhWOW00CldjSkpEekFQQmdOVkhSTUJBZjhFQlRBREFRSC9NQTBHQ1NxR1NJYjNEUUVCQ3dVQUE0SUJBUURPY01MK0xXLzMKUEtVMkFmMjJtY0Z4ckhzZDQ3VTZJVm4wOGpYV285RE9tY1pieXlzMlFJMkxzZFJrQ1VoWENoem90d09Lams1eAo1dG1nVnBnT0JtbWQ4OCtpYlNnd2pJd2VFUmRyS3FHTm1UQTZrNVNDUnFkVDl5T2pCNGh2N0Z0VXVJaXNOdTR2CmpkS0tDc1BHWXlhU09LQ0dRaHVkL0N6dEgyKzZSdno1aWhiS25IQ3o4MXordTJCUlFIYVhqMk1uUEljRUV4RysKTE80R0lKVUFNU3dZTXlnZ2FuTHlTNjJ6VVZGMWhmYU1hVVR2RlVlWW14K0I3QTZMTThLS0I5emh3N2E5QUJ2dwo5cXk4eE5OTXp5WjhFeExQM1ZaZTZIOG8yajdvemx6UUlNV0FYNzBSOHZxNE9LMUNoc2R0RXBCdDRJeDI1aFlYCmo2YmVHcWw0NENHVQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0t'

describe('Eclipse Che helper', () => {
  describe('cheURL', () => {
    fancy
      .stub(kube, 'getNamespace', () => ({}))
      .stub(oc, 'routeExist', () => true)
      .stub(ChectlContext, 'get', () => ({isOpenShift: true}))
      .stub(oc, 'getRouteHost', () => 'ocp-che-example.org')
      .it('computes Eclipse URL on Openshift', async () => {
        const chePluginRegistryURL = await ch.cheURL('che-namespace')
        expect(chePluginRegistryURL).to.equals('https://ocp-che-example.org')
      })
    fancy
      .stub(kube, 'getNamespace', () => ({}))
      .stub(kube, 'isIngressExist', () => true)
      .stub(ChectlContext, 'get', () => ({isOpenShift: false}))
      .stub(kube, 'getIngressHost', () => 'example.org')
      .it('computes Eclipse Che URL on K8s', async () => {
        const cheURL = await ch.cheURL('che-namespace')
        expect(cheURL).to.equals('https://example.org')
      })
    fancy
      .stub(kube, 'getNamespace', () => ({}))
      .stub(kube, 'isIngressExist', () => false)
      .stub(ChectlContext, 'get', () => ({isOpenShift: true}))
      .stub(oc, 'routeExist', () => false)
      .do(() => ch.cheURL('che-namespace')) //ERR_ROUTE_NO_EXIST
      .catch(err => expect(err.message).to.match(/ERR_ROUTE_NO_EXIST/))
      .it('fails fetching Eclipse Che URL when ingress does not exist')
    fancy
      .stub(kube, 'getNamespace', () => ({}))
      .stub(kube, 'isIngressExist', () => false)
      .stub(ChectlContext, 'get', () => ({isOpenShift: false}))
      .do(() => ch.cheURL('che-namespace'))
      .catch(err => expect(err.message).to.match(/ERR_INGRESS_NO_EXIST/))
      .it('fails fetching Eclipse Che URL when ingress does not exist')
    fancy
      .stub(kube, 'getNamespace', () => ({}))
      .stub(ChectlContext, 'get', () => ({isOpenShift: true}))
      .stub(oc, 'routeExist', () => false)
      .do(() => ch.cheURL('che-namespace'))
      .catch(/ERR_ROUTE_NO_EXIST/)
      .it('fails fetching Eclipse Che URL when route does not exist')
    fancy
      .stub(kube, 'getNamespace', () => undefined)
      .do(() => ch.cheURL('che-namespace'))
      .catch(err => expect(err.message).to.match(/ERR_NAMESPACE_NO_EXIST/))
      .it('fails fetching Eclipse Che URL when namespace does not exist')
  })
  describe('cheNamespaceExist', () => {
    fancy
      .stub(kube.kubeConfig, 'makeApiClient', () => k8sApi)
      .stub(k8sApi, 'readNamespace', jest.fn().mockImplementation(() => { throw new Error() }))
      .it('founds out that a namespace doesn\'t exist', async () => {
        const res = !!await kube.getNamespace(namespace)
        expect(res).to.equal(false)
      })
    fancy
      .stub(kube.kubeConfig, 'makeApiClient', () => k8sApi)
      .stub(k8sApi, 'readNamespace', () => ({ response: '', body: { metadata: { name: `${namespace}` } } }))
      .it('founds out that a namespace does exist', async () => {
        const res = !!await kube.getNamespace(namespace)
        expect(res).to.equal(true)
      })
  })
  describe('buildDashboardURL', () => {
    fancy
      .it('builds the Dashboard URL of a workspace given the IDE link', async () => {
        let cheURL = 'https://che-che.192.168.64.40.nip.io'
        let dashboardURL = 'https://che-che.192.168.64.40.nip.io/dashboard/'
        let res = await ch.buildDashboardURL(cheURL)
        expect(res).to.equal(dashboardURL)
      })
  })
  describe('retrieveCheCaCert', () => {
    fancy
      .stub(kube, 'getSecret', () => ({ data : { 'ca.crt' : certBase64Encode } }))
      .it('should return if self signed certificate secret exist in cluster', async () => {
        const retrieveCheCaCert = await ch.retrieveCheCaCert(namespace)
        expect(retrieveCheCaCert).to.equals(certificateString)
      })
    fancy
      .stub(kube, 'getSecret', () => (undefined))
      .it('should return if self signed certificate secret exist in cluster', async () => {
        const retrieveCheCaCert = await ch.retrieveCheCaCert(namespace)
        expect(retrieveCheCaCert).to.equals(undefined)
      })
    fancy
      .stub(kube, 'getSecret', () => ({ data : { 'ca.crt' : certBase64Encode } }))
      .it('should return if self signed certificate secret exist in cluster', async () => {
        const retrieveCheCaCert = await ch.retrieveCheCaCert(namespace)
        expect(retrieveCheCaCert).to.equals(certificateString)
      })
    fancy
      .stub(kube, 'getSecret', () => ({ data : { pass : 'pass' } }))
      .do(() => ch.retrieveCheCaCert(namespace))
      .catch(/has invalid format: "ca.crt" key not found in data./)
      .it('should fail if ca.crt key not found in secret')
  })
})
