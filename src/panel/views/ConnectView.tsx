// Connect screen: token form, or the Workspace picker once a token is verified but no Workspace is chosen.
import { Button, Callout, Heading, Input, Row, Select, Spinner, Stack, Text, read, set } from 'orca'
import * as api from '../api'
import * as s from '../state'

export function ConnectView() {
  const auth = read(s.auth)
  const notice = read(s.notice)
  const busy = read(s.busy)
  const draft = read(s.tokenDraft)
  const noKeychain = auth?.secretProtection === 'unavailable'
  const pickTeam = auth?.connected === true && !auth.teamId

  return (
    <Stack gap="md">
      <Heading level={2}>Connect ClickUp</Heading>
      <Text muted>See the tasks assigned to you, browse your Spaces and edit tasks without leaving Orca.</Text>
      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
      {noKeychain ? (
        <Callout tone="danger" title="No keychain available">
          This system has no OS keychain, so the token cannot be stored safely.
        </Callout>
      ) : null}
      {pickTeam ? (
        <Select
          label="Workspace"
          placeholder="Choose a Workspace"
          value=""
          options={auth.teams.map((t) => ({ value: t.id, label: t.name }))}
          disabled={busy !== null}
          onChange={(id) => void api.selectTeam(id)}
        />
      ) : (
        <Stack gap="sm">
          <Input
            label="Personal API token"
            type="password"
            value={draft}
            placeholder="pk_…"
            disabled={busy !== null}
            onChange={(v) => set(s.tokenDraft, v)}
            onSubmit={() => void api.connect()}
          />
          <Text size="xs" muted>
            In ClickUp: avatar → Settings → Apps → API Token. Saved in your OS keychain.
          </Text>
          <Row gap="sm" align="center">
            <Button
              variant="solid"
              disabled={noKeychain || busy !== null || draft.trim() === ''}
              onPress={() => void api.connect()}
            >
              Connect
            </Button>
            {busy ? <Spinner label={busy} /> : null}
          </Row>
        </Stack>
      )}
      <Text size="xs" muted>
        Read-only until you press Start.
      </Text>
    </Stack>
  )
}
