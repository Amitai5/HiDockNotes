export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI & transcription' },
  { id: 'voices', label: 'Voices' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'device', label: 'Device & storage' },
  { id: 'agents', label: 'Agent connections' },
  { id: 'about', label: 'About' }
] as const
export type SettingsTab = typeof SETTINGS_TABS[number]['id']
interface SettingSearchEntry { id: string; tab: SettingsTab; title: string; description: string; keywords: string }
export const SETTINGS_CATALOG: readonly SettingSearchEntry[] = [
  { id: 'meaning-search', tab: 'ai', title: 'Local meaning search', description: 'Optional private search model and index.', keywords: 'semantic meaning search embedding model download optional offline local english index remove' },
  { id: 'google-calendar', tab: 'calendars', title: 'Google Calendar', description: 'Connect a private calendar feed and link meetings.', keywords: 'calendar google meeting invite invitees organizer agenda private ical link events refresh sync' },
  { id: 'your-name', tab: 'general', title: 'Your name', description: 'Your name, saved on your server.', keywords: 'profile display name' },
  { id: 'appearance', tab: 'general', title: 'Appearance', description: 'Choose light, dark, or system theme.', keywords: 'theme light dark mode color system' },
  { id: 'global-context', tab: 'general', title: 'Global context & terminology', description: 'Background, people, organizations, acronyms, and preferred spellings shared across projects.', keywords: 'reference knowledge glossary global context project background terminology people participant client organization product acronym spelling assistant summary' },
  { id: 'ai-providers', tab: 'ai', title: 'AI providers & API keys', description: 'Verify Gemini or OpenAI and choose independent models.', keywords: 'google gemini openai AQ AIza api key models cloud billing privacy' },
  { id: 'ai-providers', tab: 'ai', title: 'ChatGPT subscription', description: 'Sign in, switch or remove saved accounts, and manage plan usage.', keywords: 'codex chatgpt login account subscription plan usage limits sign in sign out delete remove connection' },
  { id: 'transcription', tab: 'ai', title: 'Parallel processing limits', description: 'Set simultaneous transcriptions and summaries on the server.', keywords: 'concurrency parallel simultaneous workers processing jobs cpu memory limits' },
  { id: 'ai-providers', tab: 'ai', title: 'Transcription provider & model', description: 'Local Whisper, Gemini, or OpenAI for audio.', keywords: 'whisper base small local offline cpu speed accuracy transcription model' },
  { id: 'ai-providers', tab: 'ai', title: 'Chat & summary model', description: 'Choose the provider used for summaries and Assistant.', keywords: 'chat assistant summaries model provider' },
  { id: 'transcription', tab: 'ai', title: 'Automatic transcription', description: 'Process new downloads and saved recordings, or resume paused processing.', keywords: 'queue process saved recording auto transcribe download background retry pause resume review' },
  { id: 'transcription', tab: 'ai', title: 'Transcription language', description: 'Detect automatically or set a language.', keywords: 'language english auto detect en transcription' },
  { id: 'transcription', tab: 'ai', title: 'Summary template & custom prompt', description: 'Meeting, call, interview, dictation, or your own instructions.', keywords: 'summary template custom prompt meeting call interview dictation' },
  { id: 'voice-profiles', tab: 'voices', title: 'Remembered voices', description: 'Rename, merge, or remove voice profiles and samples.', keywords: 'speaker recognition profile voice sample merge delete rename identify' },
  { id: 'voice-thresholds', tab: 'voices', title: 'Voice recognition thresholds', description: 'Adjust suggestion and automatic matching confidence.', keywords: 'suggest threshold similarity cosine auto assign confidence voice speaker' },
  { id: 'device-preferences', tab: 'device', title: 'Device preferences', description: 'Automatic connection, downloads and deletion after a verified server copy.', keywords: 'device connect auto download sync usb recorder delete verified copy server cleanup' },
  { id: 'storage', tab: 'device', title: 'Storage location', description: 'Choose where new audio recordings are saved.', keywords: 'storage folder file path recordings disk audio location' },
  { id: 'backup', tab: 'device', title: 'Library backup & restore', description: 'Save or restore all audio and metadata, including voices, tags and action items.', keywords: 'backup restore import export archive download recordings metadata database voice profiles samples tags actions recover recovery' },
  { id: 'agent-connections', tab: 'agents', title: 'MCP agent connections', description: 'Connect Codex, Claude Code, or another MCP client.', keywords: 'mcp agent harness codex claude code tools connection stdio automation' },
  { id: 'updates', tab: 'about', title: 'Application updates', description: 'Check releases, read changes, and back up before installing a verified update.', keywords: 'version updates upgrade installer signing signature windows mac linux release notes install download' },
  { id: 'about', tab: 'about', title: 'About & licenses', description: 'App version, platform, and third-party notices.', keywords: 'about version web PWA server license MIT copyright' }
]
export function searchSettings(query: string): readonly SettingSearchEntry[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return SETTINGS_CATALOG.filter(entry => {
    const text = `${entry.title} ${entry.description} ${entry.keywords} ${SETTINGS_TABS.find(tab => tab.id === entry.tab)?.label}`.toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}
