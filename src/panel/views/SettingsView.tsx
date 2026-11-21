// Settings tab: account, start defaults, notifications, cached data, about.
import { Button, Callout, Input, KeyValue, Link, Row, Select, Separator, Skeleton, Stack, Switch, Text, read, set } from 'orca'
import * as api from '../api'
import * as st from '../settings'
import type { SettingsState, TaskContextMode } from '../../shared/model'
import * as s from '../state'

const TOKEN_HELP = 'https://developer.clickup.com/docs/authentication#personal-token'

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
      <KeyValue items={[{ label: 'Signed in as', value: auth?.user?.name ?? 'Unknown' }]} />
      <Select
        label="Workspace"
        value={auth?.teamId ?? ''}
        options={teams.map((t) => ({ value: t.id, label: t.name }))}
        disabled={busy !== null || teams.length <= 1}
        onChange={(id) => void api.selectTeam(id)}
      />
      <Row>
        <Button variant="outline" tone="danger" size="sm" disabled={busy !== null} onPress={() => void api.disconnect()}>
          Disconnect
        </Button>
      </Row>
    </Section>
  )
}

const CONTEXT_OPTIONS: { value: TaskContextMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'link-and-snapshot', label: 'Link + snapshot' },
  { value: 'link-only', label: 'Link only' },
  { value: 'snapshot-only', label: 'Snapshot only' }
]

function StartDefaults(props: { state: SettingsState }) {
  const { settings, agents, clickUpReaders } = props.state
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
      {clickUpReaders.length > 0 ? (
        <Stack gap="xs">
          <Text size="xs" muted>
            Agents that read ClickUp themselves: {clickUpReaders.join(', ')}
          </Text>
          <Row>
            <Button variant="outline" size="sm" disabled={saving} onPress={() => void st.forgetAgentContext()}>
              Forget what agents can read
            </Button>
          </Row>
        </Stack>
      ) : null}
      <Switch
        label="Move task to “In progress” on start"
        checked={settings.moveToInProgress}
        disabled={saving}
        onChange={(v) => void st.saveSetting({ moveToInProgress: v })}
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
      <Link onPress={() => void api.openExternalLink(TOKEN_HELP)}>How to get a ClickUp API token</Link>
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
