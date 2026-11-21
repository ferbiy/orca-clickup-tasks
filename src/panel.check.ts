// `orca plugin check` renders the panel once per scenario with the real worker on a mock host.
// Seeds are what the worker reads from storage and secrets; no scenario reaches ClickUp.
import { defineCheck } from 'orca/testing'
import type { JsonValue } from 'orca'
import { checkChildren, checkComments, checkDetail, checkPage, checkSpaces, checkStatuses, checkTasks } from './panel/check-fixtures'

/** Plain JSON copy: storage seeds are JsonValue, the model types have no index signature. */
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const tasksJson = json(checkTasks)

const now = Date.now()
const connected = {
  results: { 'secrets.protection': { status: 'os-keyring' } },
  secrets: { 'clickup.token': 'pk_check' },
  storage: {
    'auth.profile': { user: { id: 'u1', name: 'Linh N.' }, teams: [{ id: 't1', name: 'Acme Engineering' }] },
    'prefs.userId': 'u1',
    'prefs.teamId': 't1'
  }
}

export default defineCheck({
  disconnected: { results: { 'secrets.protection': { status: 'os-keyring' } } },
  noKeychain: { results: { 'secrets.protection': { status: 'unavailable' } } },
  tasks: {
    ...connected,
    storage: { ...connected.storage, 'cache.tasks': { teamId: 't1', fetchedAt: now, tasks: tasksJson } }
  },
  // My tasks with a preset and a priority on, as restored from the persisted filter. `filtersOpen` is not
  // persisted, so a check cannot open the box: this renders the closed summary line and the active
  // Filters button; the open box is covered by views.test.tsx.
  filtersOpen: {
    ...connected,
    persisted: { plugin: { filter: { query: '', listId: '', presets: ['no-estimate'], priority: 'high', due: 'any', sort: 'default' } } },
    storage: { ...connected.storage, 'cache.tasks': { teamId: 't1', fetchedAt: now, tasks: tasksJson } }
  },
  emptyTasks: {
    ...connected,
    storage: { ...connected.storage, 'cache.tasks': { teamId: 't1', fetchedAt: now, tasks: [] } }
  },
  // Spaces and one Space's children come from the worker cache; the Space is open from the last run.
  browseTree: {
    ...connected,
    persisted: { plugin: { activeTab: 'browse', browseExpanded: ['space:sp1', 'folder:f1'] } },
    storage: {
      ...connected.storage,
      'cache.tasks': { teamId: 't1', fetchedAt: now, tasks: tasksJson },
      'cache.spaces': { teamId: 't1', fetchedAt: now, spaces: json(checkSpaces) },
      'cache.children': { sp1: { fetchedAt: now, children: json(checkChildren) } }
    }
  },
  // A List's tasks always come from ClickUp, so this scenario answers browse.tasks itself.
  browseList: {
    ...connected,
    persisted: {
      plugin: {
        activeTab: 'browse',
        browseSelection: { list: { id: 'L-web', name: 'Sprint 42', breadcrumb: 'Web App › Sprints' }, includeClosed: false }
      }
    },
    requests: {
      'browse.tasks': { ok: true, value: json(checkPage) },
      'tasks.list': { ok: true, value: { tasks: json(checkTasks), fetchedAt: now, stale: false } }
    } as never
  },
  // Browse with filters on, as restored from the persisted atom.
  browseFiltersOpen: {
    ...connected,
    persisted: {
      plugin: {
        activeTab: 'browse',
        browseSelection: { list: { id: 'L-web', name: 'Sprint 42', breadcrumb: 'Web App › Sprints' }, includeClosed: false },
        browseFilter: { query: '', listId: '', presets: ['no-estimate'], priority: 'high', due: 'any', sort: 'due' }
      }
    },
    requests: {
      'browse.tasks': { ok: true, value: json(checkPage) },
      'tasks.list': { ok: true, value: { tasks: json(checkTasks), fetchedAt: now, stale: false } }
    } as never
  },
  settingsTab: {
    ...connected,
    persisted: { plugin: { activeTab: 'settings' } },
    requests: {
      'tasks.list': { ok: true, value: { tasks: json(checkTasks), fetchedAt: now, stale: false } }
    } as never
  },
  // 8a: title mid-edit (persisted editing state for the open task).
  detailEditingTitle: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'name', draft: 'Rename the webhooks migration', error: null }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8a: description editor on the Write tab (toolbar + Textarea).
  detailDescriptionWrite: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'description', draft: '## Plan\n\n- one\n- **two**', error: null },
        descriptionTab: 'write'
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8a: the same editor on the Preview tab (Markdown of the draft).
  detailDescriptionPreview: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'description', draft: '## Plan\n\n- one\n- **two**', error: null },
        descriptionTab: 'preview'
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8a: assignee picker open over cached Workspace members.
  detailAssigneePicker: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        picker: { taskId: checkDetail.id, kind: 'assignees', query: 'sa' }
      }
    },
    storage: {
      ...connected.storage,
      'cache.members': { teamId: 't1', fetchedAt: now, members: json([{ id: 'u1', name: 'Linh Nguyen', initials: 'LN' }, { id: 'u2', name: 'Sam Reyes', initials: 'SR' }]) }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8a: fields ClickUp refused stay read-only ("No permission in ClickUp").
  detailLockedField: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        locked: { [checkDetail.id]: ['priority', 'dueDate'] }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8a: a date input that failed to parse shows its error line.
  detailDateInvalid: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'dueDate', draft: 'friday', error: 'Try 2026-08-01, today, tomorrow, +7d or +2w.' }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: [], next: null } }
    } as never
  },
  // 8b: renaming a checklist inline.
  detailChecklistRename: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'checklistName', key: 'cl1', draft: 'Ship steps', error: null }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: null } }
    } as never
  },
  // 8b: the comment composer with the mention picker open over cached members.
  detailCommentMention: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        picker: { taskId: checkDetail.id, kind: 'mention', query: '' }
      }
    },
    storage: {
      ...connected.storage,
      'cache.members': { teamId: 't1', fetchedAt: now, members: json([{ id: 'u1', name: 'Linh Nguyen', initials: 'LN' }, { id: 'u2', name: 'Sam Reyes', initials: 'SR' }]) }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: null } }
    } as never
  },
  // 8b: an open thread with the inline reply composer under it.
  detailReplyComposer: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        replies: { c2: { open: true, loading: false, items: json([checkComments[0]!]), error: null } }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: null } }
    } as never
  },
  // 8b: editing one's own comment (author id = the signed-in user u1).
  detailCommentEdit: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        editing: { taskId: checkDetail.id, field: 'commentEdit', key: 'c2', draft: 'Can we keep v1 alive until Friday, please?', error: null }
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: null } }
    } as never
  },
  // 8b: a delete button after its first press ("Sure?").
  detailDeleteConfirm: {
    ...connected,
    persisted: {
      plugin: {
        screen: { name: 'detail', taskId: checkDetail.id, backTo: null },
        confirm: 'comment:c2'
      }
    },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: null } }
    } as never
  },
  richDetail: {
    ...connected,
    persisted: { plugin: { screen: { name: 'detail', taskId: checkDetail.id, backTo: null } } },
    requests: {
      'tasks.get': { ok: true, value: json(checkDetail) },
      'tasks.statuses': { ok: true, value: json(checkStatuses) },
      'tasks.comments': { ok: true, value: { comments: json(checkComments), next: { start: 1, startId: 'c3' } } }
    } as never
  }
})
