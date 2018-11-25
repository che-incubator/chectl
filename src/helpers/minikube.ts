// tslint:disable:object-curly-spacing

import * as execa from 'execa'

export class MinikubeHelper {
  async isMinikubeRunning(): Promise<boolean> {
    const { code } = await execa('minikube', ['status'], { timeout: 10000, reject: false })
    if (code === 0) { return true } else { return false }
  }
}
