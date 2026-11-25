// Sample tasks for panel checks and view tests (the same tasks as docs/design/Main.dc.html).
import type { ListTasksPage, SettingsState, SpaceChildren, SpaceRef, StartOptions, StatusOption, TaskComment, TaskDetail, TaskSummary } from '../shared/model'

const base = { customId: null, parentId: null, updatedAt: 1, dueDate: null }
// Both presets match some tasks: created today = at or after local midnight, estimates mixed.
const today = new Date().setHours(0, 0, 0, 0) + 1000
const DAY = 86_400_000
const HOUR = 3_600_000

export const checkTasks: TaskSummary[] = [
  { ...base, id: '86c0p1f', createdAt: today, timeEstimateMs: null, name: 'Fix login redirect loop on Safari', status: { name: 'in progress', type: 'custom', color: '#4194f6' }, priority: 'urgent', url: 'https://app.clickup.com/t/86c0p1f', list: { id: 'L-web', name: 'Sprint 42' }, location: 'Web App › Sprint 42' },
  { ...base, id: '86c0q8r', createdAt: today, timeEstimateMs: HOUR, name: 'Rate-limit public search API', status: { name: 'in progress', type: 'custom', color: '#4194f6' }, priority: 'high', url: 'https://app.clickup.com/t/86c0q8r', list: { id: 'L-api', name: 'Backlog' }, location: 'API › Backlog' },
  { ...base, id: '86c1x2a', createdAt: today - DAY, timeEstimateMs: null, name: 'Migrate billing webhooks to v2', status: { name: 'to do', type: 'open', color: '#d3d3d3' }, priority: 'high', url: 'https://app.clickup.com/t/86c1x2a', list: { id: 'L-api', name: 'Backlog' }, location: 'API › Backlog' },
  { ...base, id: '86c1y7m', createdAt: today - 3 * DAY, timeEstimateMs: 2 * HOUR, name: 'Add CSV export to reports', status: { name: 'to do', type: 'open', color: '#d3d3d3' }, priority: 'normal', url: 'https://app.clickup.com/t/86c1y7m', list: { id: 'L-web', name: 'Sprint 42' }, location: 'Web App › Sprint 42' },
  { ...base, id: '86c1z3k', createdAt: today - DAY, timeEstimateMs: HOUR, name: 'Dark mode for settings page', status: { name: 'to do', type: 'open', color: '#d3d3d3' }, priority: 'low', url: 'https://app.clickup.com/t/86c1z3k', list: { id: 'L-web', name: 'Sprint 42' }, location: 'Web App › Sprint 42' },
  { ...base, id: '86c0z7k', createdAt: today, timeEstimateMs: null, name: 'Dedupe Stripe customer records', status: { name: 'review', type: 'custom', color: '#a875ff' }, priority: null, url: 'https://app.clickup.com/t/86c0z7k', list: { id: 'L-api', name: 'Backlog' }, location: 'API › Backlog' }
]

// ── Browse and rich detail ─────────────────────────────────────────────────

export const checkSpaces: SpaceRef[] = [
  { id: 'sp1', name: 'Web App' },
  { id: 'sp2', name: 'API' }
]

export const checkChildren: SpaceChildren = {
  spaceId: 'sp1',
  folders: [{ id: 'f1', name: 'Sprints', lists: [{ id: 'L-web', name: 'Sprint 42', taskCount: 14 }, { id: 'L-web2', name: 'Sprint 41', taskCount: 31 }] }],
  lists: [{ id: 'L-ideas', name: 'Ideas', taskCount: 1 }, { id: 'L-misc', name: 'Misc', taskCount: null }]
}

export const checkPage: ListTasksPage = { listId: 'L-web', page: 0, tasks: checkTasks.filter((t) => t.list.id === 'L-web'), lastPage: false }

export const checkDetail: TaskDetail = {
  ...checkTasks[2]!,
  dueDate: Date.now() + 3 * 86_400_000,
  description: 'Move the **billing webhooks** to v2.\n\n- keep the old endpoint for one release\n- add signature checks',
  checklists: [
    {
      id: 'cl1',
      name: 'Steps',
      items: [
        { id: 'i1', name: 'Draft', resolved: true },
        { id: 'i2', name: 'Ship', resolved: false }
      ]
    }
  ],
  subtasks: [
    { id: '86c1x2b', name: 'Add v2 signature check', status: { name: 'in progress', type: 'custom', color: '#4194f6' } },
    { id: '86c1x2c', name: 'Write the migration note', status: { name: 'to do', type: 'open', color: '#d3d3d3' } }
  ],
  tags: ['billing', 'backend'],
  assignees: [{ id: 'u1', name: 'Linh Nguyen', initials: 'LN' }, { id: 'u2', name: 'Sam Reyes', initials: 'SR' }],
  watchers: [{ id: 'u2', name: 'Sam Reyes', initials: 'SR' }],
  startDate: null,
  spaceId: 'sp1',
  timeEstimateMs: 9_000_000,
  timeSpentMs: 3_600_000,
  attachments: [
    { id: 'a1', title: 'webhook-flow.png', url: 'https://t1.clickup.com/a1', extension: 'png', size: 1_258_291, createdAt: Date.now() - 86_400_000 },
    { id: 'a2', title: 'payload-sample.json', url: 'https://t1.clickup.com/a2', extension: 'json', size: 820, createdAt: null }
  ],
  customFields: []
}

const person = { id: 'u2', name: 'Sam Reyes', initials: 'SR' }
export const checkComments: TaskComment[] = [
  { id: 'c1', author: person, text: 'Staging looks good, switching traffic tomorrow.', assignee: null, resolved: false, createdAt: Date.now() - 3_600_000, replyCount: 0 },
  { id: 'c2', author: { id: 'u1', name: 'Linh Nguyen', initials: 'LN' }, text: 'Can we keep v1 alive until Friday?', assignee: person, resolved: false, createdAt: Date.now() - 7_200_000, replyCount: 2 },
  { id: 'c3', author: null, text: 'Created from the billing epic.', assignee: null, resolved: false, createdAt: Date.now() - 86_400_000, replyCount: 0 }
]

export const checkStatuses: StatusOption[] = [
  { name: 'to do', type: 'open', order: 0, color: '#d3d3d3' },
  { name: 'in progress', type: 'custom', order: 1, color: '#4194f6' },
  { name: 'review', type: 'custom', order: 2, color: '#a875ff' }
]

export const checkOptions: StartOptions = {
  projects: [
    { id: 'p1', name: 'billing', hostId: 'local', hostLabel: 'this computer' },
    { id: 'p2', name: 'billing', hostId: 'runtime:srv', hostLabel: 'Orca server' }
  ],
  suggestedProjectId: 'p1',
  agents: [{ id: 'claude', label: 'Claude' }],
  workspaceName: 'CU-86c1x2a-Migrate-billing-webhooks-to-v2',
  inProgressStatus: 'in progress',
  inProgressWhy: "Automatic, from this List's status types.",
  defaults: { agent: 'claude', moveToInProgress: true, baseBranch: '', taskContext: 'link-and-snapshot' }
}

export const checkSettings: SettingsState = {
  settings: {
    defaultAgent: 'claude',
    moveToInProgress: true,
    commentOnStart: true,
    moveOnDone: false,
    defaultBaseBranch: '',
    notifyOnDone: true,
    notifyOnNeedsInput: false,
    taskContext: 'link-and-snapshot'
  },
  agents: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }]
}
