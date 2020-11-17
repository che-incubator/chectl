import { IConfig } from '@oclif/config'
/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { cli } from 'cli-ux'
import { existsSync, mkdirsSync } from 'fs-extra'

import { SegmentAdapter } from './segment'

export const hook = async (options: {event: string, flags: any, command: string, config: IConfig }) => {
  let confirmed

  const segment = new SegmentAdapter({
    // tslint:disable-next-line:no-single-line-block-comment
    segmentWriteKey: /* @mangle */'I2OrSxLv2Ym0f0zE6XBNMQSvJMJJCYcE' /* @/mangle */,
  })

  if (!existsSync(options.config.configDir)) {
    mkdirsSync(options.config.configDir)
  }

  if (!segment.checkIfSegmentConfigFileExist(options.config.configDir)) {
    confirmed = await cli.confirm('Do you allow chectl to collect anonymous usage data? Please confirm - press y/n')
    segment.storeSegmentConfig(options.config.configDir, confirmed)
  }

  try {
    if (confirmed || segment.checkIfSegmentCollectIsAllowed(options.config.configDir)) {
      segment.onTrack(options)
    }
  } catch {
    return this
  }
}
