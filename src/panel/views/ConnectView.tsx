// Connect screen: sign in with ClickUp (OAuth, the default), the personal-token fallback, or the
// Workspace picker once signed in but no Workspace is chosen.
import { Button, Callout, Code, Collapsible, Heading, Input, Row, Select, Spinner, Stack, Text, read, set } from 'orca'
import * as api from '../api'
import * as s from '../state'

const DEFAULT_REDIRECT = 'http://127.0.0.1:47386/callback'

function AppForm() {
  const auth = read(s.auth)
  const draft = read(s.oauthDraft)
  const busy = read(s.busy)
  const saved = auth?.oauth.clientId ?? null
  return (
    <Stack gap="sm">
      <Text size="sm">
        Create an OAuth app once in ClickUp (avatar › Settings › Apps › Create new app) with the redirect URL below, then paste
        its client id and secret here. They are kept in your OS keychain through Orca, never in files or the plugin.
      </Text>
      <Input
        label="Client ID"
        value={draft.clientId}
        placeholder={saved ?? ''}
        disabled={busy !== null}
        onChange={(clientId) => api.patchOAuthDraft({ clientId })}
      />
      <Input
        label="Client secret"
        type="password"
        value={draft.clientSecret}
        placeholder={saved ? 'Saved. Leave empty to keep it' : ''}
        disabled={busy !== null}
        onChange={(clientSecret) => api.patchOAuthDraft({ clientSecret })}
      />
      <Input
        label="Redirect URL (as registered in ClickUp)"
        value={draft.redirectUri}
        placeholder={auth?.oauth.redirectUri || DEFAULT_REDIRECT}
        disabled={busy !== null}
        onChange={(redirectUri) => api.patchOAuthDraft({ redirectUri })}
      />
      <Row gap="sm" align="center">
        <Button
          variant="solid"
          disabled={busy !== null || draft.clientId.trim() === '' || (!saved && draft.clientSecret.trim() === '')}
          onPress={() => void api.saveOAuthApp()}
        >
          Save app
        </Button>
        {saved ? (
          <Button variant="ghost" disabled={busy !== null} onPress={() => set(s.oauthEditing, false)}>
            Cancel
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

function SignIn() {
  const auth = read(s.auth)
  const busy = read(s.busy)
  const paste = read(s.oauthPaste)
  const pending = auth?.oauth.pending ?? null
  if (!pending) {
    return (
      <Stack gap="sm">
        <Row gap="sm" align="center">
          <Button variant="solid" icon="link" disabled={busy !== null} onPress={() => void api.beginOAuth()}>
            Sign in with ClickUp
          </Button>
          {busy ? <Spinner label={busy} /> : null}
        </Row>
        <Row gap="sm">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onPress={() => {
              api.patchOAuthDraft({ clientId: auth?.oauth.clientId ?? '', clientSecret: '', redirectUri: auth?.oauth.redirectUri ?? '' })
              set(s.oauthEditing, true)
            }}
          >
            Change app
          </Button>
          <Button variant="ghost" size="sm" tone="danger" disabled={busy !== null} onPress={() => void api.forgetOAuthApp()}>
            Forget app
          </Button>
        </Row>
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Row gap="sm" align="center">
        <Button variant="solid" icon="open-external" disabled={busy !== null} onPress={() => void api.openOAuthPage()}>
          Open ClickUp to allow access
        </Button>
        <Button variant="ghost" disabled={busy !== null} onPress={() => void api.cancelOAuth()}>
          Cancel
        </Button>
      </Row>
      <Text size="xs" muted>
        Or open this address in a browser yourself:
      </Text>
      <Code block>{pending.authorizeUrl}</Code>
      {pending.listening ? (
        <Text size="sm" muted>
          Waiting for ClickUp to send your browser back to this computer. This screen updates by itself.
        </Text>
      ) : (
        <Callout tone="neutral">
          Orca cannot receive the redirect here, so after you allow access, copy the address your browser ends on (it may show an
          error page) and paste it below.
        </Callout>
      )}
      <Input
        label="Address your browser ended on"
        value={paste}
        placeholder="http://127.0.0.1:47386/callback?code=…&state=…"
        disabled={busy !== null}
        onChange={(v) => set(s.oauthPaste, v)}
        onSubmit={() => void api.pasteOAuthResult()}
      />
      <Row gap="sm" align="center">
        <Button variant="outline" disabled={busy !== null || paste.trim() === ''} onPress={() => void api.pasteOAuthResult()}>
          Finish sign-in
        </Button>
        {busy ? <Spinner label={busy} /> : null}
      </Row>
    </Stack>
  )
}

function TokenForm() {
  const busy = read(s.busy)
  const draft = read(s.tokenDraft)
  const noKeychain = read(s.auth)?.secretProtection === 'unavailable'
  return (
    <Collapsible title="Use a personal API token instead" description="Developer fallback" defaultOpen={false}>
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
          In ClickUp: avatar › Settings › Apps › API Token. It acts as you in every Workspace and does not expire.
        </Text>
        <Row>
          <Button variant="outline" disabled={noKeychain || busy !== null || draft.trim() === ''} onPress={() => void api.connect()}>
            Connect with token
          </Button>
        </Row>
      </Stack>
    </Collapsible>
  )
}

export function ConnectView() {
  const auth = read(s.auth)
  const notice = read(s.notice)
  const busy = read(s.busy)
  const editing = read(s.oauthEditing)
  const noKeychain = auth?.secretProtection === 'unavailable'
  const pickTeam = auth?.connected === true && !auth.teamId

  return (
    <Stack gap="md">
      <Heading level={2}>Connect ClickUp</Heading>
      <Text muted>See your tasks from the Lists you choose and start any of them in its own worktree with your coding agent.</Text>
      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
      {noKeychain ? (
        <Callout tone="danger" title="No keychain available">
          This system has no OS keychain, so a ClickUp sign-in cannot be stored safely.
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
        <Stack gap="md">
          {!auth?.oauth.clientId || editing ? <AppForm /> : <SignIn />}
          <TokenForm />
        </Stack>
      )}
      <Text size="xs" muted>
        Nothing in ClickUp changes until you start a task.
      </Text>
    </Stack>
  )
}
