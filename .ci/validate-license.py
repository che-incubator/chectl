from __future__ import (
    absolute_import, print_function, division, unicode_literals
)

import logging
import re
import sys
from datetime import datetime

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

CURRENT_YEAR = datetime.today().year

COPYRIGHT_RE=r'Copyright \(c\) 2019-'+str(CURRENT_YEAR) + r' Red Hat, Inc.'
PATTERN1=r'This program and the accompanying materials are made'
PATTERN2=r'available under the terms of the Eclipse Public License 2.0'
PATTERN3=r'which is available at https://www.eclipse.org/legal/epl-2.0/'
PATTERN4=r'SPDX-License-Identifier: EPL-2.0'
PATTERN5=r'Contributors:'
PATTERN6=r'Red Hat, Inc. - initial API and implementation'
ARRAY_OF_PATTERNS=[COPYRIGHT_RE, PATTERN6, PATTERN2, PATTERN3, PATTERN4, PATTERN5, PATTERN6]

def update_go_license(name, force=False):
    with open(name) as f:
        orig_lines = list(f)
    lines = list(orig_lines)

    for pattern in ARRAY_OF_PATTERNS:
        try:
            validated = license_lines_check(lines,pattern)
            if validated is None:
                raise ValueError('Exception: Found an invalid license, file_name=%s, pattern=%s, success=%s' % (name, pattern, False))
        except ValueError as err:
            print(err.args)
            sys.exit(1)
    print('Successfully validated license header', 'file_name=%s, success=%s' % (name, True))

def license_lines_check(lines, pattern):
    for i, line in enumerate(lines[:20]):
        found = False

        m = re.compile(pattern, re.I).search(line)
        if not m:
            continue
        found=True

        return found

def main():
    if len(sys.argv) == 1:
        print('USAGE: %s FILE ...' % sys.argv[0])
        sys.exit(1)

    for name in sys.argv[1:]:
        if name.endswith('.ts') or name.endswith('.sh') or name.endswith('.yaml') or name.endswith('.yml'):
            try:
                update_go_license(name)
            except Exception as error:
                logger.error('Failed to process file %s', name)
                logger.exception(error)
                raise error
        else:
            raise NotImplementedError('Unsupported file type: %s' % name)


if __name__ == "__main__":
    main()
