// Settings tab: account, Lists (scope and statuses), start defaults, notifications, cached data, about.
import { Button, Callout, Input, KeyValue, Link, Row, Select, Separator, Skeleton, Stack, Switch, Text, read, set } from 'orca'
import * as api from '../api'
import * as st from '../settings'
import type { SettingsState, TaskContextMode } from '../../shared/model'
import * as s from '../state'
import { ListsSection } from './ListsSection'

const AUTH_HELP = 'https://developer.clickup.com/docs/authentication'

function Section(props: { title: string; children: unknown }) {
  return (
    <Stack gap="sm">
      <Text weight="semibold">{props.title}</Text>
      {props.children as never}
    </Stack>
  )
}

function Account() {
  const auth = read(s.auth)
  const busy = read(s.busy)
  const teams = auth?.teams ?? []
  return (
    <Section title="Account">
      <KeyValue
        items={[
          { label: 'Signed in as', value: auth?.user?.name ?? 'Unknown' },
          { label: 'Method', value: auth?.method === 'oauth' ? 'ClickUp OAuth app' : 'Personal API token' }
        ]}
      />
      <Select
        label="Workspace"
        value={auth?.teamId ?? ''}
        options={teams.map((t) => ({ value: t.id, label: t.name }))}
        disabled={busy !== null || teams.length <= 1}
        onChange={(id) => void api.selectTeam(id)}
      />
      <Row>
        <Button variant="outline" tone="danger" size="sm" disabled={busy !== null} onPress={() => void api.disconnect()}>
          Sign out
        </Button>
      </Row>
      <Text size="xs" muted>
        Sign out deletes the token from Orca. ClickUp has no API to revoke a token: to cut access everywhere, regenerate the
        app's secret or delete the app in ClickUp › Settings › Apps (or regenerate your personal token).
      </Text>
    </Section>
  )
}

const CONTEXT_OPTIONS: { value: TaskContextMode; label: string }[] = [
  { value: 'link-and-snapshot', label: 'Link + snapshot (default)' },
  { value: 'snapshot-only', label: 'Snapshot only' },
  { value: 'link-only', label: 'Link only (agent reads ClickUp itself)' }
]

function StartDefaults(props: { state: SettingsState }) {
  const { settings, agents } = props.state
  const saving = read(st.settingsSaving)
  const draft = read(st.baseBranchDraft)
  const dirty = draft.trim() !== settings.defaultBaseBranch
  return (
    <Section title="Start defaults">
      <Select
        label="Default agent"
        value={settings.defaultAgent}
        options={agents.map((a) => ({ value: a.id, label: a.label }))}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ defaultAgent: v })}
      />
      <Select
        label="Task context"
        value={settings.taskContext}
        options={CONTEXT_OPTIONS}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ taskContext: v as TaskContextMode })}
      />
      <Switch
        label="Move the task to its List's in-progress status on start"
        checked={settings.moveToInProgress}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ moveToInProgress: v })}
      />
      <Switch
        label="Move the task to its List's review status when the agent first finishes"
        checked={settings.moveOnDone}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ moveOnDone: v })}
      />
      <Switch
        label="Comment on the task when it starts and finishes (branch, agent)"
        checked={settings.commentOnStart}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ commentOnStart: v })}
      />
      <Input
        label="Default base branch"
        value={draft}
        placeholder="Project default"
        disabled={saving}
        onChange={(v) => set(st.baseBranchDraft, v)}
        onSubmit={() => void st.saveBaseBranch()}
      />
      {dirty ? (
        <Row>
          <Button size="sm" disabled={saving} onPress={() => void st.saveBaseBranch()}>
            Save
          </Button>
        </Row>
      ) : null}
    </Section>
  )
}

function Notifications(props: { state: SettingsState }) {
  const { settings } = props.state
  const saving = read(st.settingsSaving)
  return (
    <Section title="Notifications">
      <Switch
        label="When an agent finishes"
        checked={settings.notifyOnDone}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ notifyOnDone: v })}
      />
      <Switch
        label="When an agent needs input"
        checked={settings.notifyOnNeedsInput}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ notifyOnNeedsInput: v })}
      />
    </Section>
  )
}

function Data() {
  const saving = read(st.settingsSaving)
  const notice = read(st.settingsNotice)
  return (
    <Section title="Data">
      {notice ? <Callout tone="success">{notice}</Callout> : null}
      <Row>
        <Button variant="outline" size="sm" disabled={saving} onPress={() => void st.clearCache()}>
          Clear cached tasks
        </Button>
      </Row>
      <Text size="xs" muted>
        Your token, settings and started workspaces are kept.
      </Text>
    </Section>
  )
}

function About() {
  return (
    <Section title="About">
      <Text size="sm" muted>
        ClickUp Tasks
      </Text>
      <Link onPress={() => void api.openExternalLink(AUTH_HELP)}>ClickUp authentication docs</Link>
    </Section>
  )
}

export function SettingsView() {
  const state = read(st.settingsState)
  const error = read(st.settingsError)
  if (!state) {
    if (error) {
      return (
        <Callout tone="danger" title="Could not load settings">
          <Stack gap="sm">
            <Text>{api.messageFor(error)}</Text>
            <Row>
              <Button size="sm" onPress={() => void st.loadSettings()}>
                Retry
              </Button>
            </Row>
          </Stack>
        </Callout>
      )
    }
    return <Skeleton lines={6} />
  }
  return (
    <Stack gap="md">
      {error ? <Callout tone="danger">{api.messageFor(error)}</Callout> : null}
      <Account />
      <Separator />
      <Section title="Lists">
        <ListsSection />
      </Section>
      <Separator />
      <StartDefaults state={state} />
      <Separator />
      <Notifications state={state} />
      <Separator />
      <Data />
      <Separator />
      <About />
    </Stack>
  )
}
