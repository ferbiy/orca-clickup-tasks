// The Orca adapter over a stand-in host: the Overhedge build's paired-server fields are read when
// present and never sent to a host that would refuse them.
import { assert, describe, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { orcaGateway } from './orca-adapters'

function fakeOrca(answers: Record<string, unknown>) {
  const calls: { method: string; params: unknown }[] = []
  const logs: string[] = []
  const orca = {
    host: {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params })
        return answers[method]
      }
    },
    log: (message: string) => logs.push(message)
  } as unknown as OrcaWorkerApi
  return { orca, calls, logs }
}

describe('orcaGateway', () => {
  test("a paired server's projects keep the server's name; a server with no answer is logged", async () => {
    const { orca, logs } = fakeOrca({
      'project.list': {
        projects: [
          { id: 'a', name: 'future', kind: 'git', hostId: 'local', path: '/a' },
          { id: 'b', name: 'overhedge_v2', kind: 'git', hostId: 'runtime:env1', path: '/b', hostLabel: 'orca-ide' }
        ],
        truncated: false,
        unreachableHostIds: ['runtime:env2']
      }
    })
    const projects = await orcaGateway(orca).listProjects()
    assert.deepEqual(projects.map((p) => [p.id, p.hostId, p.hostLabel]), [['a', 'local', null], ['b', 'runtime:env1', 'orca-ide']])
    assert.deepEqual(logs, ['project.list: no answer from runtime:env2'])
  })

  test('agents.list names the host only for a paired server', async () => {
    const { orca, calls } = fakeOrca({ 'agents.list': { agents: [] } })
    const gateway = orcaGateway(orca)
    await gateway.listAgents('w1', 'local')
    await gateway.listAgents('w2')
    await gateway.listAgents('w3', 'runtime:env1')
    assert.deepEqual(calls.map((c) => c.params), [{ workspaceId: 'w1' }, { workspaceId: 'w2' }, { workspaceId: 'w3', hostId: 'runtime:env1' }])
  })
})
