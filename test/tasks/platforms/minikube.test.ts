/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import * as execa from 'execa'
import * as fs from 'fs-extra'
import * as path from 'path'
import { expect, fancy } from 'fancy-test'

import { MinikubeTasks } from '../../../src/tasks/platforms/minikube'

jest.mock('execa')

let mh = new MinikubeTasks()

describe('start', () => {
  fancy
    .it('verifies that minikube is running', async () => {
      (execa as any).mockResolvedValue({ exitCode: 0, stdout: 'minikube: Running' })
      const res = await mh.isMinikubeRunning()
      expect(res).to.equal(true)
    })

  fancy
    .it('verifies that minikube is not running', async () => {
      (execa as any).mockResolvedValue({ exitCode: 1, stdout: 'minikube: Stopped' })
      const res = await mh.isMinikubeRunning()
      expect(res).to.equal(false)
    })
    fancy
    .it('Check ingress addon is there with old minikube version without json output', async () => {
      const v1JsonOutput = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list-json-v1.output'), 'utf-8');
      const v1Output = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list.output'), 'utf-8');
      ((execa as any) as jest.Mock).mockReturnValueOnce({ exitCode: 64, stderr: v1JsonOutput }).mockReturnValueOnce({ exitCode: 0, stdout: v1Output })
      const res = await mh.isIngressAddonEnabled()
      expect(res).to.equal(true)
    })
    fancy
    .it('Check ingress addon is not there with old minikube version without json output', async () => {
      const v1JsonOutput = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list-json-v1.output'), 'utf-8');
      const v1Output = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list-no-ingress.output'), 'utf-8');
      ((execa as any) as jest.Mock).mockReturnValueOnce({ exitCode: 64, stderr: v1JsonOutput }).mockReturnValueOnce({ exitCode: 0, stdout: v1Output })
      const res = await mh.isIngressAddonEnabled()
      expect(res).to.equal(false)
    })    
    fancy
    .it('Check ingress addon is there with new minikube version with json output', async () => {
      const v11JsonOutput = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list-v11.json'), 'utf-8');
      ((execa as any) as jest.Mock).mockReturnValueOnce({ exitCode: 0, stdout: v11JsonOutput })
      const res = await mh.isIngressAddonEnabled()
      expect(res).to.equal(true)
    })
    fancy
    .it('Check ingress addon is not there with new minikube version with json output', async () => {
      const v11JsonOutput = await fs.readFile(path.resolve(__dirname, 'minikube', 'minikube-addon-list-v11-not-present.json'), 'utf-8');
      ((execa as any) as jest.Mock).mockReturnValueOnce({ exitCode: 0, stdout: v11JsonOutput })
      const res = await mh.isIngressAddonEnabled()
      expect(res).to.equal(false)
    })    
})
