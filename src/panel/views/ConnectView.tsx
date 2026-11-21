// Connect screen: step-by-step token form, or the Workspace picker once a token is verified but no Workspace is chosen.
import { Button, Callout, Heading, Input, Link, Row, Select, Spinner, Stack, Text, read, set } from 'orca'
import * as api from '../api'
import * as s from '../state'

/** ClickUp's page with the Personal API token (Settings → Apps). */
export const TOKEN_PAGE = 'https://app.clickup.com/settings/apps'

function Step(props: { n: number; children: unknown }) {
  return (
    <Row gap="sm" align="start">
      <Text weight="semibold">{`${props.n}.`}</Text>
      <Stack gap="xs">{props.children as never}</Stack>
    </Row>
  )
}

export function ConnectView() {
  const auth = read(s.auth)
  const notice = read(s.notice)
  const busy = read(s.busy)
  const draft = read(s.tokenDraft)
  const noKeychain = auth?.secretProtection === 'unavailable'
  const pickTeam = auth?.connected === true && !auth.teamId
  const trimmed = draft.trim()
  const looksWrong = trimmed !== '' && !trimmed.startsWith('pk_')

  return (
    <Stack gap="md">
      <Heading level={2}>Connect ClickUp</Heading>
      <Text muted>See the ClickUp tasks assigned to you, browse your Spaces and Lists, and edit tasks without leaving Orca.</Text>
      {notice ? (
        <Callout tone={notice.tone} title={notice.tone === 'danger' ? 'Could not connect' : undefined}>
          {notice.text}
        </Callout>
      ) : null}
      {noKeychain ? (
        <Callout tone="danger" title="No keychain available">
          This system has no OS keychain, so the token cannot be stored safely. On Linux, install and unlock GNOME Keyring or KWallet, then restart Orca.
        </Callout>
      ) : null}
      {pickTeam ? (
        <Stack gap="sm">
          <Text>You belong to more than one ClickUp Workspace. Pick the one to show.</Text>
          <Select
            label="Workspace"
            placeholder="Choose a Workspace"
            value=""
            options={auth.teams.map((t) => ({ value: t.id, label: t.name }))}
            disabled={busy !== null}
            onChange={(id) => void api.selectTeam(id)}
          />
        </Stack>
      ) : (
        <Stack gap="md">
          <Text weight="semibold">Connect with your Personal API token</Text>
          <Step n={1}>
            <Text>Open the Apps page of your ClickUp settings.</Text>
            <Link onPress={() => void api.openExternalLink(TOKEN_PAGE)}>Open ClickUp settings ↗</Link>
          </Step>
          <Step n={2}>
            <Text>
              Under API Token, press Generate (first time only) or Copy. The token starts with pk_.
            </Text>
          </Step>
          <Step n={3}>
            <Text>Paste it below and press Connect.</Text>
          </Step>
          <Input
            label="Personal API token"
            type="password"
            value={draft}
            placeholder="pk_12345678_…"
            disabled={busy !== null}
            onChange={(v) => set(s.tokenDraft, v)}
            onSubmit={() => void api.connect()}
          />
          {looksWrong ? (
            <Text size="xs" tone="warning">
              ClickUp personal tokens start with pk_. Check that you copied the whole token.
            </Text>
          ) : null}
          <Row gap="sm" align="center">
            <Button variant="solid" disabled={noKeychain || busy !== null || trimmed === ''} onPress={() => void api.connect()}>
              Connect
            </Button>
            {busy ? <Spinner label={busy} /> : null}
          </Row>
        </Stack>
      )}
      <Text size="xs" muted>
        The token is saved in your OS keychain and sent only to api.clickup.com. ClickUp changes only when you edit
        something. Disconnect any time in Settings.
      </Text>
    </Stack>
  )
}
