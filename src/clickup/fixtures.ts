// Trimmed, realistic ClickUp API v2 payloads for the adapter tests.

export const USER_RESPONSE = {
  user: { id: 183, username: 'Ada Lovelace', email: 'ada@example.com', color: '#7b68ee' }
}

export const TEAMS_RESPONSE = {
  teams: [
    { id: '9001234', name: 'Acme Engineering', color: '#536cfe', members: [] },
    { id: '9005678', name: 'Side Project', color: '#ff0000', members: [] }
  ]
}

/** Full-featured task from the team-task endpoint (no space name, only space id). */
export const TASK_FULL = {
  id: '86c1x2a',
  custom_id: 'ENG-142',
  name: 'Migrate billing webhooks',
  status: { status: 'in progress', type: 'custom', orderindex: 1, color: '#4194f6' },
  priority: { id: '2', priority: 'high', color: '#ffcc00', orderindex: '2' },
  due_date: '1795000000000',
  date_created: '1790000000000',
  date_updated: '1794000000000',
  parent: null,
  url: 'https://app.clickup.com/t/86c1x2a',
  list: { id: '901100', name: 'Sprint 42', access: true },
  folder: { id: '700', name: 'Backend', hidden: false, access: true },
  space: { id: '300' },
  tags: [{ name: 'billing' }, { name: 'tech-debt' }]
}

/** No priority, no due date, a subtask of 86c1x2a, hidden folder (a folderless List). */
export const TASK_SUBTASK = {
  id: '86c1x3b',
  custom_id: null,
  name: 'Update webhook signature check',
  status: { status: 'to do', type: 'open', orderindex: 0 },
  priority: null,
  due_date: null,
  date_created: '1790000100000',
  date_updated: '1790000200000',
  parent: '86c1x2a',
  url: 'https://app.clickup.com/t/86c1x3b',
  list: { id: '901101', name: 'Inbox' },
  folder: { id: '701', name: 'hidden', hidden: true },
  space: { id: '300' }
}

/** Unknown status type, as a custom workflow might send. */
export const TASK_ODD_STATUS = {
  ...TASK_SUBTASK,
  id: '86c1x4c',
  parent: null,
  status: { status: 'blocked', type: 'weird', orderindex: 2 }
}

export const TASK_DETAIL = {
  ...TASK_FULL,
  space: { id: '300', name: 'Platform' },
  description: 'Plain text description',
  markdown_description: '## Goal\n\nMove webhooks to **v2**.',
  checklists: [
    {
      id: 'c1',
      name: 'Rollout',
      items: [
        { id: 'i1', name: 'Add endpoint', resolved: true },
        { id: 'i2', name: 'Switch traffic', resolved: false }
      ]
    }
  ],
  subtasks: [{ id: '86c1x3b', name: 'Update webhook signature check', status: { status: 'to do', type: 'open' } }]
}

export function taskPage(tasks: readonly unknown[], lastPage?: boolean): unknown {
  return lastPage === undefined ? { tasks } : { tasks, last_page: lastPage }
}

/** `count` distinct minimal tasks, for pagination tests. */
export function manyTasks(count: number, prefix: string): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    ...TASK_SUBTASK,
    id: `${prefix}${i}`,
    parent: null
  }))
}

export const LIST_RESPONSE = {
  id: '901100',
  name: 'Sprint 42',
  statuses: [
    { id: 's3', status: 'complete', type: 'closed', orderindex: 3, color: '#6bc950' },
    { id: 's0', status: 'to do', type: 'open', orderindex: 0, color: '#d3d3d3' },
    { id: 's2', status: 'done', type: 'done', orderindex: 2, color: '#6bc950' },
    { id: 's1', status: 'in progress', type: 'custom', orderindex: 1, color: '#4194f6' }
  ]
}

export const OAUTH_017_BODY = { err: 'Authorization header required', ECODE: 'OAUTH_017' }
export const NOT_FOUND_BODY = { err: 'Task not found', ECODE: 'ITEM_015' }
export const BAD_STATUS_BODY = { err: 'Status does not exist', ECODE: 'CRTSK_001' }

/** Detail with the Phase 3 fields: assignees, time, attachments (one good, three that must drop). */
export const TASK_RICH = {
  ...TASK_DETAIL,
  assignees: [
    { id: 183, username: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com', color: '#7b68ee' },
    { id: '184', username: 'grace hopper', email: 'grace@example.com' }
  ],
  time_estimate: '5400000',
  time_spent: 1800000,
  attachments: [
    { id: 'a1', title: 'spec.PNG', url: 'https://attachments.clickup.com/a1/spec.png', extension: 'PNG', size: 2048, date: '1790000300000', is_folder: false, hidden: false },
    { id: 'a2', title: 'insecure', url: 'http://attachments.clickup.com/a2.png', extension: 'png', size: '10', date: '1790000300001' },
    { id: 'a3', title: 'folder', url: 'https://attachments.clickup.com/a3', is_folder: true },
    { id: 'a4', title: 'hidden', url: 'https://attachments.clickup.com/a4', hidden: true }
  ]
}

export const SPACES_RESPONSE = {
  spaces: [
    { id: '300', name: 'Platform', private: false },
    { id: 301, name: 'Design' }
  ]
}

export const FOLDERS_RESPONSE = {
  folders: [
    { id: '700', name: 'Backend', hidden: false, task_count: '12', lists: [{ id: '901100', name: 'Sprint 42', task_count: 7 }, { id: '901102', name: 'Backlog', task_count: '40' }] },
    { id: '701', name: 'hidden', hidden: true, lists: [{ id: '901101', name: 'Inbox', task_count: 1 }] }
  ]
}

export const FOLDERLESS_LISTS_RESPONSE = {
  lists: [
    { id: '901200', name: 'Ideas', task_count: 3 },
    { id: '901201', name: 'Empty', task_count: null }
  ]
}

/** `count` comments, newest first, ids `c{count-1}`…`c0`, dates 1790000000000 + n. */
export function commentsPage(count: number): unknown {
  return {
    comments: Array.from({ length: count }, (_, i) => {
      const n = count - 1 - i
      return {
        id: `c${n}`,
        comment: [{ text: `comment ${n}` }],
        comment_text: `comment ${n}`,
        user: { id: 183, username: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' },
        resolved: false,
        reactions: [],
        date: String(1790000000000 + n),
        reply_count: n === 0 ? '2' : '0'
      }
    })
  }
}
