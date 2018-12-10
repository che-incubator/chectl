// tslint:disable:object-curly-spacing

import * as execa from 'execa'

export class MinikubeHelper {
  async isMinikubeRunning(): Promise<boolean> {
    const { code } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async startMinikube() {
    await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: 180000 })
  }

  async isIngressAddonEnabled(): Promise<boolean> {
    const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 10000 })
    if (stdout.includes('ingress: enabled')) { return true } else { return false }
  }

  async enableIngressAddon() {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 10000 })
  }
}
