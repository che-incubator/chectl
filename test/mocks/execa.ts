/**
 * Mock for execa module to support ES module in Jest/CommonJS environment
 */

export interface ExecaReturnValue {
  stdout: string
  stderr: string
  exitCode: number
  failed: boolean
  command: string
}

export const execa = jest.fn(async (command: string, args?: string[] | any, options?: any): Promise<ExecaReturnValue> => {
  // Default mock implementation
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    failed: false,
    command: `${command} ${Array.isArray(args) ? args.join(' ') : ''}`
  }
})

export default execa
