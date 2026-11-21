// Settings tab: account, cached data, about.
import { Button, Callout, KeyValue, Link, Row, Select, Separator, Stack, Text, read } from 'orca'
import * as api from '../api'
import * as st from '../settings'
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
        Your token and Workspace choice are kept.
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
  const error = read(st.settingsError)
  return (
    <Stack gap="md">
      {error ? <Callout tone="danger">{api.messageFor(error)}</Callout> : null}
      <Account />
      <Separator />
      <Data />
      <Separator />
      <About />
    </Stack>
  )
}
