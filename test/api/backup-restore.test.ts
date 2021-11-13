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

 import { expect, fancy } from 'fancy-test'

 import { AWS_CREDENTIALS_SECRET_NAME, BackupServerConfig, BACKUP_REPOSITORY_PASSWORD_SECRET_NAME, getBackupServerType, parseBackupServerConfig, RestBackupServerCredentials, REST_SERVER_CREDENTIALS_SECRET_NAME, SSH_KEY_SECRET_NAME } from '../../src/api/backup-restore'

 describe('Backup / Restore', () => {
  describe('Backup server URL parsing', () => {
    const SECTION_ERROR = 'Expected section is undefined'
    function getConfig(url: string): BackupServerConfig {
      return {
        url,
        repoPassword: 'password',
        type: getBackupServerType(url)
      }
    }

    describe('REST server URL parsing', () => {
      fancy.it('should parse hostname', async () => {
        function runTestForHostname(host: string) {
          const urls = [
            `rest:${host}`,
            `rest://${host}`,
            `rest://http://${host}`,
            `rest:http://${host}`,
            `rest://http://${host}:1234`,
            `rest://http://${host}:1234/path`,
            `rest:http://${host}:1234/path/`,
            `rest://http://${host}:1234/path/repo`,
            `rest://${host}:1234/path/repo/`,
            `rest://http://user:password@${host}:1234/path/repo`,
            `rest://user:password@${host}:1234/path/repo`,
            `rest://${host}:${host}@${host}:1234/${host}`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.rest) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.rest.hostname).equal(host)
          }
        }
        const hosts = [
          'host',
          'my-host',
          'my.host',
          'sub.my-host.net',
          '127.0.0.1',
        ]
        for (const host of hosts) {
          runTestForHostname(host);
        }
      })
      fancy.it('should parse server protocol', async () => {
        function runTestForProtocol(protocol: string) {
          const protocolStr = protocol? protocol + '://' : ''
          const urls = [
            `rest:${protocolStr}host`,
            `rest://${protocolStr}host`,
            `rest:${protocolStr}user:password@host/path`,
            `rest:${protocolStr}user:password@host:1234/path`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.rest) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.rest.hostname).equal('host')
            if (protocol) {
              expect(backupCr.spec.rest.protocol).equal(protocol)
            } else {
              expect(backupCr.spec.rest.protocol).equal(undefined)
            }
          }
        }
        runTestForProtocol('http');
        runTestForProtocol('https');
        runTestForProtocol('');
      })
      fancy.it('should parse custom port', async () => {
        function runTestForPort(port: string) {
          const urls = [
            `rest:host:${port}`,
            `rest://host:${port}/path`,
            `rest://host:${port}/path/to-repo`,
            `rest://user:password@host:${port}/path`,
            `rest://http://user:${port}@host:${port}/path`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.rest) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.rest.hostname).equal('host')
            expect(backupCr.spec.rest.port).equal(parseInt(port, 10))
          }
        }
        runTestForPort('88')
        runTestForPort('246')
        runTestForPort('1234')
        runTestForPort('18888')
      })
      fancy.it('should parse repository path', async () => {
        function runTestForRepoPath(repoPath: string) {
          const urls = [
            `rest://host/${repoPath}`,
            `rest:host:8888/${repoPath}`,
            `rest:http://host:8888/${repoPath}`,
            `rest://user:password12@host:8888/${repoPath}`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.rest) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.rest.hostname).equal('host')
            expect(backupCr.spec.rest.repositoryPath).equal(repoPath)
          }
        }
        const paths = [
          'path',
          'path-to/repo',
          'pathto/repo/',
          'path-to/repo/',
          'path/my.repo/',
          '.path/.repo/',
          '2222',
          '1111/2222',
        ]
        for (const path of paths) {
          runTestForRepoPath(path)
        }
      })
      fancy.it('should parse credentials', async () => {
        function runTestForCredentials(username: string, password: string) {
          const urls = [
            `rest://${username}:${password}@host.net`,
            `rest:http://${username}:${password}@host.net/path`,
            `rest:${username}:${password}@host.net:1234/path`,
            `rest://https://${username}:${password}@host.net:1245/path-to/repo`,
          ]
          for (const url of urls) {
            const config = getConfig(url)
            const backupCr = parseBackupServerConfig(config)
            if (!backupCr.spec.rest) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.rest.hostname).equal('host.net')
            expect(backupCr.spec.rest.repositoryPasswordSecretRef).equal(BACKUP_REPOSITORY_PASSWORD_SECRET_NAME)
            expect(backupCr.spec.rest.credentialsSecretRef).equal(REST_SERVER_CREDENTIALS_SECRET_NAME)
            expect(config.credentials, 'Credentials undefined').not.equal(undefined)
            expect((config.credentials as RestBackupServerCredentials).username).equal(username)
            expect((config.credentials as RestBackupServerCredentials).password).equal(password)
          }
        }
        const credentials = [
          ['user','password'],
          ['mYUser','test1234'],
          ['my_user12','dhUi8Js9m0leRf7s'],
          ['user','t*O_s2F:u-hIP02p'],
          ['user','host:1234'],
          ['user','port:1234@host'],
          ['user','er:1234@host:fdf@df'],
          ['user',':1234@test:1234:test@'],
        ]
        for (const pair of credentials) {
          runTestForCredentials(pair[0], pair[1])
        }
      })
      fancy.it('should use configured credentials', async () => {
        const username = 'myUser'
        const password = 'u8-kO_P3:j-eFpo'
        const url = 'rest://host:18888/path-to/repo'
        const config = getConfig(url)
        config.credentials = { username, password }
        const backupCr = parseBackupServerConfig(config)
        if (!backupCr.spec.rest) {
          throw new Error(SECTION_ERROR);
        }
        expect(backupCr.spec.rest.hostname).equal('host')
        expect(backupCr.spec.rest.repositoryPasswordSecretRef).equal(BACKUP_REPOSITORY_PASSWORD_SECRET_NAME)
        expect(backupCr.spec.rest.credentialsSecretRef).equal(REST_SERVER_CREDENTIALS_SECRET_NAME)
        expect(config.credentials, 'Credentials undefined').not.equal(undefined)
        expect((config.credentials as RestBackupServerCredentials).username).equal(username)
        expect((config.credentials as RestBackupServerCredentials).password).equal(password)
      })
      fancy.it('should parse URL with all data', async () => {
        const protocol = 'http'
        const username = 'myuser12'
        const password = 'yh3j:sum_8m2Jk'
        const host = 'rest-server.domain.net'
        const port = '4200'
        const path = 'che-repo'
        const url = `rest://${protocol}://${username}:${password}@${host}:${port}/${path}`
        const config = getConfig(url)
        const backupCr = parseBackupServerConfig(config)
        if (!backupCr.spec.rest) {
          throw new Error(SECTION_ERROR);
        }

        expect(backupCr.spec.rest.protocol).equal(protocol)
        expect(backupCr.spec.rest.hostname).equal(host)
        expect(backupCr.spec.rest.port).equal(parseInt(port, 10))
        expect(backupCr.spec.rest.repositoryPath).equal(path)
        expect(backupCr.spec.rest.repositoryPasswordSecretRef).equal(BACKUP_REPOSITORY_PASSWORD_SECRET_NAME)
        expect(backupCr.spec.rest.credentialsSecretRef).equal(REST_SERVER_CREDENTIALS_SECRET_NAME)

        expect(config.credentials).not.equal(undefined)
        expect((config.credentials as RestBackupServerCredentials).username).equal(username)
        expect((config.credentials as RestBackupServerCredentials).password).equal(password)
      })
      fancy.it('should fail on invalid URL', async () => {
        const urls = [
          'rest:/host/path',
          'rest://host,net/path',
          'rest:proto://host/path',
          'rest://host:port/path',
          'rest://host:123s/path',
          'rest:user@host/path',
          'rest:user:@host/path',
          'rest://http://user:@host:1234/path',
        ]
        for (const url of urls) {
          fancy.do(() => parseBackupServerConfig(getConfig(url))).catch(/^Invalid REST server url.*/)
        }
      })
    })

    describe('AWS S3 server URL parsing', () => {
      fancy.it('should allow to omit AWS S3 URL', async () => {
        const urls = [
          's3:/bucket',
          's3:/bucket/',
          's3:///bucket',
          's3:///bucket/',
        ]
        for (const url of urls) {
          const backupCr = parseBackupServerConfig(getConfig(url))
          if (!backupCr.spec.awss3) {
            throw new Error(SECTION_ERROR);
          }
          expect(backupCr.spec.awss3.hostname).equal(undefined)
        }
      })
      fancy.it('should parse hostname', async () => {
        function runTestForHostname(host: string) {
          const urls = [
            `s3://http://${host}/bucket`,
            `s3:http://${host}/bucket`,
            `s3://http://${host}:1234/bucket/`,
            `s3://https://${host}:1234/bucket/`,
            `s3:http://${host}:1234/bucket-name`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.awss3) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.awss3.hostname).equal(host)
          }
        }
        const hosts = [
          'host',
          'my-host',
          'my.host',
          'sub.my-host.net',
          's3.amazonaws.com',
          'my.minio.net',
          '127.0.0.1',
        ]
        for (const host of hosts) {
          runTestForHostname(host);
        }
      })
      fancy.it('should parse custom port', async () => {
        function runTestForPort(port: string) {
          const urls = [
            `s3://host.net:${port}/bucket`,
            `s3://host.net:${port}/bucket/`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.awss3) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.awss3.hostname).equal('host.net')
            expect(backupCr.spec.awss3.port).equal(parseInt(port, 10))
          }
        }
        runTestForPort('88')
        runTestForPort('246')
        runTestForPort('1234')
        runTestForPort('18888')
      })
      fancy.it('should parse bucket name', async () => {
        function runTestForBucket(bucket: string) {
          const urls = [
            `s3://host.net/${bucket}`,
            `s3:host.net:8888/${bucket}`,
            `s3:http://host.net:8888/${bucket}`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.awss3) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.awss3.hostname).equal('host.net')
            expect(backupCr.spec.awss3.repositoryPath).equal(bucket)
          }
        }
        const buckets = [
          'bucket',
          'bucket-che',
          'bucket_che',
          '12345',
          'bucket/sub'
        ]
        for (const bucket of buckets) {
          runTestForBucket(bucket);
          runTestForBucket(bucket + '/')
        }
      })
      fancy.it('should parse URL with all data', async () => {
        const protocol = 'http'
        const host = 's3-server.domain.net'
        const port = '4200'
        const path = 'che-bucket'
        const url = `s3://${protocol}://${host}:${port}/${path}`
        const config = getConfig(url)
        const backupCr = parseBackupServerConfig(config)
        if (!backupCr.spec.awss3) {
          throw new Error(SECTION_ERROR);
        }

        expect(backupCr.spec.awss3.protocol).equal(protocol)
        expect(backupCr.spec.awss3.hostname).equal(host)
        expect(backupCr.spec.awss3.port).equal(parseInt(port, 10))
        expect(backupCr.spec.awss3.repositoryPath).equal(path)
        expect(backupCr.spec.awss3.repositoryPasswordSecretRef).equal(BACKUP_REPOSITORY_PASSWORD_SECRET_NAME)
        expect(backupCr.spec.awss3.awsAccessKeySecretRef).equal(AWS_CREDENTIALS_SECRET_NAME)
      })
      fancy.it('should fail on invalid URL', async () => {
        const urls = [
          's3:host,net/bucket',
          's3://host,net/bucket',
          's3:proto://host.net/bucket',
          's3:http://host.net:port/bucket',
          's3:http://host.net:11p/bucket',
        ]
        for (const url of urls) {
          fancy.do(() => parseBackupServerConfig(getConfig(url))).catch(/^Invalid S3 server url.*/)
        }
      })
    })

    describe('SFTP server URL parsing', () => {
      fancy.it('should parse hostname', async () => {
        function runTestForHostname(host: string) {
          const urls = [
            `sftp:user@${host}:/`,
            `sftp://user@${host}:/`,
            `sftp:user@${host}:/path/to`,
            `sftp://user@${host}:/path/to`,
            `sftp://user@${host}:1234/relpath/to`,
            `sftp://user@${host}:1234//abspath/to`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.sftp) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.sftp.hostname).equal(host)
          }
        }
        const hosts = [
          'host',
          'my-host',
          'my.host',
          'sub.my-host.net',
          '127.0.0.1',
        ]
        for (const host of hosts) {
          runTestForHostname(host);
        }
      })
      fancy.it('should parse username', async () => {
        function runTestFoUsername(user: string) {
          const urls = [
            `sftp:${user}@host.net:/`,
            `sftp://${user}@host.net:/`,
            `sftp:${user}@host.net:/path/to`,
            `sftp://${user}@host.net:/path/to`,
            `sftp://${user}@host.net:1234/relpath/to`,
            `sftp://${user}@host.net:1234//abspath/to`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.sftp) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.sftp.username).equal(user)
          }
        }
        const usernames = [
          'user',
          'user2',
          'test_user',
        ]
        for (const user of usernames) {
          runTestFoUsername(user);
        }
      })
      fancy.it('should parse custom port', async () => {
        function runTestForPort(port: string) {
          const urls = [
            `sftp:user@host.net:${port}/path/to`,
            `sftp:user@host.net:${port}//path/to`,
            `sftp://user@host.net:${port}/path/to`,
            `sftp://user@host.net:${port}//path/to`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.sftp) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.sftp.hostname).equal('host.net')
            expect(backupCr.spec.sftp.port).equal(parseInt(port, 10))
          }
        }
        runTestForPort('88')
        runTestForPort('246')
        runTestForPort('1234')
        runTestForPort('18888')
      })
      fancy.it('should parse path', async () => {
        function runTestForPath(path: string) {
          const urls = [
            `sftp:user@host.net:${path}`,
            `sftp://user@host.net:${path}`,
            `sftp:user@host.net:1234/${path}`,
            `sftp://user@host.net:1234/${path}`,
          ]
          for (const url of urls) {
            const backupCr = parseBackupServerConfig(getConfig(url))
            if (!backupCr.spec.sftp) {
              throw new Error(SECTION_ERROR);
            }
            expect(backupCr.spec.sftp.hostname).equal('host.net')
            expect(backupCr.spec.sftp.repositoryPath).equal(path)
          }
        }
        const paths = [
          'path',
          'path/to',
          'path-to/dir',
          'path_to/dir',
          '/12345',
          '/12345/54321',
        ]
        for (const path of paths) {
          runTestForPath(path);
          runTestForPath(path + '/');
          if (!path.startsWith('/')) {
            runTestForPath('/' + path);
            runTestForPath('/' + path + '/');
          }
        }
      })
      fancy.it('should parse URL with all data', async () => {
        const user = 'webadmin'
        const host = 'server.domain.net'
        const port = '2222'
        const path = '/srv/static/sftp/'
        const url = `sftp://${user}@${host}:${port}/${path}`
        const config = getConfig(url)
        const backupCr = parseBackupServerConfig(config)
        if (!backupCr.spec.sftp) {
          throw new Error(SECTION_ERROR);
        }

        expect(backupCr.spec.sftp.username).equal(user)
        expect(backupCr.spec.sftp.hostname).equal(host)
        expect(backupCr.spec.sftp.port).equal(parseInt(port, 10))
        expect(backupCr.spec.sftp.repositoryPath).equal(path)
        expect(backupCr.spec.sftp.repositoryPasswordSecretRef).equal(BACKUP_REPOSITORY_PASSWORD_SECRET_NAME)
        expect(backupCr.spec.sftp.sshKeySecretRef).equal(SSH_KEY_SECRET_NAME)
      })
      fancy.it('should fail on invalid URL', async () => {
        const urls = [
          'sfpt:user@host.net/path',
          'sfpt://user@host.net/path',
          'sftp:user:user@host.net/path',
          'sftp:user@user@host.net/path',
          'sftp:user@host.net:port//path',
          'sftp:user@host.net:1234:path',
        ]
        for (const url of urls) {
          fancy.do(() => parseBackupServerConfig(getConfig(url))).catch(/^Invalid SFTP server url.*/)
        }
      })
    })
  })

})
