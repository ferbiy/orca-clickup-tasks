// Description: read view + Edit → Write (toolbar + Textarea) / Preview tabs.
import { Box, Button, Link, Markdown, Row, Stack, Tab, Tabs, Text, Textarea, read } from 'orca'
import * as edit from '../../edit'
import * as s from '../../state'
import * as api from '../../api'
import { moreWordsLabel, previewMarkdown } from '../../../shared/display'
import type { TaskDetail } from '../../../shared/model'
import { SectionTitle } from './shared'

/** Orca refuses a text node over 16 KiB; keep each Markdown well under it. */
const DESCRIPTION_MAX = 12_000

const DESC_SNIPPETS: { label: string; snippet: string }[] = [
  { label: 'H2', snippet: '\n## ' },
  { label: 'Bold', snippet: '**bold**' },
  { label: 'List', snippet: '\n- ' },
  { label: 'Check', snippet: '\n- [ ] ' },
  { label: 'Code', snippet: '\n```\ncode\n```\n' },
  { label: 'Link', snippet: '[text](url)' }
]

/**
 * The description: read view as today plus Edit → Write (Textarea 14 rows, markdown toolbar)
 * / Preview tabs with Save/Cancel. Over 16 000 chars stays read-only: ClickUp refuses more.
 */
export function Description({ task }: { task: TaskDetail }) {
  const expanded = read(s.descriptionExpanded)
  const e = read(s.editing)
  const locked = edit.isLocked(task.id, 'description')
  const busy = read(s.saving).includes('description')
  const capped = task.description.length > 16_000
  const tooLong = task.description.length > DESCRIPTION_MAX

  if (e?.field === 'description') {
    const tab = read(s.descriptionTab)
    return (
      <Stack gap="xs">
        <SectionTitle>Description</SectionTitle>
        <Tabs label="Description editor" value={tab} onChange={(v) => edit.setDescriptionTab(v === 'preview' ? 'preview' : 'write')}>
          <Tab value="write" label="Write">
            <Stack gap="xs">
              <Row gap="xs" wrap>
                {DESC_SNIPPETS.map((snip) => (
                  <Button key={snip.label} size="sm" variant="ghost" disabled={busy} onPress={() => edit.appendDescriptionSnippet(snip.snippet)}>
                    {snip.label}
                  </Button>
                ))}
              </Row>
              <Textarea
                label="Description"
                labelHidden
                rows={14}
                maxLength={16_000}
                value={e.draft}
                disabled={busy}
                onChange={edit.patchEditingDraft}
              />
            </Stack>
          </Tab>
          <Tab value="preview" label="Preview">
            {e.draft.trim() === '' ? (
              <Text size="sm" muted>
                Nothing to preview.
              </Text>
            ) : (
              <Markdown content={e.draft.slice(0, DESCRIPTION_MAX)} />
            )}
          </Tab>
        </Tabs>
        {e.error ? (
          <Text size="xs" tone="danger">
            {e.error}
          </Text>
        ) : null}
        <Row gap="xs">
          <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveDescription()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
            Cancel
          </Button>
        </Row>
      </Stack>
    )
  }

  if (!task.description.trim()) {
    return (
      <Stack gap="xs">
        <Row justify="between" align="center">
          <SectionTitle>Description</SectionTitle>
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            disabled={locked}
            onPress={() => edit.startEdit('description', task.description)}
          >
            Edit
          </Button>
        </Row>
        <Text size="sm" muted>
          No description.
        </Text>
      </Stack>
    )
  }

  const clipped = tooLong ? task.description.slice(0, DESCRIPTION_MAX) : task.description
  const { preview, truncated } = previewMarkdown(clipped)
  const showAll = expanded || !truncated
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <SectionTitle>Description</SectionTitle>
        {capped ? (
          <Row gap="xs" align="center">
            <Text size="xs" muted>
              Too long to edit here.
            </Text>
            <Link onPress={() => void api.openInClickUp(task.url)}>Edit in ClickUp</Link>
          </Row>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            disabled={locked}
            onPress={() => edit.startEdit('description', task.description)}
          >
            Edit
          </Button>
        )}
      </Row>
      <Box border radius="md" padding="md" background="muted">
        <Stack gap="sm">
          <Markdown content={showAll ? clipped : preview} />
          {truncated ? (
            <Row>
              <Button variant="ghost" size="sm" icon={expanded ? 'collapse' : 'expand'} onPress={api.toggleDescription}>
                {expanded ? 'Show less' : `Show more · ${moreWordsLabel(clipped, preview)}`}
              </Button>
            </Row>
          ) : null}
          {capped && showAll ? (
            <Row gap="xs" align="center" wrap>
              <Text size="xs" muted>
                The rest of this description is in ClickUp.
              </Text>
              <Link onPress={() => void api.openInClickUp(task.url)}>Open task</Link>
            </Row>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  )
}
